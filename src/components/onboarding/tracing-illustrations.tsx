"use client";

import React from "react";
import {
  Mic,
  FileText,
  Cloud,
  Sparkles,
  FolderTree,
  Search,
  Brain,
  CheckCircle2,
} from "lucide-react";
import { ZENOTE_ACCENT } from "./shared";

/**
 * 01 — CAPTURE FEATURE ILLUSTRATION
 * Communicates multi-format learning materials (live audio, documents, cloud streams)
 * converging into a unified, commanding Zenote collection vessel.
 *
 * Refinements:
 * - Clean near-black surface (#0C0D11) with zero background haze.
 * - Mobile-first fluid proportions: sources scale gracefully, leaving ample room for conduits.
 * - Conduits terminate cleanly right at the left edge of the collection vessel.
 * - ZERO decorative circles or connector dots around the AI container perimeter.
 */
export function CaptureIllustration() {
  return (
    <div
      aria-hidden="true"
      className="relative w-full h-40 sm:h-52 md:h-56 rounded-xl sm:rounded-2xl bg-[#0C0D11] border border-white/[0.08] flex items-center justify-between p-2.5 sm:p-5 md:p-6 overflow-hidden select-none"
    >
      {/* Left Column: 3 Distinct Material Source Artifacts */}
      <div className="relative z-10 flex flex-col justify-between h-full py-0.5 sm:py-1 gap-1.5 sm:gap-3 shrink-0 w-[42%] max-w-[130px] sm:max-w-none sm:w-44 md:w-48">
        {/* Audio Waveform Artifact */}
        <div className="flex-1 px-2 py-1 sm:px-3 sm:py-2 rounded-lg sm:rounded-xl bg-[#14151E] border border-white/[0.09] flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
            <div className="flex items-center justify-center size-5 sm:size-7 rounded-md sm:rounded-lg bg-violet-500/15 border border-violet-500/25 text-violet-300 shrink-0">
              <Mic className="size-3 sm:size-4" strokeWidth={2} />
            </div>
            {/* Sculptural Audio Waveform Bars */}
            <div className="flex items-center gap-0.5 sm:gap-1 h-3 sm:h-4 overflow-hidden">
              {[45, 90, 60, 100, 70].map((h, i) => (
                <span
                  key={i}
                  className="w-0.5 sm:w-1 rounded-full bg-violet-400 shrink-0"
                  style={{ height: `${h}%` }}
                />
              ))}
              {[40, 80, 55].map((h, i) => (
                <span
                  key={`extra-${i}`}
                  className="hidden sm:inline-block w-1 rounded-full bg-violet-400 shrink-0"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
          <span className="size-1 sm:size-1.5 rounded-full bg-violet-400 shadow-[0_0_6px_#7C6CF0] shrink-0 ml-1" />
        </div>

        {/* Structured Document & Slide Artifact */}
        <div className="flex-1 px-2 py-1 sm:px-3 sm:py-2 rounded-lg sm:rounded-xl bg-[#14151E] border border-white/[0.09] flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
            <div className="flex items-center justify-center size-5 sm:size-7 rounded-md sm:rounded-lg bg-white/[0.06] border border-white/[0.12] text-neutral-200 shrink-0">
              <FileText className="size-3 sm:size-4" strokeWidth={2} />
            </div>
            {/* Iconic Document Ribbons */}
            <div className="flex flex-col gap-1 sm:gap-1.5 min-w-0">
              <div className="w-10 sm:w-16 md:w-22 h-1.5 sm:h-2 rounded-full bg-white/30" />
              <div className="w-6 sm:w-10 md:w-14 h-1 sm:h-1.5 rounded-full bg-white/15" />
            </div>
          </div>
          <span className="size-1 sm:size-1.5 rounded-full bg-neutral-400 shrink-0 ml-1" />
        </div>

        {/* Cloud & Reference Stream Artifact */}
        <div className="flex-1 px-2 py-1 sm:px-3 sm:py-2 rounded-lg sm:rounded-xl bg-[#14151E] border border-white/[0.09] flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
            <div className="flex items-center justify-center size-5 sm:size-7 rounded-md sm:rounded-lg bg-white/[0.06] border border-white/[0.12] text-neutral-200 shrink-0">
              <Cloud className="size-3 sm:size-4" strokeWidth={2} />
            </div>
            {/* Knowledge Sync Stream */}
            <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
              <div className="w-10 sm:w-14 md:w-20 h-1.5 sm:h-2 rounded-full bg-gradient-to-r from-violet-500/50 to-white/20" />
            </div>
          </div>
          <span className="size-1 sm:size-1.5 rounded-full bg-violet-400 shrink-0 ml-1" />
        </div>
      </div>

      {/* Center: Fluid Architectural Conduits */}
      <div className="relative flex-1 h-full mx-1 sm:mx-3 flex items-center justify-center pointer-events-none">
        <svg
          viewBox="0 0 100 160"
          className="w-full h-full"
          fill="none"
          preserveAspectRatio="none"
        >
          {/* Base structural conduit lines converging into center-right (100, 80) */}
          <path
            d="M 0 32 C 55 32, 65 80, 100 80"
            stroke="rgba(255,255,255,0.14)"
            strokeWidth="1.5"
          />
          <path
            d="M 0 80 H 100"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="1.5"
          />
          <path
            d="M 0 128 C 55 128, 65 80, 100 80"
            stroke="rgba(255,255,255,0.14)"
            strokeWidth="1.5"
          />

          {/* Active convergence stream overlays */}
          <path
            d="M 0 32 C 55 32, 65 80, 100 80"
            stroke={ZENOTE_ACCENT.violet}
            strokeOpacity="0.75"
            strokeWidth="1.5"
            strokeDasharray="5 3"
          />
          <path
            d="M 0 128 C 55 128, 65 80, 100 80"
            stroke={ZENOTE_ACCENT.violet}
            strokeOpacity="0.75"
            strokeWidth="1.5"
            strokeDasharray="5 3"
          />
        </svg>
      </div>

      {/* Right: Sculpted Zenote Collection Vessel (Clean, Uncluttered Hero) */}
      <div className="relative z-10 flex items-center justify-center shrink-0">
        <div className="relative size-13 sm:size-22 md:size-24 rounded-xl sm:rounded-2xl bg-[#161724] border border-violet-500/35 flex flex-col items-center justify-center p-2 sm:p-3 shadow-md">
          <div className="flex items-center justify-center size-8 sm:size-11 md:size-12 rounded-lg sm:rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-300">
            <Sparkles className="size-4 sm:size-5 md:size-6" strokeWidth={2} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 02 — ORGANIZE FEATURE ILLUSTRATION
 * Communicates calm structural hierarchy: an architectural folder workspace branching
 * into neatly organized, manageable topic tiers with tangible depth and tonal contrast.
 *
 * Refinements:
 * - Fluid mobile sizing: folder and topic tiers scale proportionally so neither overflows.
 * - Tangible overlapping folder cards showing physical depth without miniature dashboard labels.
 * - Orthogonal branching tree connector with smooth 90-degree fillets.
 * - 3 distinct, high-contrast topic shelves with restrained magenta focal point.
 */
export function OrganizeIllustration() {
  return (
    <div
      aria-hidden="true"
      className="relative w-full h-40 sm:h-52 md:h-56 rounded-xl sm:rounded-2xl bg-[#0C0D11] border border-white/[0.08] flex items-center justify-between p-2.5 sm:p-5 md:p-6 overflow-hidden select-none"
    >
      {/* Left: Master Architecture Folder with Cascading Layers */}
      <div className="relative z-10 w-[42%] max-w-[130px] sm:max-w-none sm:w-46 md:w-52 h-full flex flex-col justify-end shrink-0">
        {/* Curved architectural folder tab */}
        <div className="flex items-center gap-1.5 sm:gap-2 px-2 py-1 sm:px-3 sm:py-1.5 rounded-t-md sm:rounded-t-lg bg-[#1D1726] border-t border-x border-magenta-500/35 text-magenta-300 w-fit ml-0.5 sm:ml-1">
          <FolderTree className="size-3 sm:size-3.5 text-magenta-400" strokeWidth={2} />
          <div className="w-6 sm:w-10 h-1 sm:h-1.5 rounded-full bg-magenta-400/50" />
        </div>

        {/* Folder Body with Cascading Interior Depth */}
        <div className="w-full h-[80%] rounded-b-xl sm:rounded-b-2xl rounded-tr-xl sm:rounded-tr-2xl bg-[#161420] border border-magenta-500/30 p-1.5 sm:p-3 shadow-md flex flex-col justify-between relative">
          {/* Depth Layer 1 (Back Card) */}
          <div className="p-1 sm:p-2 rounded sm:rounded-lg bg-[#1D1728] border border-white/[0.07] flex flex-col gap-0.5 sm:gap-1 opacity-60">
            <div className="w-3/4 h-1 sm:h-1.5 rounded-full bg-white/20" />
            <div className="w-1/2 h-1 sm:h-1.5 rounded-full bg-white/10" />
          </div>

          {/* Depth Layer 2 (Active Foreground Card) */}
          <div className="p-1.5 sm:p-2.5 rounded sm:rounded-lg bg-[#221A2C] border border-magenta-400/30 flex flex-col gap-1 sm:gap-1.5 shadow-sm">
            <div className="w-14 sm:w-24 h-1.5 sm:h-2 rounded-full bg-magenta-400/70" />
            <div className="w-full h-1 sm:h-1.5 rounded-full bg-white/25" />
            <div className="w-2/3 h-1 sm:h-1.5 rounded-full bg-white/15" />
          </div>

          {/* Exit connector node */}
          <span className="absolute -right-1 top-1/2 -translate-y-1/2 size-1.5 sm:size-2 rounded-full bg-magenta-400 shadow-[0_0_6px_#BE4BDB]" />
        </div>
      </div>

      {/* Center: Orthogonal Branching Tree Connector */}
      <div className="relative flex-1 h-full mx-1 sm:mx-2 flex items-center justify-center pointer-events-none">
        <svg
          viewBox="0 0 100 160"
          className="w-full h-full"
          fill="none"
          preserveAspectRatio="none"
        >
          {/* Base structural branches */}
          <path
            d="M 0 80 H 32 C 48 80, 48 28, 64 28 H 100"
            stroke="rgba(255,255,255,0.14)"
            strokeWidth="1.5"
          />
          <path
            d="M 0 80 H 100"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="1.5"
          />
          <path
            d="M 0 80 H 32 C 48 80, 48 132, 64 132 H 100"
            stroke="rgba(255,255,255,0.14)"
            strokeWidth="1.5"
          />

          {/* Active magenta overlay branches */}
          <path
            d="M 0 80 H 32 C 48 80, 48 28, 64 28 H 100"
            stroke={ZENOTE_ACCENT.magenta}
            strokeOpacity="0.65"
            strokeWidth="1.5"
          />
          <path
            d="M 0 80 H 100"
            stroke={ZENOTE_ACCENT.magenta}
            strokeOpacity="0.65"
            strokeWidth="1.5"
          />
          <path
            d="M 0 80 H 32 C 48 80, 48 132, 64 132 H 100"
            stroke={ZENOTE_ACCENT.magenta}
            strokeOpacity="0.65"
            strokeWidth="1.5"
          />

          {/* Branching junction discs */}
          <circle cx="32" cy="80" r="2.5" fill={ZENOTE_ACCENT.magenta} />
          <circle cx="95" cy="28" r="2.5" fill={ZENOTE_ACCENT.magenta} />
          <circle cx="95" cy="80" r="2.5" fill={ZENOTE_ACCENT.magenta} />
          <circle cx="95" cy="132" r="2.5" fill={ZENOTE_ACCENT.magenta} />
        </svg>
      </div>

      {/* Right: 3 Grouped Topic Tiers (Tonal Contrast) */}
      <div className="relative z-10 flex flex-col justify-between h-full py-0.5 sm:py-1 gap-1.5 sm:gap-2.5 shrink-0 w-[42%] max-w-[130px] sm:max-w-none sm:w-46 md:w-50">
        {/* Tier 1: Active Topic (Focal Tier) */}
        <div className="flex-1 px-2 py-1 sm:px-3 sm:py-2 rounded-lg sm:rounded-xl bg-[#20182C] border border-magenta-400/40 shadow-sm flex flex-col justify-center gap-1 sm:gap-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="size-1.5 sm:size-2 rounded-full bg-magenta-400 shadow-[0_0_6px_#BE4BDB]" />
              <div className="w-12 sm:w-20 md:w-24 h-1.5 sm:h-2 rounded-full bg-magenta-300/80" />
            </div>
            <div className="w-3.5 sm:w-5 h-1 sm:h-1.5 rounded-full bg-magenta-400/30" />
          </div>
          <div className="w-3/4 h-1 sm:h-1.5 rounded-full bg-white/20 pl-3 sm:pl-4" />
        </div>

        {/* Tier 2: Supporting Topic */}
        <div className="flex-1 px-2 py-1 sm:px-3 sm:py-2 rounded-lg sm:rounded-xl bg-[#151620] border border-white/[0.12] shadow-sm flex flex-col justify-center gap-1 sm:gap-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="size-1.5 sm:size-2 rounded-full bg-neutral-300" />
              <div className="w-10 sm:w-16 md:w-20 h-1.5 sm:h-2 rounded-full bg-white/30" />
            </div>
            <div className="w-3 sm:w-4 h-1 sm:h-1.5 rounded-full bg-white/15" />
          </div>
          <div className="w-2/3 h-1 sm:h-1.5 rounded-full bg-white/15 pl-3 sm:pl-4" />
        </div>

        {/* Tier 3: Reference Shelf */}
        <div className="flex-1 px-2 py-1 sm:px-3 sm:py-2 rounded-lg sm:rounded-xl bg-[#12131A] border border-white/[0.07] opacity-80 flex flex-col justify-center gap-1 sm:gap-1.5">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="size-1.5 sm:size-2 rounded-full bg-neutral-600" />
            <div className="w-8 sm:w-14 md:w-18 h-1.5 sm:h-2 rounded-full bg-white/20" />
          </div>
          <div className="w-1/2 h-1 sm:h-1.5 rounded-full bg-white/10 pl-3 sm:pl-4" />
        </div>
      </div>
    </div>
  );
}

/**
 * 03 — EXPLORE FEATURE ILLUSTRATION
 * Communicates search and discovery: a sculpted Discovery Lens console
 * integrated with surrounding abstract note surfaces.
 *
 * Refinements:
 * - Fluid mobile sizing: the central search console adapts down to 190px without overflow.
 * - Discovery Lens badge with high-contrast search symbol and focal pink ribbon.
 * - Corner contextual note surfaces provide ambient depth without overlapping the console.
 */
export function ExploreIllustration() {
  return (
    <div
      aria-hidden="true"
      className="relative w-full h-40 sm:h-52 md:h-56 rounded-xl sm:rounded-2xl bg-[#0C0D11] border border-white/[0.08] flex items-center justify-center p-2.5 sm:p-5 md:p-6 overflow-hidden select-none"
    >
      {/* Surrounding Contextual Note Field (The Collection Being Explored) */}
      <div className="absolute inset-x-2 sm:inset-x-8 inset-y-2 sm:inset-y-4 flex flex-col justify-between pointer-events-none">
        {/* Top Note Cards */}
        <div className="flex justify-between items-start">
          <div className="px-1.5 sm:px-3 py-1 sm:py-2 rounded-md sm:rounded-lg bg-[#14151F]/70 border border-white/[0.07] w-14 sm:w-28 md:w-32 flex flex-col gap-1 sm:gap-1.5 opacity-60">
            <div className="w-8 sm:w-16 md:w-18 h-1 sm:h-1.5 rounded-full bg-white/25" />
            <div className="w-5 sm:w-9 md:w-12 h-0.5 sm:h-1.5 rounded-full bg-white/10" />
          </div>
          <div className="px-1.5 sm:px-3 py-1 sm:py-2 rounded-md sm:rounded-lg bg-[#14151F]/70 border border-white/[0.07] w-14 sm:w-28 md:w-32 flex flex-col gap-1 sm:gap-1.5 opacity-60 items-end">
            <div className="w-8 sm:w-12 md:w-16 h-1 sm:h-1.5 rounded-full bg-white/25" />
            <div className="w-5 sm:w-8 md:w-10 h-0.5 sm:h-1.5 rounded-full bg-pink-400/30" />
          </div>
        </div>

        {/* Bottom Note Cards */}
        <div className="flex justify-between items-end">
          <div className="px-1.5 sm:px-3 py-1 sm:py-2 rounded-md sm:rounded-lg bg-[#14151F]/70 border border-white/[0.07] w-14 sm:w-28 md:w-32 flex flex-col gap-1 sm:gap-1.5 opacity-60">
            <div className="w-9 sm:w-16 md:w-20 h-1 sm:h-1.5 rounded-full bg-white/20" />
            <div className="w-6 sm:w-10 md:w-12 h-0.5 sm:h-1.5 rounded-full bg-white/10" />
          </div>
          <div className="px-1.5 sm:px-3 py-1 sm:py-2 rounded-md sm:rounded-lg bg-[#14151F]/70 border border-white/[0.07] w-14 sm:w-28 md:w-32 flex flex-col gap-1 sm:gap-1.5 opacity-60 items-end">
            <div className="w-9 sm:w-14 md:w-18 h-1 sm:h-1.5 rounded-full bg-white/25" />
            <div className="w-5 sm:w-8 md:w-11 h-0.5 sm:h-1.5 rounded-full bg-white/10" />
          </div>
        </div>
      </div>

      {/* Central Discovery Console (Focal Hero) */}
      <div className="relative z-20 w-full max-w-[200px] xs:max-w-[240px] sm:max-w-md p-2 sm:p-3.5 md:p-4 rounded-xl sm:rounded-2xl bg-[#1C1422] border border-pink-500/40 shadow-md flex items-center gap-2 sm:gap-3 md:gap-4">
        {/* Discovery Lens Badge */}
        <div className="flex items-center justify-center size-7 sm:size-10 md:size-11 rounded-lg sm:rounded-xl bg-pink-500/15 border border-pink-500/35 text-pink-300 shrink-0">
          <Search className="size-3.5 sm:size-5" strokeWidth={2.25} />
        </div>

        {/* Highlighted Discovery Ribbon */}
        <div className="flex flex-col gap-1 sm:gap-1.5 flex-1 min-w-0">
          <div className="w-full h-2 sm:h-3 rounded-full bg-pink-400/90" />
          <div className="w-2/3 h-1 sm:h-2 rounded-full bg-white/25" />
        </div>

        {/* Localized Discovery Beacon */}
        <span className="size-2 sm:size-2.5 rounded-full bg-pink-400 shadow-[0_0_8px_#E85D9E] shrink-0" />
      </div>
    </div>
  );
}

/**
 * 04 — LEARN FEATURE ILLUSTRATION
 * Communicates knowledge synthesis: study and comprehension connecting through
 * a central synthesis nexus to permanent mastery and recall.
 *
 * Refinements:
 * - Fluid mobile sizing: Study node, Synthesis Nexus, and Mastery node all fit cleanly side-by-side down to 320px.
 * - Central Synthesis Core featuring Brain icon in warm gold (#D9B365).
 * - ZERO notch dots on the synthesis core perimeter.
 * - Both bridges scale smoothly via responsive SVG vectors.
 */
export function LearnIllustration() {
  return (
    <div
      aria-hidden="true"
      className="relative w-full h-40 sm:h-52 md:h-56 rounded-xl sm:rounded-2xl bg-[#0C0D11] border border-white/[0.08] flex items-center justify-between p-2 sm:p-5 md:p-6 overflow-hidden select-none"
    >
      {/* Left Station: Study & Comprehension Node */}
      <div className="relative z-10 w-[30%] max-w-[95px] sm:max-w-none sm:w-40 md:w-46 px-1.5 py-1.5 sm:px-3 sm:py-2.5 md:py-3 rounded-lg sm:rounded-xl bg-[#16151E] border border-white/[0.12] shadow-sm flex flex-col justify-between shrink-0 h-full">
        <div className="flex items-center justify-between">
          <div className="size-4.5 sm:size-6 rounded sm:rounded-lg bg-amber-400/15 border border-amber-400/25 flex items-center justify-center text-amber-300">
            <Sparkles className="size-2.5 sm:size-3.5" strokeWidth={2} />
          </div>
          <span className="size-1 sm:size-1.5 rounded-full bg-amber-400" />
        </div>

        <div className="flex flex-col gap-1 sm:gap-1.5 py-0.5 sm:py-1">
          <div className="w-full h-1.5 sm:h-2 rounded-full bg-white/30" />
          <div className="w-3/4 h-1 sm:h-1.5 rounded-full bg-white/20" />
          <div className="w-1/2 h-0.5 sm:h-1 rounded-full bg-white/10" />
        </div>

        <div className="w-6 sm:w-8 h-0.5 sm:h-1 rounded-full bg-amber-400/40" />
      </div>

      {/* Left Conduit Bridge */}
      <div className="relative flex-1 h-full mx-0.5 sm:mx-2 md:mx-3 flex items-center justify-center pointer-events-none">
        <svg
          viewBox="0 0 50 20"
          className="w-full h-3.5 sm:h-5"
          fill="none"
          preserveAspectRatio="none"
        >
          <line x1="0" y1="10" x2="50" y2="10" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" />
          <line
            x1="0"
            y1="10"
            x2="50"
            y2="10"
            stroke={ZENOTE_ACCENT.gold}
            strokeOpacity="0.75"
            strokeWidth="1.5"
            strokeDasharray="4 2"
          />
          <circle cx="25" cy="10" r="2.5" fill={ZENOTE_ACCENT.gold} />
        </svg>
      </div>

      {/* Center: Hero Knowledge Synthesis Nexus (Clean Focal Core) */}
      <div className="relative z-10 flex items-center justify-center shrink-0">
        <div className="relative size-12 sm:size-20 md:size-22 rounded-xl sm:rounded-2xl bg-[#1F1914] border border-amber-400/45 shadow-md flex items-center justify-center p-1 sm:p-3">
          <div className="flex items-center justify-center size-8 sm:size-11 md:size-12 rounded-lg sm:rounded-xl bg-amber-400/15 border border-amber-400/30 text-amber-300">
            <Brain className="size-4 sm:size-6 md:size-7" strokeWidth={2} />
          </div>
        </div>
      </div>

      {/* Right Conduit Bridge */}
      <div className="relative flex-1 h-full mx-0.5 sm:mx-2 md:mx-3 flex items-center justify-center pointer-events-none">
        <svg
          viewBox="0 0 50 20"
          className="w-full h-3.5 sm:h-5"
          fill="none"
          preserveAspectRatio="none"
        >
          <line x1="0" y1="10" x2="50" y2="10" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" />
          <line
            x1="0"
            y1="10"
            x2="50"
            y2="10"
            stroke={ZENOTE_ACCENT.gold}
            strokeOpacity="0.75"
            strokeWidth="1.5"
            strokeDasharray="4 2"
          />
          <circle cx="25" cy="10" r="2.5" fill={ZENOTE_ACCENT.gold} />
        </svg>
      </div>

      {/* Right Station: Verified Mastery & Recall Node */}
      <div className="relative z-10 w-[30%] max-w-[95px] sm:max-w-none sm:w-40 md:w-46 px-1.5 py-1.5 sm:px-3 sm:py-2.5 md:py-3 rounded-lg sm:rounded-xl bg-[#1E1A14] border border-amber-400/35 shadow-sm flex flex-col justify-between shrink-0 h-full">
        <div className="flex items-center justify-between">
          <div className="size-4.5 sm:size-6 rounded sm:rounded-lg bg-amber-400/20 border border-amber-400/35 flex items-center justify-center text-amber-300">
            <CheckCircle2 className="size-2.5 sm:size-3.5" strokeWidth={2} />
          </div>
          <span className="size-1 sm:size-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_#D9B365]" />
        </div>

        <div className="flex flex-col gap-1 sm:gap-1.5 py-0.5 sm:py-1">
          <div className="w-full h-1.5 sm:h-2 rounded-full bg-amber-400/90 shadow-[0_0_6px_rgba(217,179,101,0.35)]" />
          <div className="w-3/4 h-1 sm:h-1.5 rounded-full bg-white/25" />
        </div>

        <div className="w-6 sm:w-10 h-0.5 sm:h-1 rounded-full bg-amber-400/40" />
      </div>
    </div>
  );
}
