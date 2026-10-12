"use client";

import React from "react";
import { HeroParallax } from "./hero-parallax";
import {
  ZENOTE_SCREENS,
} from "./placeholder-data";

import { TracingBeam, TracingBeamStep } from "./tracing-beam";
import { ZENOTE_ACCENT } from "./shared";
import { Library, Workflow, Compass, Monitor } from "lucide-react";

export function IntroContent() {
  return (
    <main className="w-full bg-[#0E0E10] font-sans text-neutral-50 selection:bg-violet-500/30">
      {/* ================================================================ */}
      {/* SECTION 1 — HERO PARALLAX                                        */}
      {/* Checkpoint 1: 3-card Z-depth focal progression test              */}
      {/* ================================================================ */}
      <HeroParallax
        items={ZENOTE_SCREENS}
      />

      {/* ================================================================ */}
      {/* SECTION 2 — TRACING BEAM                                         */}
      {/* Checkpoint 2: Guided onboarding narrative                        */}
      {/* ================================================================ */}
      <section className="intro-tracing-section relative w-full pt-0 pb-20 md:pb-40">
        <style>{`
          .intro-tracing-section {
            margin-top: clamp(-260px, calc(2373px - 352vh), 0px);
          }
          @media (min-width: 768px) {
            .intro-tracing-section {
              margin-top: clamp(-195px, calc(826px - 103vh), 0px);
            }
          }
        `}</style>
        <TracingBeam>
          <TracingBeamStep
            isFirst
            index="01"
            title="What Zenote is."
            description="A unified, calm workspace where all your notes, study materials, and ideas live together. Designed to eliminate digital clutter and help you focus."
            tone={ZENOTE_ACCENT.violet}
            icon={Library}
          />
          <TracingBeamStep
            index="02"
            title="What you can do."
            description="Organize documents, read without distractions, and connect insights effortlessly. Transform scattered information into structured, long-term knowledge."
            tone={ZENOTE_ACCENT.magenta}
            icon={Workflow}
          />
          <TracingBeamStep
            index="03"
            title="How to use it."
            description="Access your library at your own pace. Let intelligent search and smart progress-tracking surface exactly what you need, exactly when you need it."
            tone={ZENOTE_ACCENT.pink}
            icon={Compass}
          />
          <TracingBeamStep
            index="04"
            title="Choose your experience."
            description="Use Zenote seamlessly in your browser online, or download the desktop app for a focused, offline-first environment."
            tone={ZENOTE_ACCENT.gold}
            icon={Monitor}
          />
        </TracingBeam>
      </section>
    </main>
  );
}
