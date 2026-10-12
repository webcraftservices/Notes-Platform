"use client";
import React from "react";
import Image from "next/image";
import {
  motion,
  useScroll,
  useTransform,
  MotionValue,
  useReducedMotion,
} from "motion/react";
import { cx, ZENOTE_GRADIENT_CSS } from "./shared";
import type { ScreenItem } from "./placeholder-data";
import { Dialog, DialogTrigger, DialogContent } from "@/components/ui/dialog";

// Hook to get window size for precise mobile calculations
const useWindowSize = () => {
  const [windowSize, setWindowSize] = React.useState({
    width: 0,
    height: 0,
  });

  React.useEffect(() => {
    function handleResize() {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }
    handleResize(); // Initialize on mount
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return windowSize;
};

export const HeroParallax = ({
  items,
  header,
}: {
  items: ScreenItem[];
  header?: React.ReactNode;
}) => {
  // We need 28 items for 4 rows of 7 cards to ensure continuous tracks without gaps
  const products = [
    ...items,
    ...items,
    ...items,
    ...items,
  ].slice(0, 28);

  const firstRow = products.slice(0, 7);
  const secondRow = products.slice(7, 14);
  const thirdRow = products.slice(14, 21);
  const fourthRow = products.slice(21, 28);

  const ref = React.useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  const { width: W } = useWindowSize();
  // If W === 0 (SSR), assume desktop to prevent mobile layout on server
  const isMobile = W > 0 && W < 768;

  // Calculate precise translations for mobile centering
  const cardWidth = isMobile ? Math.min(320, W * 0.8) : 480;
  const gap = isMobile ? 40 : 80; // space-x-10 vs space-x-20
  const step = cardWidth + gap;

  // Stagger shift so the 4 rows take turns passing through the center.
  // We divide the card-to-card distance by 4 to perfectly offset the 4 rows.
  const stagger = isMobile ? step / 4 : 0;
  
  // Total travel distance: 3 full card steps + 3 stagger delays
  // This ensures 4 cards hit the center sequentially during the scroll
  const totalTravel = isMobile ? 3 * step + 3 * stagger : 1000;

  // flex-row-reverse (Rows 1 & 3): Card 0 is rightmost.
  // Base start X to perfectly center Card 1 at t=0
  const baseStartX_Reverse = isMobile ? (cardWidth / 2 - W / 2 + step) : 0;
  
  // flex-row (Rows 2 & 4): Card 0 is leftmost.
  // Base start X to perfectly center Card 1 at t=0
  const baseStartX_Normal = isMobile ? (W / 2 - cardWidth / 2 - step) : 0;

  // Row 1 moves right (translation increases). No stagger delay.
  const startX1 = baseStartX_Reverse;
  const endX1 = isMobile ? startX1 + totalTravel : 1000;

  // Row 2 moves left (translation decreases). Delayed by 1 stagger (starts further right).
  const startX2 = baseStartX_Normal + stagger;
  const endX2 = isMobile ? startX2 - totalTravel : -1000;

  // Row 3 moves right. Delayed by 2 staggers (starts further left).
  const startX3 = baseStartX_Reverse - 2 * stagger;
  const endX3 = isMobile ? startX3 + totalTravel : 1000;

  // Row 4 moves left. Delayed by 3 staggers (starts further right).
  const startX4 = baseStartX_Normal + 3 * stagger;
  const endX4 = isMobile ? startX4 - totalTravel : -1000;

  // Use raw transforms for 1:1 scroll responsiveness, now fully staggered and continuous
  const translateX1 = useTransform(scrollYProgress, [0, 1], [startX1, endX1]);
  const translateX2 = useTransform(scrollYProgress, [0, 1], [startX2, endX2]);
  const translateX3 = useTransform(scrollYProgress, [0, 1], [startX3, endX3]);
  const translateX4 = useTransform(scrollYProgress, [0, 1], [startX4, endX4]);
  
  const rotateX = useTransform(scrollYProgress, [0, 0.2], [15, 0]);
  const opacity = useTransform(scrollYProgress, [0, 0.2], [0.2, 1]);
  const rotateZ = useTransform(scrollYProgress, [0, 0.2], [20, 0]);
  const translateY = useTransform(scrollYProgress, [0, 0.2], [-700, 500]);

  const shouldReduceMotion = useReducedMotion();

  // Removed reduceMotion fallback to ensure the actual mobile scroll animation remains active and doesn't swap to a static grid.

  return (
    <div
      ref={ref}
      // Modified height from 300vh to 350vh to accommodate the fourth row
      className="h-[350vh] py-40 overflow-hidden antialiased relative flex flex-col self-auto [perspective:1000px] [transform-style:preserve-3d]"
    >
      <Header content={header} />
      <motion.div
        initial={{ opacity: shouldReduceMotion ? 1 : 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.2, delay: shouldReduceMotion ? 0 : 1.1, ease: [0.25, 0.1, 0.25, 1.0] }}
        className="w-full"
      >
        <motion.div
          style={{
            rotateX,
            rotateZ,
            translateY,
            opacity,
          }}
          className="w-full"
        >
          <motion.div className="flex flex-row-reverse space-x-reverse space-x-10 md:space-x-20 mb-10 md:mb-20 w-full">
          {firstRow.map((product, idx) => (
            <ProductCard
              product={product}
              translate={translateX1}
              key={`${product.id}-${idx}`}
            />
          ))}
        </motion.div>
        <motion.div className="flex flex-row space-x-10 md:space-x-20 mb-10 md:mb-20 w-full">
          {secondRow.map((product, idx) => (
            <ProductCard
              product={product}
              translate={translateX2}
              key={`${product.id}-${idx}`}
            />
          ))}
        </motion.div>
        <motion.div className="flex flex-row-reverse space-x-reverse space-x-10 md:space-x-20 mb-10 md:mb-20 w-full">
          {thirdRow.map((product, idx) => (
            <ProductCard
              product={product}
              translate={translateX3}
              key={`${product.id}-${idx}`}
            />
          ))}
        </motion.div>
        <motion.div className="flex flex-row space-x-10 md:space-x-20 mb-10 md:mb-20 w-full">
          {fourthRow.map((product, idx) => (
            <ProductCard
              product={product}
              translate={translateX4}
              key={`${product.id}-${idx}`}
            />
          ))}
        </motion.div>
      </motion.div>
      </motion.div>
    </div>
  );
};

export const Header = ({ content }: { content?: React.ReactNode }) => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className="max-w-7xl relative mx-auto py-20 md:py-40 px-[6vw] md:px-8 w-full left-0 top-0">
      {content ? (
        content
      ) : (
        <div className="max-w-3xl relative z-20 flex flex-col items-center text-center mx-auto mt-8 md:mt-16">
          <motion.div
            initial={{ opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1.0] }}
            className="mb-6 md:mb-10"
          >
            <Image 
              src="/zenote-logo-transparent.png" 
              alt="Zenote Logo" 
              width={160} 
              height={53} 
              className="w-28 md:w-36 h-auto object-contain drop-shadow-sm"
              priority
            />
          </motion.div>
          <motion.h1
            initial={{ opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: shouldReduceMotion ? 0 : 0.2, ease: [0.25, 0.1, 0.25, 1.0] }}
            className="text-[2.25rem] md:text-5xl lg:text-7xl font-semibold leading-[1.05] tracking-tight text-white mb-4"
          >
            Meet Zenote.
          </motion.h1>
          <motion.p
            initial={{ opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: shouldReduceMotion ? 0 : 0.4, ease: [0.25, 0.1, 0.25, 1.0] }}
            className="text-xl md:text-2xl lg:text-3xl font-medium tracking-tight text-neutral-200 mb-6 drop-shadow-sm"
          >
            A calm place for everything you learn.
          </motion.p>
          <motion.p
            initial={{ opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: shouldReduceMotion ? 0 : 0.55, ease: [0.25, 0.1, 0.25, 1.0] }}
            className="max-w-xl text-base md:text-lg text-neutral-400 font-normal leading-relaxed"
          >
            Zenote brings your notes, study materials, documents and ideas together in one organized space — so you can spend less time managing information and more time learning from it.
          </motion.p>
        </div>
      )}
    </div>
  );
};

export const ProductCard = ({
  product,
  translate,
}: {
  product: ScreenItem;
  translate: MotionValue<number>;
}) => {
  return (
    <Dialog>
      <motion.div
        style={{
          x: translate,
        }}
        key={product.id}
        className="group/product h-64 md:h-96 w-[20rem] md:w-[30rem] relative flex-shrink-0 max-w-[80vw]"
      >
        <DialogTrigger asChild>
          <button className="block h-full w-full appearance-none text-left p-0 border-0 bg-transparent cursor-pointer hover:scale-[1.01] transition-transform duration-500 ease-out outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded-xl md:rounded-2xl group-hover/product:shadow-[0_0_30px_rgba(255,255,255,0.05)]">
            <ScreenFrame item={product} />
          </button>
        </DialogTrigger>
      </motion.div>
      <DialogContent 
        title={product.label} 
        description={`Card ${product.id}`}
        className="max-w-4xl w-[90vw] md:w-full bg-[#1a1a1d] border-white/10 dark:bg-[#1a1a1d] dark:border-white/10 p-4 md:p-6"
      >
        <PreviewImage item={product} />
      </DialogContent>
    </Dialog>
  );
};

/* -------------------------------------------------------------------------- */
/* PreviewImage — full-size preview with fallback                             */
/* -------------------------------------------------------------------------- */
function PreviewImage({ item }: { item: ScreenItem }) {
  const [imgLoaded, setImgLoaded] = React.useState(false);
  const [imgError, setImgError] = React.useState(false);

  return (
    <div className="relative w-full aspect-[4/5] md:aspect-video rounded-md md:rounded-lg overflow-hidden bg-neutral-900 border border-white/10">
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-neutral-800 via-neutral-850 to-neutral-900">
        <span
          className="text-4xl font-semibold tabular-nums md:text-6xl"
          style={{
            background: ZENOTE_GRADIENT_CSS,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          {item.id}
        </span>
        <span className="mt-2 text-sm font-medium tracking-wide text-neutral-500 md:text-xl">
          {item.label}
        </span>
      </div>
      
      {!imgError && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image}
          alt="" 
          loading="lazy"
          decoding="async"
          draggable={false}
          className={cx(
            "absolute inset-0 z-10 h-full w-full select-none object-contain transition-opacity duration-500",
            imgLoaded ? "opacity-100" : "opacity-0"
          )}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* ScreenFrame — individual product card with fallback                        */
/* -------------------------------------------------------------------------- */
function ScreenFrame({ item, className }: { item: ScreenItem; className?: string }) {
  const [imgLoaded, setImgLoaded] = React.useState(false);
  const [imgError, setImgError] = React.useState(false);

  return (
    <figure
      className={cx(
        "relative m-0 overflow-hidden rounded-xl border border-white/5 bg-[#141416] p-1 shadow-[0_8px_32px_rgba(0,0,0,0.4)] md:rounded-2xl md:p-1.5 h-full w-full after:absolute after:inset-0 after:rounded-xl md:after:rounded-2xl after:ring-1 after:ring-inset after:ring-white/[0.08] after:pointer-events-none",
        className
      )}
    >
      <div className="relative h-full w-full overflow-hidden rounded-lg bg-neutral-900 md:rounded-xl ring-1 ring-inset ring-black/50">
        {/* Stable Fallback Background */}
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-neutral-800 via-neutral-850 to-neutral-900">
          <span
            className="text-2xl font-semibold tabular-nums md:text-3xl"
            style={{
              background: ZENOTE_GRADIENT_CSS,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            {item.id}
          </span>
          <span className="mt-1 text-xs font-medium tracking-wide text-neutral-500 md:text-sm">
            {item.label}
          </span>
        </div>
        
        {/* Actual Image overlay - fades in only when loaded, hidden on error */}
        {!imgError && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.image}
            alt="" // Removed alt to prevent browser from showing raw text while loading/broken
            loading="lazy"
            decoding="async"
            draggable={false}
            className={cx(
              "absolute inset-0 z-10 h-full w-full select-none object-cover transition-opacity duration-500",
              imgLoaded ? "opacity-100" : "opacity-0"
            )}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
        )}
      </div>
    </figure>
  );
}

