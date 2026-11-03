"use client";

import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { FeyCards } from "./fey-cards";

const EASE = [0.25, 0.1, 0.25, 1.0] as const;

export function OrganizeExploreSection() {
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
      id="organize-and-explore"
      aria-labelledby="organize-explore-heading"
      className="relative w-full py-16 sm:py-20 md:py-24 lg:py-28 px-5 sm:px-8 md:px-12 overflow-hidden"
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 sm:gap-12 lg:gap-12 xl:gap-16 items-center">
          {/* Text Column: Eyebrow, Main Heading, and Supporting Text (Text appears first on mobile) */}
          <motion.div
            initial={{
              opacity: shouldReduceMotion ? 1 : 0,
              y: shouldReduceMotion ? 0 : 16,
            }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "100px" }}
            transition={getTransition(0)}
            className="lg:col-span-5 flex flex-col text-center lg:text-left items-center lg:items-start"
          >
            {/* Eyebrow: Maname, uppercase, tracking, amber accent */}
            <p className="font-maname text-[12px] sm:text-[13px] font-medium tracking-[0.2em] uppercase text-amber-400/90 mb-3 sm:mb-3.5">
              ORGANIZE &amp; EXPLORE
            </p>

            {/* Main Heading: Noto Serif Variable, editorial serif */}
            <h2
              id="organize-explore-heading"
              className="font-noto text-[30px] sm:text-[38px] md:text-[42px] lg:text-[45px] font-[650] leading-[1.16] tracking-[0.01em] text-white text-balance max-w-[340px] sm:max-w-md lg:max-w-xl mb-4 sm:mb-4.5"
            >
              Find clarity in everything you collect.
            </h2>

            {/* Supporting Description: Maname */}
            <p className="font-maname text-[15px] sm:text-[16px] md:text-[16.5px] font-normal leading-[1.68] text-neutral-400 text-pretty max-w-[360px] sm:max-w-md lg:max-w-lg">
              Bring your learning materials together in an organized space,
              making it easier to browse, revisit, and explore the knowledge you
              collect.
            </p>
          </motion.div>

          {/* Visual Column: Fey Cards Animation */}
          <div className="lg:col-span-7 flex justify-center items-center w-full">
            <FeyCards />
          </div>
        </div>
      </div>
    </section>
  );
}

export default OrganizeExploreSection;
