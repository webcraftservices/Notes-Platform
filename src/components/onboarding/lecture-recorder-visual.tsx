"use client";

import React from "react";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

// 18-bar balanced frequency spectrum with guaranteed solid minimum heights and smooth negative delay offsets
const WAVEFORM_BARS = [
  { height: 18, delay: -0.2 },
  { height: 24, delay: -0.75 },
  { height: 30, delay: -0.35 },
  { height: 38, delay: -1.1 },
  { height: 42, delay: -0.5 },
  { height: 46, delay: -1.25 },
  { height: 40, delay: -0.65 },
  { height: 32, delay: -0.15 },
  { height: 26, delay: -0.9 },
  { height: 30, delay: -0.4 },
  { height: 38, delay: -1.05 },
  { height: 44, delay: -0.6 },
  { height: 42, delay: -1.2 },
  { height: 36, delay: -0.3 },
  { height: 28, delay: -0.85 },
  { height: 24, delay: -0.45 },
  { height: 20, delay: -1.0 },
  { height: 16, delay: -0.55 },
];

export interface LectureRecorderVisualProps {
  className?: string;
}

export function LectureRecorderVisual({ className }: LectureRecorderVisualProps) {
  return (
    <div
      className={cn(
        "relative w-full max-w-[500px] mx-auto rounded-2xl bg-[#121318] border border-white/[0.08] shadow-[0_20px_50px_rgba(0,0,0,0.55)] ring-1 ring-white/5 overflow-hidden select-none",
        className
      )}
    >
      {/* =================================================================== */}
      {/* 1. LECTURE AUDIO CAPTURE STAGE                                       */}
      {/* =================================================================== */}
      <div className="p-5 sm:p-6 pb-4 sm:pb-5">
        {/* Stage Header: Calm recording status & elapsed time */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-violet-400" />
            </span>
            <span className="font-maname text-[13px] text-neutral-300 leading-none relative -top-[2.5px]">
              Recording Lecture
            </span>
          </div>

          <span className="font-mono text-[12px] text-neutral-400 tracking-wider">
            24:18
          </span>
        </div>

        {/* Centerpiece: Microphone Focal Point & Waveform */}
        <div className="my-5 flex flex-col items-center justify-center">
          {/* Refined circular surround: intentional, polished, no hardware clutter */}
          <div className="relative flex items-center justify-center">
            <div className="size-20 sm:size-22 rounded-full border border-white/10 bg-gradient-to-b from-[#1D1E28] to-[#13141B] p-2 shadow-inner ring-1 ring-white/5 flex items-center justify-center">
              <div className="size-full rounded-full bg-[#101116] border border-violet-500/20 flex items-center justify-center text-violet-300">
                <Mic className="size-6 sm:size-7 text-neutral-100" strokeWidth={1.8} />
              </div>
            </div>
          </div>

          {/* Waveform: Smooth, compositor-backed GPU animation with zero stalls */}
          <div
            className="mt-4 flex items-end justify-center gap-1 sm:gap-1.5 h-11 w-full max-w-[260px]"
            aria-label="Audio waveform visualization"
            role="img"
          >
            {WAVEFORM_BARS.map((bar, i) => (
              <div
                key={i}
                style={{
                  height: `${bar.height}px`,
                  animationDelay: `${bar.delay}s`,
                }}
                className="w-[2.5px] sm:w-[3px] rounded-full bg-violet-400/80 animate-zenote-wave"
              />
            ))}
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* SUBTLE STAGE TRANSITION (Audio Capture -> Searchable Text)          */}
      {/* =================================================================== */}
      <div className="border-t border-white/[0.06] px-5 sm:px-6 py-2 bg-white/[0.015] flex items-center justify-between text-[11px] font-maname text-neutral-400">
        <span>Spoken explanation</span>
        <span className="text-violet-400/90 font-medium">Turned into text ↓</span>
      </div>

      {/* =================================================================== */}
      {/* 2. REFINED TRANSCRIPTION PREVIEW STAGE                              */}
      {/* =================================================================== */}
      <div className="p-5 sm:p-6 pt-3.5 sm:pt-4 bg-[#0F1015]/70">
        {/* Transcript Header */}
        <div className="flex items-center justify-between mb-3.5">
          <div className="flex items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full bg-emerald-400/80" />
            <h3 className="font-maname text-[13px] font-medium text-neutral-200 leading-none relative -top-[2.5px]">
              Transcript
            </h3>
          </div>
          <span className="font-maname text-[12px] text-neutral-400">
            Prof. Vance
          </span>
        </div>

        {/* Clean, Readable Two-Column Transcript Rows */}
        <div className="space-y-3.5">
          {/* Passage 1 */}
          <div className="flex items-start gap-3 sm:gap-3.5">
            <div className="w-11 sm:w-12 shrink-0 pt-0.5 text-left">
              <span className="font-mono text-[11px] text-violet-300/60 tabular-nums">
                09:42
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-maname text-[13px] sm:text-[13.5px] leading-relaxed text-neutral-300">
                When modeling continuous dynamical systems in state space, the eigenvalues of the system matrix govern how any state perturbation evolves over time.
              </p>
            </div>
          </div>

          {/* Passage 2: Featuring subtle violet key concept highlight */}
          <div className="flex items-start gap-3 sm:gap-3.5 pt-3 border-t border-white/[0.04]">
            <div className="w-11 sm:w-12 shrink-0 pt-0.5 text-left">
              <span className="font-mono text-[11px] text-violet-300/60 tabular-nums">
                14:28
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-maname text-[13px] sm:text-[13.5px] leading-relaxed text-neutral-200">
                If every eigenvalue has a strictly negative real part, the system is asymptotically stable—
                <span className="rounded bg-violet-500/15 text-violet-200 font-medium px-1.5 py-0.5">
                  all initial disturbances naturally decay back to equilibrium
                </span>{" "}
                rather than diverging into oscillations.
              </p>
            </div>
          </div>

          {/* Passage 3 */}
          <div className="flex items-start gap-3 sm:gap-3.5 pt-3 border-t border-white/[0.04]">
            <div className="w-11 sm:w-12 shrink-0 pt-0.5 text-left">
              <span className="font-mono text-[11px] text-violet-300/60 tabular-nums">
                22:51
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-maname text-[13px] sm:text-[13.5px] leading-relaxed text-neutral-300">
                In next week&apos;s lab, we will compute the phase portrait for a two-tank liquid level system to observe this decay trajectory directly in experimental data.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LectureRecorderVisual;
