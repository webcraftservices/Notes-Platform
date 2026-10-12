"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import LinesGradientShader from "./zenote-shader-background";

export default function ZenoteWelcomeContent() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden bg-graphite-950 flex flex-col justify-center items-center font-sans text-paper">
      {/* Background Shader Layer */}
      <LinesGradientShader className="z-0" />

      {/* Subtle overlay to ensure text contrast against active shader */}
      <div className="absolute inset-0 bg-graphite-950/20 z-[1] pointer-events-none" />

      {/* Foreground UI Layer */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-[100dvh] w-full px-6 py-12 safe-area-y">
        
        {/* Style block for entrance animations */}
        <style>{`
          @keyframes welcome-fade-up {
            from { 
              opacity: 0;
              transform: translateY(12px);
            }
            to { 
              opacity: 1;
              transform: translateY(0);
            }
          }
          
          .welcome-animate-logo {
            opacity: 0;
            animation: welcome-fade-up 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) 0.1s forwards;
          }
          
          .welcome-animate-headline {
            opacity: 0;
            animation: welcome-fade-up 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) 0.3s forwards;
          }
          
          .welcome-animate-text {
            opacity: 0;
            animation: welcome-fade-up 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) 0.5s forwards;
          }
          
          .welcome-animate-button {
            opacity: 0;
            animation: welcome-fade-up 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) 0.7s forwards;
          }

          @media (prefers-reduced-motion: reduce) {
            .welcome-animate-logo,
            .welcome-animate-headline,
            .welcome-animate-text,
            .welcome-animate-button {
              animation: none !important;
              opacity: 1 !important;
              transform: none !important;
            }
          }
        `}</style>

        {/* Central Content Block */}
        <div className="flex flex-col items-center text-center w-full max-w-2xl mx-auto">
          
          {/* Logo Section */}
          <div className="welcome-animate-logo flex justify-center items-center mb-12 sm:mb-16">
            {mounted && (
              <Image
                src="/zenote-logo-transparent.png"
                alt="Zenote"
                width={170}
                height={170}
                priority
                className="w-[135px] sm:w-[170px] h-auto object-contain"
              />
            )}
          </div>

          {/* Typography Section */}
          <div className="flex flex-col items-center space-y-5 sm:space-y-6 mb-12 sm:mb-16">
            <h1 className="welcome-animate-headline text-4xl sm:text-5xl lg:text-6xl font-display font-medium tracking-tight text-white leading-[1.15] sm:leading-[1.1] max-w-lg drop-shadow-sm">
              Your knowledge,<br />in one place.
            </h1>
            <p className="welcome-animate-text text-[17px] sm:text-xl text-paper/70 font-sans tracking-wide max-w-[280px] sm:max-w-md">
              One calm place for everything<br className="sm:hidden" /> you learn.
            </p>
          </div>

          {/* CTA Button */}
          <div className="welcome-animate-button w-full flex justify-center">
            <Link
              href="/welcome/intro"
              className="group relative inline-flex items-center justify-center gap-2 w-[190px] sm:w-[210px] h-[52px] sm:h-[56px] rounded-full overflow-hidden transition-all duration-500 ease-out active:scale-[0.98] hover:shadow-[0_4px_32px_rgba(0,0,0,0.4)] bg-graphite-900/60 backdrop-blur-md border border-white/[0.08]"
            >
              {/* Subtle hover overlay */}
              <div className="absolute inset-0 bg-white/0 transition-colors duration-300 group-hover:bg-white/[0.03]" />
              
              <span className="relative z-10 text-[15px] sm:text-base text-paper font-medium tracking-wide">
                Get started
              </span>
              <ArrowRight className="relative z-10 w-4 h-4 text-paper/80 group-hover:translate-x-1 group-hover:text-paper transition-transform duration-300" />
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
