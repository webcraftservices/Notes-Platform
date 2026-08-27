"use client";

import { useEffect, useRef } from "react";

const BAR_COUNT = 24;

/**
 * Renders bars driven by actual frequency-domain data from the live mic
 * stream (spec §11 "waveform") — not a canned CSS pulse. Reads the
 * AnalyserNode on every animation frame and re-renders bar heights from
 * real amplitude data.
 */
export function AudioLevelMeter({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const barsRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number>();

  useEffect(() => {
    if (!analyser || !active) {
      frameRef.current && cancelAnimationFrame(frameRef.current);
      return;
    }

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const bins = Math.floor(dataArray.length / BAR_COUNT);

    function draw() {
      if (!analyser) return;
      analyser.getByteFrequencyData(dataArray);
      const container = barsRef.current;
      if (container) {
        for (let i = 0; i < BAR_COUNT; i++) {
          let sum = 0;
          for (let j = 0; j < bins; j++) sum += dataArray[i * bins + j] ?? 0;
          const avg = sum / bins;
          const height = Math.max(4, Math.min(32, (avg / 255) * 32));
          const bar = container.children[i] as HTMLDivElement | undefined;
          if (bar) bar.style.height = `${height}px`;
        }
      }
      frameRef.current = requestAnimationFrame(draw);
    }
    frameRef.current = requestAnimationFrame(draw);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [analyser, active]);

  return (
    <div ref={barsRef} className="flex h-8 items-end gap-[3px]">
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full bg-accent transition-[height] duration-75"
          style={{ height: 4 }}
        />
      ))}
    </div>
  );
}
