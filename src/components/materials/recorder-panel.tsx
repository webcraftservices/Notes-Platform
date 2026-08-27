"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, Pause, Play, Square, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AudioLevelMeter } from "@/components/materials/audio-level-meter";
import { useMaterialUpload, type UploadScope } from "@/lib/hooks/use-material-upload";
import { formatDuration } from "@/lib/material-style";

type RecordingState = "idle" | "requesting" | "recording" | "paused" | "uploading" | "error";

/** Picks a MIME type MediaRecorder in this browser can actually produce. */
function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "audio/webm";
}

export function RecorderPanel({
  scope,
  onRecorded,
}: {
  scope: UploadScope;
  onRecorded: (materialId: string) => void;
}) {
  const { upload } = useMaterialUpload();
  const [state, setState] = useState<RecordingState>("idle");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [usage, setUsage] = useState<{ remainingSeconds: number; limitSeconds: number } | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const accumulatedMsRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    fetch("/api/recording-usage")
      .then((r) => r.json())
      .then((d) => setUsage({ remainingSeconds: d.remainingSeconds, limitSeconds: d.limitSeconds }))
      .catch(() => {});

    // Device labels are only populated after permission is granted, so
    // this list will be generic until the user starts their first
    // recording — that's a browser privacy constraint, not a bug.
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => setDevices(list.filter((d) => d.kind === "audioinput")))
      .catch(() => {});

    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanup() {
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioContextRef.current?.close().catch(() => {});
    streamRef.current = null;
    audioContextRef.current = null;
    analyserRef.current = null;
  }

  async function handleStart() {
    if (usage && usage.remainingSeconds <= 0) {
      toast.error("You've used all your recording minutes for this month.");
      return;
    }
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      streamRef.current = stream;

      // Refresh device list now that labels are available post-permission.
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "audioinput"));

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(1000);
      recorderRef.current = recorder;

      accumulatedMsRef.current = 0;
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedMs(accumulatedMsRef.current + (Date.now() - startTimeRef.current));
      }, 200);

      setState("recording");
    } catch (err) {
      setState("error");
      toast.error(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in your browser settings to record."
          : "Couldn't access the microphone."
      );
    }
  }

  function handlePause() {
    recorderRef.current?.pause();
    if (timerRef.current) clearInterval(timerRef.current);
    accumulatedMsRef.current += Date.now() - startTimeRef.current;
    setState("paused");
  }

  function handleResume() {
    recorderRef.current?.resume();
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedMs(accumulatedMsRef.current + (Date.now() - startTimeRef.current));
    }, 200);
    setState("recording");
  }

  function handleCancel() {
    recorderRef.current?.stop();
    cleanup();
    chunksRef.current = [];
    setElapsedMs(0);
    setState("idle");
  }

  async function handleStop() {
    const recorder = recorderRef.current;
    if (!recorder) return;

    const mimeType = recorder.mimeType || "audio/webm";
    const stopped = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: mimeType }));
    });
    recorder.stop();
    const blob = await stopped;

    // Compute recorded duration in ms from the timing refs (do this before cleanup())
    const recordedMs = Math.max(
      0,
      Math.round((accumulatedMsRef.current ?? 0) + (Date.now() - (startTimeRef.current ?? 0)))
    );

    cleanup();

    if (blob.size === 0) {
      toast.error("Recording was empty — nothing to save.");
      setState("idle");
      setElapsedMs(0);
      return;
    }

    setState("uploading");
    try {
      // Attempt to finalize WebM duration metadata for browser/Audio playback.
      // This uses the webm-duration-fix library which patches the EBML Segment
      // Info duration field so HTMLAudioElement.duration becomes finite.
      let uploadBlob: Blob = blob;
      try {
        // @ts-ignore - defensive runtime checks below; ignore strict null warnings here
        const baseType = String(mimeType).split(";")[0].trim().toLowerCase();
        if (baseType === "audio/webm" && typeof window !== "undefined") {
          // Dynamic import so SSR/build paths don't break
          // webm-duration-fix exports a default async function: (blob) => Promise<Blob>
          const fixerModule = await import("webm-duration-fix");
          // cast to any to satisfy TS about dynamic import shapes
          const fixer = (fixerModule as any).default ?? (fixerModule as any);
          if (typeof fixer === "function") {
            try {
              const possiblyFixed = await (fixer as any)(blob);
              if (possiblyFixed instanceof Blob) uploadBlob = possiblyFixed;
            } catch (fixErr) {
              // Don't block upload on failure to rewrite metadata
              // (requirement 14: handle gracefully)
              // eslint-disable-next-line no-console
              console.warn("webm duration fix failed:", fixErr);
            }
          }
        }
      } catch (e) {
        // Ignore any import/patch errors and proceed with original blob.
        // eslint-disable-next-line no-console
        console.warn("Could not apply WebM duration fix:", e);
      }

      const extension = mimeType.includes("mp4") ? "m4a" : "webm";
      const filename = `Recording ${new Date().toLocaleString()}.${extension}`;
      const { materialId } = await upload(uploadBlob, filename, mimeType, scope, (event) =>
        setUploadProgress(event.progress)
      );
      onRecorded(materialId);
    } catch (err) {
      setState("error");
      toast.error(err instanceof Error ? err.message : "Couldn't save the recording.");
    }
  }

  if (state === "uploading") {
    return (
      <div className="flex flex-col items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-ink-faint" />
        <p className="mt-3 text-sm text-ink-muted dark:text-white/50">Saving recording… {uploadProgress}%</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-6">
      {(state === "idle" || state === "error") && (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft">
            <Mic className="h-6 w-6 text-accent-strong" strokeWidth={1.75} />
          </div>
          {devices.length > 0 && (
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="mt-4 max-w-full rounded-sm border border-line bg-paper-raised px-2.5 py-1.5 text-xs text-ink dark:border-line-dark dark:bg-graphite-800 dark:text-white"
            >
              <option value="">System default microphone</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "Microphone"}
                </option>
              ))}
            </select>
          )}
          <Button className="mt-4" onClick={handleStart}>
            <Mic className="h-4 w-4" />
            Start Recording
          </Button>
          {usage && (
            <p className="mt-2 text-xs text-ink-faint dark:text-white/30">
              {Math.round(usage.remainingSeconds / 60)} of {Math.round(usage.limitSeconds / 60)} minutes
              remaining this month
            </p>
          )}
        </>
      )}

      {state === "requesting" && (
        <div className="flex flex-col items-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-ink-faint" />
          <p className="mt-3 text-sm text-ink-muted dark:text-white/50">Requesting microphone access…</p>
        </div>
      )}

      {(state === "recording" || state === "paused") && (
        <>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${state === "recording" ? "animate-pulse bg-signal-danger" : "bg-ink-faint"}`} />
            <span className="font-mono text-2xl font-medium tabular-nums text-ink dark:text-white">
              {formatDuration(Math.floor(elapsedMs / 1000))}
            </span>
          </div>

          <div className="mt-4">
            <AudioLevelMeter analyser={analyserRef.current} active={state === "recording"} />
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Button variant="secondary" onClick={handleCancel} aria-label="Cancel recording">
              <X className="h-4 w-4" />
              Cancel
            </Button>
            {state === "recording" ? (
              <Button variant="secondary" onClick={handlePause} aria-label="Pause recording">
                <Pause className="h-4 w-4" />
                Pause
              </Button>
            ) : (
              <Button variant="secondary" onClick={handleResume} aria-label="Resume recording">
                <Play className="h-4 w-4" />
                Resume
              </Button>
            )}
            <Button onClick={handleStop} aria-label="Stop and save recording">
              <Square className="h-3.5 w-3.5" fill="currentColor" />
              Stop
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
