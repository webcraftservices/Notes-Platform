"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import { formatDuration } from "@/lib/material-style";
import { cn } from "@/lib/utils";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export interface AudioPlayerHandle {
  seek: (seconds: number) => void;
  play: () => void;
}

/**
 * Exposes an imperative `seek`/`play` handle via forwardRef so the
 * transcript viewer can jump playback to a segment's timestamp on click
 * (spec §14 — click a timestamp, jump to that point in the audio) without
 * either component needing to know about the other's internal state.
 * Existing callers that don't pass a ref are unaffected.
 */
export function computeSafeProgress(currentTime: number, duration: number): number {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) return 0;
  const p = currentTime / duration;
  if (!Number.isFinite(p) || isNaN(p)) return 0;
  return Math.min(1, Math.max(0, p));
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, { src: string; title: string }>(
  function AudioPlayer({ src, title }, ref) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [loaded, setLoaded] = useState(false);

    useImperativeHandle(ref, () => ({
      seek: (seconds: number) => {
        const audio = audioRef.current;
        if (!audio) return;
        const target = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
        const clamped = Number.isFinite(duration) && duration > 0 ? Math.min(target, duration) : target;
        audio.currentTime = clamped;
        setCurrentTime(clamped);
        // Same immediate visual sync as the in-component seek() — this
        // path (used by transcript-click-to-jump) previously left the
        // bar stale until the next rAF frame, which only happens while
        // already playing. See the root-cause analysis above.
        const d = audio.duration;
        if (Number.isFinite(d) && d > 0) updateVisual(Math.min(1, Math.max(0, clamped / d)));
      },
      play: () => {
        const audio = audioRef.current;
        if (!audio) return;
        setPlaying(true);
        startRaf();
        audio.play()?.catch(() => {
          stopRaf();
          setPlaying(false);
        });
      },
    }));

    const rafRef = useRef<number | null>(null);
    const progressTrackRef = useRef<HTMLDivElement | null>(null);
    const progressFillRef = useRef<HTMLDivElement | null>(null);
    const thumbRef = useRef<HTMLDivElement | null>(null);
    const thumbWrapperRef = useRef<HTMLDivElement | null>(null);

  function updateVisual(progress: number) {
    // progress in [0,1]. Only the two properties that actually change per
    // frame are touched here — transform-origin and will-change are
    // static and now live in the JSX (className/style) instead of being
    // reassigned every frame, which was pointless work but not the bug.
    //
    // Critically: neither element below carries a CSS `transition` on
    // `transform`. A CSS transition competing with a 60fps imperative
    // transform write is what caused the visible stepping — see the
    // block comment above this component for the full diagnosis. Do not
    // reintroduce `transition-transform` (or any transition on
    // `transform`) on either of these elements.
    const fill = progressFillRef.current;
    const thumbWrapper = thumbWrapperRef.current;
    if (fill) fill.style.transform = `scaleX(${progress})`;
    if (thumbWrapper) thumbWrapper.style.transform = `translateX(${progress * 100}%)`;
  }

  // Hoisted to component scope (not effect-local) so togglePlay() and the
  // imperative play() handle below can start the loop synchronously, in
  // the same tick as the user's click — see the root-cause note above
  // startRaf's call sites for why that matters. Wrapped in useCallback
  // with empty deps (they only ever touch stable refs) so their identity
  // is stable across renders — that's what lets the effect below list
  // them as real dependencies without re-running (and re-attaching every
  // listener) on every render.
  const startRaf = useCallback(() => {
    if (rafRef.current) return;
    const loop = () => {
      const a = audioRef.current;
      if (!a) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const t = a.currentTime;
      const d = a.duration;
      const safeT = Number.isFinite(t) && t >= 0 ? t : 0;
      const safeD = Number.isFinite(d) && d > 0 ? d : 0;
      const progress = safeD > 0 ? Math.min(1, Math.max(0, safeT / safeD)) : 0;
      updateVisual(progress);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let isMounted = true;

    const onTime = () => {
      const t = audio.currentTime;
      setCurrentTime(Number.isFinite(t) && t >= 0 ? t : 0);
    };
    const onLoaded = () => {
      const d = audio.duration;
      setDuration(Number.isFinite(d) && d > 0 ? d : 0);
      setLoaded(true);
    };
    const onDurationChange = () => {
      const d = audio.duration;
      setDuration(Number.isFinite(d) && d > 0 ? d : 0);
    };
    const onEnd = () => {
      // Ensure exact final state
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) setCurrentTime(d);
      // visually ensure progress reaches 100%
      try {
        updateVisual(1);
      } catch (e) {
        // ignore
      }
      setPlaying(false);
      stopRaf();
    };
    const onPlay = () => {
      setPlaying(true);
      // immediate sync before starting the rAF loop
      try {
        const d = audio.duration;
        const t = audio.currentTime;
        if (Number.isFinite(d) && d > 0 && Number.isFinite(t)) {
          const p = Math.min(1, Math.max(0, t / d));
          updateVisual(p);
        }
      } catch (e) {
        // ignore
      }
      startRaf();
    };
    const onPause = () => {
      setPlaying(false);
      // final sync to ensure visual stops exactly
      try {
        const d = audio.duration;
        const t = audio.currentTime;
        if (Number.isFinite(d) && d > 0 && Number.isFinite(t)) {
          const p = Math.min(1, Math.max(0, t / d));
          updateVisual(p);
        }
      } catch (e) {
        // ignore
      }
      stopRaf();
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnd);
    // Both "play" (fires the instant playback is requested) and "playing"
    // (fires once buffered data is actually available, which can lag
    // behind "play" — see the root-cause note above) start the loop.
    // startRaf() is idempotent, so listening to both is strictly more
    // robust than picking one: whichever fires first wins, and the other
    // is a harmless no-op.
    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlay);
    audio.addEventListener("pause", onPause);

    // Immediate sync in case metadata loaded before listeners attached
    try {
      const initialDuration = audio.duration;
      const initialCurrent = audio.currentTime;
      if (Number.isFinite(initialDuration) && initialDuration > 0) {
        setDuration(initialDuration);
        setLoaded(true);
      }
      if (Number.isFinite(initialCurrent) && initialCurrent >= 0) setCurrentTime(initialCurrent);

      // Sync visual immediately if possible
      try {
        const d = initialDuration;
        const t = initialCurrent;
        if (Number.isFinite(d) && d > 0 && Number.isFinite(t)) {
          const p = Math.min(1, Math.max(0, t / d));
          updateVisual(p);
        }
      } catch (e) {
        // ignore
      }

      // If duration is not yet finite, force a reload so loadedmetadata fires while listeners are attached
      if (!Number.isFinite(initialDuration) || initialDuration === Infinity) {
        // calling load will re-trigger network activity but ensures events fire
        try {
          audio.load();
        } catch (e) {
          // ignore
        }
      }
    } catch (e) {
      // ignore any read errors
    }

    return () => {
      isMounted = false;
      stopRaf();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlay);
      audio.removeEventListener("pause", onPause);
    };
    // Re-run effect whenever src changes so listeners are attached to the
    // new element. startRaf/stopRaf are stable (useCallback, empty deps)
    // so including them here does NOT cause the effect to re-run on every
    // render — only when src actually changes.
  }, [src, startRaf, stopRaf]);

    function togglePlay() {
      const audio = audioRef.current;
      if (!audio) return;
      if (playing) {
        audio.pause();
        setPlaying(false);
        return;
      }
      // Start the visual loop in the same tick as the click, rather than
      // waiting for the "play"/"playing" event round-trip — this is the
      // fix for the perceptible startup lag described in the root-cause
      // analysis above. If the browser actually refuses playback (e.g. an
      // autoplay-policy edge case), the loop is stopped and state reverted.
      setPlaying(true);
      startRaf();
      audio.play()?.catch(() => {
        stopRaf();
        setPlaying(false);
      });
    }

    function seek(value: number) {
      const audio = audioRef.current;
      if (!audio) return;
      // Clamp seek target to a safe finite range
      const target = Math.max(0, Number.isFinite(value) ? value : 0);
      const clamped = Number.isFinite(duration) && duration > 0 ? Math.min(target, duration) : target;
      audio.currentTime = clamped;
      setCurrentTime(clamped);
      // Sync the visual immediately — don't rely on the rAF loop, which
      // may not be running if playback is paused. This is the fix for
      // the seek-desync gap described in the root-cause analysis above.
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) updateVisual(Math.min(1, Math.max(0, clamped / d)));
    }

    function changeSpeed() {
      const nextIndex = (SPEEDS.indexOf(speed) + 1) % SPEEDS.length;
      const next = SPEEDS[nextIndex]!;
      setSpeed(next);
      if (audioRef.current) audioRef.current.playbackRate = next;
    }

    function toggleMute() {
      const audio = audioRef.current;
      if (!audio) return;
      audio.muted = !muted;
      setMuted(!muted);
    }

    return (
      <div className="card p-6">
        <audio ref={audioRef} src={src} preload="metadata" />
        <div className="flex items-center gap-4">
          <button
            onClick={togglePlay}
            disabled={!loaded}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition-transform hover:scale-105 disabled:opacity-50 dark:bg-white dark:text-graphite-950"
          >
            {playing ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="ml-0.5 h-5 w-5" fill="currentColor" />}
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink dark:text-white">{title}</p>
            <div className="mt-2 flex items-center gap-2">
              {(() => {
                // Compute safe values for display and controls
                const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
                const safeCurrent = Number.isFinite(currentTime) && currentTime >= 0 ? Math.min(currentTime, safeDuration) : 0;
                return (
                  <>
                    <span className="w-10 shrink-0 font-mono text-[11px] text-ink-faint dark:text-white/30">
                      {formatDuration(Math.floor(safeCurrent))}
                    </span>

                    <div className="relative flex items-center w-full px-2">
                      {/* Visual progress track */}
                      <div ref={progressTrackRef} className="relative w-full h-2 rounded-full bg-line overflow-hidden">
                        <div
                          ref={progressFillRef}
                          className="absolute left-0 top-0 bottom-0 origin-left bg-accent will-change-transform"
                          style={{ transform: "scaleX(0)" }}
                        />

                        <div
                          ref={thumbWrapperRef}
                          className="absolute left-0 top-0 bottom-0 w-full pointer-events-none will-change-transform"
                        >
                          <div
                            ref={thumbRef}
                            className="absolute left-0 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-strong shadow-md pointer-events-none"
                          />
                        </div>

                        {/* Accessible native input overlay — keep interaction and keyboard support */}
                        <input
                          aria-label="Seek"
                          type="range"
                          min={0}
                          max={safeDuration || 0}
                          value={safeCurrent}
                          onChange={(e) => {
                            seek(Number(e.target.value));
                          }}
                          className="absolute inset-0 w-full h-6 opacity-0 cursor-pointer"
                        />
                      </div>
                    </div>

                    <span className="w-10 shrink-0 font-mono text-[11px] text-ink-faint dark:text-white/30">
                      {formatDuration(Math.floor(safeDuration))}
                    </span>
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-3 border-t border-line pt-3 dark:border-line-dark">
          <button
            onClick={changeSpeed}
            className="rounded-sm border border-line px-2 py-1 font-mono text-[11px] text-ink-muted dark:border-line-dark dark:text-white/50"
          >
            {speed}×
          </button>
          <button onClick={toggleMute} className="text-ink-muted dark:text-white/50">
            {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              setMuted(false);
              if (audioRef.current) audioRef.current.volume = v;
            }}
            className={cn("h-1 w-20 cursor-pointer appearance-none rounded-full bg-line accent-accent dark:bg-line-dark")}
          />
        </div>
      </div>
    );
  }
);
