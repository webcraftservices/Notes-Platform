"use client";

import React, { useState } from "react";
import { motion, type Variants } from "motion/react";
import { cn } from "@/lib/utils";

const CARD_SPACING = 32;

type HeroCard = {
  activeSrc: string;
  left: string;
  showIdleSwap?: boolean;
  className?: string;
};

const HERO_CARDS: HeroCard[] = [
  {
    activeSrc: "https://assets.aceternity.com/labs/1.webp",
    left: "left-[32px]",
  },
  {
    activeSrc: "https://assets.aceternity.com/labs/2.webp",
    left: "left-[64px]",
  },
  {
    activeSrc: "https://assets.aceternity.com/labs/3.webp",
    left: "left-[96px]",
  },
  {
    activeSrc: "https://assets.aceternity.com/labs/4.webp",
    left: "left-[128px]",
  },
  {
    activeSrc: "https://assets.aceternity.com/labs/5.webp",
    left: "left-[160px]",
    showIdleSwap: false,
    className: "transition-opacity duration-300",
  },
];

type SpringConfig = {
  type: "spring";
  bounce?: number;
  visualDuration?: number;
  stiffness?: number;
  damping?: number;
  mass?: number;
};

const defaultSpring: SpringConfig = {
  type: "spring",
  visualDuration: 0.5,
  bounce: 0.2,
};

export interface FeyCardsProps {
  spring?: SpringConfig;
  shiftDistance?: number;
  swapDuration?: number;
  entranceStagger?: number;
  className?: string;
}

export const controls = {
  spring: defaultSpring,
  shiftDistance: [60, 0, 200, 5],
  swapDuration: [0.5, 0, 2, 0.05],
  entranceStagger: [0.1, 0, 0.5, 0.01],
};

export const FeyCards = ({
  spring = defaultSpring,
  shiftDistance = 60,
  swapDuration = 0.5,
  entranceStagger = 0.2,
  className,
}: FeyCardsProps = {}) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const swapStyle = { transitionDuration: `${swapDuration}s` };

  const containerVariants: Variants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: entranceStagger,
        staggerDirection: -1,
      },
    },
  };

  const cardVariants: Variants = {
    hidden: (offset: number) => ({ x: offset }),
    visible: { x: 0, transition: spring },
  };

  return (
    <div
      className={cn(
        "relative flex w-full items-center justify-center overflow-visible",
        className
      )}
    >
      <div
        onPointerLeave={() => setActiveIndex(null)}
        style={{ mixBlendMode: "lighten" }}
        className="relative flex items-center justify-center scale-[0.76] min-[390px]:scale-[0.84] sm:scale-95 md:scale-100 lg:scale-[0.88] xl:scale-100 origin-center select-none"
      >
        <motion.div
          className="relative flex h-120 w-80 mask-b-from-10%"
          style={{ mixBlendMode: "lighten" }}
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <img
            src="https://assets.aceternity.com/labs/main.webp"
            alt="Hero"
            width={1000}
            height={1000}
            className="pointer-events-none absolute inset-y-0 left-0 h-120 w-40 object-contain"
          />

          {HERO_CARDS.map((card, index) => {
            const shouldShift = activeIndex !== null && index > activeIndex;
            const isActive = activeIndex === index;
            const entranceOffset = -index * CARD_SPACING;
            return (
              <motion.div
                key={card.activeSrc}
                className={cn(
                  "group absolute -bottom-2 z-20 h-120 w-40 cursor-pointer touch-manipulation outline-none",
                  card.left,
                  card.className
                )}
                variants={cardVariants}
                custom={entranceOffset}
                onPointerEnter={() => setActiveIndex(index)}
                onClick={() =>
                  setActiveIndex((current) =>
                    current === index ? null : index
                  )
                }
                role="button"
                tabIndex={0}
                aria-label={`Card ${index + 1}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveIndex((current) =>
                      current === index ? null : index
                    );
                  }
                }}
              >
                <motion.div
                  className="relative h-full w-full"
                  animate={{ x: shouldShift ? shiftDistance : 0 }}
                  transition={spring}
                >
                  {card.showIdleSwap !== false ? (
                    <>
                      <img
                        src={card.activeSrc}
                        alt="Hero"
                        width={1000}
                        height={1000}
                        style={swapStyle}
                        className={cn(
                          "pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity ease-in-out",
                          isActive ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <img
                        src="https://assets.aceternity.com/labs/idle.webp"
                        alt="Hero idle"
                        width={1000}
                        height={1000}
                        style={swapStyle}
                        className={cn(
                          "pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity ease-in-out",
                          isActive ? "opacity-0" : "opacity-100"
                        )}
                      />
                      <div className="pointer-events-none absolute top-8 left-2 z-50 h-[calc(100%-2rem)] w-4 bg-black/60 blur-md" />
                    </>
                  ) : (
                    <img
                      src={card.activeSrc}
                      alt="Hero"
                      width={1000}
                      height={1000}
                      style={swapStyle}
                      className="pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity ease-in-out"
                    />
                  )}
                </motion.div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </div>
  );
};

export default FeyCards;
