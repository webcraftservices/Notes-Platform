"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Download } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ShineBorder } from "@/registry/magicui/shine-border";

const DOWNLOAD_URL = process.env.NEXT_PUBLIC_ZENOTE_DOWNLOAD_URL?.trim() || null;
const EASE = [0.25, 0.1, 0.25, 1.0] as const;

export function IntroHero() {
  const shouldReduceMotion = useReducedMotion();
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);

  const getTransition = (delay: number) => {
    if (shouldReduceMotion) {
      return { duration: 0 };
    }
    return {
      duration: 0.5,
      delay,
      ease: EASE,
    };
  };

  return (
    <section
      aria-labelledby="intro-hero-heading"
      className="relative w-full min-h-screen min-h-[100svh] min-h-[100dvh] flex flex-col items-center justify-center px-6 sm:px-8 pt-8 sm:pt-10 md:pt-12 pb-14 sm:pb-18 md:pb-20 overflow-hidden font-maname"
    >
      <div className="relative z-20 flex flex-col items-center text-center mx-auto w-full max-w-[500px] sm:max-w-xl md:max-w-2xl my-auto -translate-y-2 sm:translate-y-0">
        {/* 1. Zenote Logo and Wordmark: Upper central composition */}
        <motion.div
          initial={{ opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={getTransition(0)}
          className="mb-7 sm:mb-8 md:mb-8.5 flex items-center justify-center"
        >
          <Image
            src="/zenote-logo-transparent.png"
            alt="Zenote Logo"
            width={185}
            height={185}
            priority
            className="w-[185px] sm:w-[210px] md:w-[235px] h-auto object-contain drop-shadow-sm select-none"
          />
        </motion.div>

        {/* 2. Main Heading: Noto Serif Variable, uppercase "MEET ZENOTE.", editorial serif contrast */}
        <motion.h1
          id="intro-hero-heading"
          initial={{ opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={getTransition(0.1)}
          className="font-noto text-[38px] sm:text-[46px] md:text-[52px] font-[650] leading-[1.1] tracking-[0.02em] text-white mb-2.5 sm:mb-3"
        >
          MEET ZENOTE.
        </motion.h1>

        {/* 3. Supporting Heading: Maname, calm, clear hierarchy */}
        <motion.p
          initial={{ opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={getTransition(0.2)}
          className="font-maname text-[18px] sm:text-[19px] md:text-[20px] font-normal leading-[1.4] tracking-normal text-neutral-300 mb-5 sm:mb-5.5 md:mb-6 text-balance max-w-xl"
        >
          A calm place for everything you learn.
        </motion.p>

        {/* 4. Description Paragraph: Maname Regular, comfortable line height, readable muted contrast */}
        <motion.p
          initial={{ opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={getTransition(0.3)}
          className="font-maname max-w-[480px] text-[14.5px] sm:text-[15px] md:text-[15.5px] font-normal leading-[1.7] tracking-normal text-neutral-400 text-pretty"
        >
          Zenote brings your notes, study materials, documents and ideas together
          in one organized space — so you can spend less time managing
          information and more time learning from it.
        </motion.p>

        {/* 5 & 6. Action Buttons: Manrope Medium labels, 18px gap, luminous animated borders */}
        <motion.div
          initial={{ opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={getTransition(0.4)}
          className="mt-7 sm:mt-7.5 md:mt-8 flex w-full flex-col sm:flex-row items-center justify-center gap-[18px] sm:gap-4 max-w-[340px] sm:max-w-none"
        >
          {/* Primary Action: Use Zenote Online */}
          <Link
            href="/"
            className="group relative inline-flex h-[50px] w-full sm:w-auto items-center justify-center gap-2.5 rounded-[14px] overflow-hidden bg-gradient-to-b from-[#1C1D27] to-[#12131A] px-6 text-[15px] font-medium leading-[1.2] text-white shadow-[0_2px_12px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.12)] border border-white/[0.08] transition-all duration-200 hover:from-[#222430] hover:to-[#161720] hover:shadow-[0_4px_20px_rgba(160,124,254,0.2)] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0C] font-manrope"
          >
            <ShineBorder
              borderWidth={1.5}
              duration={8}
              shineColor={["#A07CFE", "#FE8FB5", "#FFBE7B"]}
            />
            <span className="relative z-10 tracking-[-0.01em]">Use Zenote Online</span>
            <ArrowRight className="relative z-10 h-4 w-4 text-white/90 transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
          </Link>

          {/* Secondary Action: Download Zenote with synchronized animated border */}
          {DOWNLOAD_URL ? (
            <a
              href={DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative inline-flex h-[50px] w-full sm:w-auto items-center justify-center gap-2.5 rounded-[14px] overflow-hidden bg-gradient-to-b from-[#161720]/80 to-[#0F1015]/90 px-6 text-[15px] font-medium leading-[1.2] text-neutral-300 shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.06)] border border-white/[0.06] transition-all duration-200 hover:from-[#1C1D28] hover:to-[#13141B] hover:text-white hover:border-white/[0.12] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0C] font-manrope"
            >
              <ShineBorder
                borderWidth={1.5}
                duration={8}
                shineColor={["#A07CFE", "#FE8FB5", "#FFBE7B"]}
              />
              <Download className="relative z-10 h-4 w-4 text-neutral-400 transition-colors duration-200 group-hover:text-neutral-200" />
              <span className="relative z-10 tracking-[-0.01em]">Download Zenote</span>
            </a>
          ) : (
            <button
              type="button"
              onClick={() => setDownloadModalOpen(true)}
              className="group relative inline-flex h-[50px] w-full sm:w-auto items-center justify-center gap-2.5 rounded-[14px] overflow-hidden bg-gradient-to-b from-[#161720]/80 to-[#0F1015]/90 px-6 text-[15px] font-medium leading-[1.2] text-neutral-300 shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.06)] border border-white/[0.06] transition-all duration-200 hover:from-[#1C1D28] hover:to-[#13141B] hover:text-white hover:border-white/[0.12] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0C] font-manrope"
            >
              <ShineBorder
                borderWidth={1.5}
                duration={8}
                shineColor={["#A07CFE", "#FE8FB5", "#FFBE7B"]}
              />
              <Download className="relative z-10 h-4 w-4 text-neutral-400 transition-colors duration-200 group-hover:text-neutral-200" />
              <span className="relative z-10 tracking-[-0.01em]">Download Zenote</span>
            </button>
          )}
        </motion.div>
      </div>

      {/* Honest download status dialog */}
      <Dialog open={downloadModalOpen} onOpenChange={setDownloadModalOpen}>
        <DialogContent
          title="Zenote for Desktop"
          description="Desktop application status"
          className="max-w-md border border-white/10 bg-[#14151B] text-white p-6 rounded-2xl font-maname"
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left">
              <p className="text-sm font-normal text-neutral-200">
                Native desktop apps for macOS and Windows are currently in active
                development.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                Zenote is fully available right now as a web app with all
                features including notes, document reading, and AI intelligence.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
              <Link
                href="/"
                onClick={() => setDownloadModalOpen(false)}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-normal text-graphite-950 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              >
                <span>Launch Zenote Online</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
              <button
                type="button"
                onClick={() => setDownloadModalOpen(false)}
                className="inline-flex h-10 w-full sm:w-auto items-center justify-center rounded-xl border border-white/10 px-4 text-sm font-normal text-neutral-400 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
              >
                Dismiss
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
