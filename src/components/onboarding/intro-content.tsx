"use client";

import React from "react";
import { IntroHero } from "./intro-hero";
import { UploadSection } from "./upload-section";
import { ConnectedSourcesSection } from "./connected-sources-section";
import { OrganizeExploreSection } from "./organize-explore-section";
import { LectureRecordingSection } from "./lecture-recording-section";
import { CollaborateSection } from "./collaborate-section";
import { ContactSection } from "./contact-section";
import { TracingBeam, TracingBeamStep } from "./tracing-beam";
import {
  CaptureIllustration,
  OrganizeIllustration,
  ExploreIllustration,
  LearnIllustration,
} from "./tracing-illustrations";
import { ZENOTE_ACCENT } from "./shared";
import { Mic, FolderTree, Search, GraduationCap } from "lucide-react";

export function IntroContent() {
  return (
    <main className="w-full bg-[#0E0E10] font-sans text-neutral-50 selection:bg-violet-500/30">
      {/* ================================================================ */}
      {/* SECTION 1 — INTRO HERO                                           */}
      {/* ================================================================ */}
      <IntroHero />

      {/* ================================================================ */}
      {/* SECTION 2 — UPLOAD YOUR FILES                                    */}
      {/* ================================================================ */}
      <UploadSection />

      {/* ================================================================ */}
      {/* SECTION 3 — CONNECTED SOURCES                                    */}
      {/* ================================================================ */}
      <ConnectedSourcesSection />

      {/* ================================================================ */}
      {/* SECTION 4 — ORGANIZE & EXPLORE                                   */}
      {/* ================================================================ */}
      <OrganizeExploreSection />

      {/* ================================================================ */}
      {/* SECTION 5 — LECTURE RECORDING & TRANSCRIPTION                     */}
      {/* ================================================================ */}
      <LectureRecordingSection />

      {/* ================================================================ */}
      {/* SECTION 6 — COLLABORATE WITH YOUR GROUP                          */}
      {/* ================================================================ */}
      <CollaborateSection />

      {/* ================================================================ */}
      {/* SECTION 7 — TRACING BEAM WORKFLOW                                */}
      {/* ================================================================ */}
      <section
        id="story"
        aria-labelledby="story-heading"
        className="relative w-full pt-16 sm:pt-20 md:pt-24 pb-20 sm:pb-28 md:pb-36 overflow-hidden"
      >
        {/* Editorial Section Header */}
        <div className="relative mx-auto max-w-3xl px-5 sm:px-6 md:px-8 text-center mb-10 sm:mb-14 md:mb-16">
          <p className="font-maname text-[12px] sm:text-[13px] font-medium tracking-[0.22em] uppercase text-amber-400/90 mb-3 sm:mb-3.5">
            THE ZENOTE JOURNEY
          </p>
          <h2
            id="story-heading"
            className="font-noto text-[30px] sm:text-[36px] md:text-[42px] font-[650] leading-[1.18] tracking-[0.01em] text-white text-balance max-w-2xl mx-auto mb-3.5 sm:mb-4"
          >
            From scattered to understood.
          </h2>
          <p className="font-maname text-[14.5px] sm:text-[15.5px] md:text-[16px] font-normal leading-[1.68] text-neutral-400 text-pretty max-w-xl mx-auto">
            Bring your learning materials together, find what matters, and turn what you collect into knowledge you can revisit.
          </p>
        </div>

        <TracingBeam>
          {/* STEP 01: CAPTURE */}
          <TracingBeamStep
            index="01"
            tag="01 · CAPTURE"
            title="Bring your learning together."
            description="Capture lectures, import files and bring your learning materials into one place."
            tone={ZENOTE_ACCENT.violet}
            icon={Mic}
            illustration={<CaptureIllustration />}
          />

          {/* STEP 02: ORGANIZE */}
          <TracingBeamStep
            index="02"
            tag="02 · ORGANIZE"
            title="Give everything a place."
            description="Keep your materials organized into a structured space that's easier to browse, manage and revisit."
            tone={ZENOTE_ACCENT.magenta}
            icon={FolderTree}
            illustration={<OrganizeIllustration />}
          />

          {/* STEP 03: EXPLORE */}
          <TracingBeamStep
            index="03"
            tag="03 · EXPLORE"
            title="Find what matters."
            description="Browse your collection, search your materials and return to the information you need."
            tone={ZENOTE_ACCENT.pink}
            icon={Search}
            illustration={<ExploreIllustration />}
          />

          {/* STEP 04: LEARN */}
          <TracingBeamStep
            index="04"
            tag="04 · LEARN"
            title="Turn information into knowledge."
            description="Revisit your materials, reinforce your understanding and build on what you have learned."
            tone={ZENOTE_ACCENT.gold}
            icon={GraduationCap}
            illustration={<LearnIllustration />}
          />
        </TracingBeam>
      </section>

      {/* ================================================================ */}
      {/* SECTION 8 — CONTACT & SUPPORT                                    */}
      {/* ================================================================ */}
      <ContactSection />
    </main>
  );
}
