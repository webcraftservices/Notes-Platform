"use client";

import React from "react";
import { motion, useReducedMotion } from "motion/react";
// @ts-expect-error - JSX component without types
import FolderTransfer from "./intro/folder-transfer";

const EASE = [0.25, 0.1, 0.25, 1.0] as const;

export function UploadSection() {
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
      id="upload-materials"
      aria-labelledby="upload-materials-heading"
      className="relative w-full py-16 sm:py-20 md:py-24 lg:py-28 px-5 sm:px-8 md:px-12 overflow-hidden"
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 sm:gap-10 lg:gap-12 xl:gap-16 items-center">
          {/* Text Column: Eyebrow, Main Heading, and Description */}
          <motion.div
            initial={{ opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={getTransition(0)}
            className="lg:col-span-5 flex flex-col text-center lg:text-left items-center lg:items-start"
          >
            {/* Eyebrow */}
            <p className="font-maname text-[12px] sm:text-[13px] font-medium tracking-[0.2em] uppercase text-amber-400/90 mb-3 sm:mb-3.5">
              YOUR MATERIALS, ONE HOME
            </p>

            {/* Main Heading: Noto Serif Variable */}
            <h2
              id="upload-materials-heading"
              className="font-noto text-[30px] sm:text-[38px] md:text-[42px] lg:text-[45px] font-[650] leading-[1.16] tracking-[0.01em] text-white text-balance max-w-[340px] sm:max-w-md lg:max-w-xl mb-4 sm:mb-4.5"
            >
              Everything you need to learn, all in one place.
            </h2>

            {/* Description: Maname */}
            <p className="font-maname text-[15px] sm:text-[16px] md:text-[16.5px] font-normal leading-[1.68] text-neutral-400 text-pretty max-w-[360px] sm:max-w-md lg:max-w-lg">
              Bring your notes, PDFs, presentations, documents, and other study
              materials into Zenote. Keep your resources together instead of
              scattered across different folders and apps.
            </p>
          </motion.div>

          {/* Illustration Column: FolderTransfer directly on canvas without frame or halo */}
          <motion.div
            initial={{ opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={getTransition(0.1)}
            className="lg:col-span-7 flex items-center justify-center w-full mt-4 sm:mt-6 lg:mt-0"
          >
            <FolderTransfer className="w-full max-w-[540px] sm:max-w-[580px] lg:max-w-[640px]" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
