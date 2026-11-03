"use client";

import React from "react";
import { Mic, FileText, Clock } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { LectureRecorderVisual } from "./lecture-recorder-visual";

const EASE = [0.25, 0.1, 0.25, 1.0] as const;

export function LectureRecordingSection() {
  const shouldReduceMotion = useReducedMotion();

  const getTransition = (delay: number) => {
    if (shouldReduceMotion) {
      return { duration: 0 };
    }
    return {
      duration: 0.55,
      delay,
      ease: EASE,
    };
  };

  return (
    <section
      id="lecture-recording"
      aria-labelledby="lecture-recording-heading"
      className="relative w-full pt-12 sm:pt-16 md:pt-20 lg:pt-24 pb-8 sm:pb-10 md:pb-12 lg:pb-14 px-5 sm:px-8 md:px-12 overflow-hidden"
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 sm:gap-12 lg:gap-12 xl:gap-16 items-center">
          {/* Text Column: Eyebrow, Main Heading, Description, and Supporting Labels */}
          <motion.div
            initial={{
              opacity: shouldReduceMotion ? 1 : 0,
              y: shouldReduceMotion ? 0 : 16,
            }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={getTransition(0)}
            className="lg:col-span-5 flex flex-col text-center lg:text-left items-center lg:items-start"
          >
            {/* Eyebrow: Maname, uppercase, amber accent */}
            <p className="font-maname text-[12px] sm:text-[13px] font-medium tracking-[0.2em] uppercase text-amber-400/90 mb-3 sm:mb-3.5">
              LECTURE INTELLIGENCE
            </p>

            {/* Main Heading: Noto Serif Variable, editorial serif contrast */}
            <h2
              id="lecture-recording-heading"
              className="font-noto text-[30px] sm:text-[38px] md:text-[42px] lg:text-[45px] font-[650] leading-[1.16] tracking-[0.01em] text-white text-balance max-w-[340px] sm:max-w-md lg:max-w-xl mb-4 sm:mb-4.5"
            >
              Your lectures, captured and understood.
            </h2>

            {/* Supporting Description: Maname */}
            <p className="font-maname text-[15px] sm:text-[16px] md:text-[16.5px] font-normal leading-[1.68] text-neutral-400 text-pretty max-w-[360px] sm:max-w-md lg:max-w-lg mb-6 sm:mb-7">
              Record lectures directly in Zenote and turn spoken explanations into searchable text you can revisit whenever you need.
            </p>

            {/* Supporting Feature Labels: Refined monochrome icons */}
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2 pt-1 text-[12px] sm:text-[13px] text-neutral-300">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 font-maname leading-none">
                <Mic className="size-3.5 shrink-0 text-violet-300/70" strokeWidth={1.75} aria-hidden="true" />
                <span className="relative -top-[2px]">Direct Recording</span>
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 font-maname leading-none">
                <FileText className="size-3.5 shrink-0 text-violet-300/70" strokeWidth={1.75} aria-hidden="true" />
                <span className="relative -top-[2px]">Transcription</span>
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 font-maname leading-none">
                <Clock className="size-3.5 shrink-0 text-violet-300/70" strokeWidth={1.75} aria-hidden="true" />
                <span className="relative -top-[2px]">Revisit Anytime</span>
              </span>
            </div>
          </motion.div>

          {/* Visual Column: Refined Lecture Recorder Visual Centerpiece */}
          <motion.div
            initial={{
              opacity: shouldReduceMotion ? 1 : 0,
              y: shouldReduceMotion ? 0 : 18,
            }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={getTransition(0.1)}
            className="lg:col-span-7 flex justify-center items-center w-full mt-2 sm:mt-4 lg:mt-0"
          >
            <LectureRecorderVisual />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

export default LectureRecordingSection;
