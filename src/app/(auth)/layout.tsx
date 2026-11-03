import Image from "next/image";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:h-screen lg:max-h-screen w-full bg-[#0A0A0E] text-white selection:bg-accent/30 selection:text-white flex flex-col justify-between">
      {/* 2-Column Split: Authentication Column & Editorial Canvas Column */}
      <div className="grid flex-1 w-full lg:grid-cols-12 min-h-0">
        {/* Left Column: Focused, calm authentication form */}
        <div className="flex flex-col justify-center px-6 py-6 sm:px-10 lg:col-span-5 lg:px-10 xl:col-span-5 xl:px-14 2xl:px-18 relative z-10 min-h-0 overflow-y-auto">
          <div className="w-full max-w-[360px] mx-auto my-auto py-2">
            {/* Header: Centered official Zenote logo */}
            <header className="flex justify-center mb-4 sm:mb-5">
              <Link
                href="/welcome"
                className="group inline-flex items-center justify-center rounded-xl transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="Back to Zenote welcome"
              >
                <Image
                  src="/zenote-logo-transparent.png"
                  alt="Zenote"
                  width={76}
                  height={76}
                  priority
                  className="h-[70px] w-[70px] sm:h-[76px] sm:w-[76px] object-contain select-none"
                />
              </Link>
            </header>

            {/* Main Form Area */}
            <main className="w-full">
              {children}
            </main>
          </div>
        </div>

        {/* Right Column: Inset animated gradient editorial canvas */}
        <div className="hidden lg:flex lg:col-span-7 xl:col-span-7 p-3.5 sm:p-5 lg:p-5 xl:p-6 2xl:p-7 flex-col min-h-0 select-none">
          {/* Framed Inset Canvas: Clean vertical flex layout */}
          <div className="relative flex-1 min-h-0 w-full rounded-[24px] xl:rounded-[28px] overflow-hidden border border-white/[0.08] shadow-[0_20px_50px_rgba(0,0,0,0.65),inset_0_1px_0_0_rgba(255,255,255,0.12)] flex flex-col justify-end p-6 sm:p-8 xl:p-10 bg-[#0C0D12]">
            {/* Layer 1: Animated Gradient Atmosphere (Balanced Warm Amber & Cool Violet/Sage) */}
            {/* Deep obsidian base */}
            <div className="pointer-events-none absolute inset-0 bg-[#0C0D12]" aria-hidden="true" />

            {/* Primary luminous warm champagne/amber glowing body */}
            <div
              className="pointer-events-none absolute -left-16 bottom-8 h-[520px] w-[560px] rounded-full bg-gradient-to-tr from-[#D97706]/60 via-[#E5B869]/45 via-[#FBBF24]/30 to-transparent blur-[80px] animate-auth-champagne"
              aria-hidden="true"
            />

            {/* Secondary ambient golden wash across mid-left canvas */}
            <div
              className="pointer-events-none absolute left-4 top-1/4 h-[420px] w-[440px] rounded-full bg-[radial-gradient(circle,rgba(245,158,11,0.35)_0%,rgba(217,119,6,0.2)_40%,transparent_70%)] blur-[60px]"
              aria-hidden="true"
            />

            {/* Atmospheric smoky sage & violet dusk gradient across top-right canvas */}
            <div
              className="pointer-events-none absolute -right-16 -top-16 h-[520px] w-[520px] rounded-full bg-gradient-to-bl from-[#7C6CF0]/35 via-[#5B4BB8]/25 via-[#3F4F45]/20 to-transparent blur-[85px] animate-auth-violet"
              aria-hidden="true"
            />

            {/* Magenta warmth midtone blending the transition smoothly */}
            <div
              className="pointer-events-none absolute right-1/4 top-1/3 h-[380px] w-[380px] rounded-full bg-gradient-to-t from-[#BE4BDB]/22 via-[#BE4BDB]/10 to-transparent blur-[80px] animate-auth-magenta"
              aria-hidden="true"
            />

            {/* Perimeter framing vignette */}
            <div
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_45%,rgba(8,9,13,0.65)_100%)]"
              aria-hidden="true"
            />

            {/* Layer 2: Abstract Layered Geometry (Calibrated Scale & Framing) */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
              {/* Diamond 1: Top-Center / Off-Top */}
              <div
                className="absolute -top-16 right-[26%] w-64 h-64 sm:w-72 sm:h-72 xl:w-80 xl:h-80 rounded-[34px] xl:rounded-[40px] border border-white/[0.09] bg-white/[0.025] shadow-xl backdrop-blur-[6px] animate-auth-diamond-1"
                style={{ transform: "rotate(45deg)" }}
              />
              {/* Diamond 2: Top-Right / Off-Right Edge */}
              <div
                className="absolute -top-10 -right-12 w-72 h-72 sm:w-80 sm:h-80 xl:w-88 xl:h-88 rounded-[38px] xl:rounded-[44px] border border-white/[0.08] bg-gradient-to-br from-white/[0.035] via-violet-400/[0.02] to-transparent shadow-xl backdrop-blur-[6px] animate-auth-diamond-2"
                style={{ transform: "rotate(45deg)" }}
              />
              {/* Diamond 3: Mid-Right / Off-Right Edge */}
              <div
                className="absolute top-28 -right-8 w-56 h-56 sm:w-64 sm:h-64 xl:w-72 xl:h-72 rounded-[28px] xl:rounded-[34px] border border-white/[0.07] bg-gradient-to-br from-amber-400/[0.05] via-white/[0.02] to-transparent shadow-lg backdrop-blur-[6px] animate-auth-diamond-3"
                style={{ transform: "rotate(45deg)" }}
              />
            </div>

            {/* Layer 3: Editorial Foreground Container (Lower-Middle Placement) */}
            <div className="relative z-10 w-full max-w-xl mt-auto mb-4 sm:mb-6 xl:mb-8 rounded-[20px] xl:rounded-[24px] bg-white/[0.035] border border-white/[0.09] p-6 sm:p-7 xl:p-8 backdrop-blur-md shadow-[0_12px_40px_rgba(0,0,0,0.35),inset_0_1px_0_0_rgba(255,255,255,0.12)]">
              {/* Quiet Editorial Category Annotations */}
              <div className="flex items-center gap-2.5 mb-4 select-none" aria-hidden="true">
                <span className="text-[11px] font-mono font-medium tracking-[0.2em] uppercase text-amber-300/90 flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-amber-400" />
                  LECTURES
                </span>
                <span className="text-white/25 text-[10px]">•</span>
                <span className="text-[11px] font-mono font-medium tracking-[0.2em] uppercase text-white/50">
                  NOTES
                </span>
                <span className="text-white/25 text-[10px]">•</span>
                <span className="text-[11px] font-mono font-medium tracking-[0.2em] uppercase text-white/50">
                  KNOWLEDGE
                </span>
              </div>

              {/* Main Headline with natural 2-line cadence and subtle highlighter accent */}
              <h2 className="font-display text-[24px] sm:text-[27px] xl:text-[30px] font-normal leading-[1.28] text-white tracking-[-0.015em] max-w-lg">
                A calmer way to{" "}
                <span className="relative inline-block text-white font-medium">
                  <span
                    className="absolute inset-x-0 bottom-0.5 h-[4px] bg-amber-400/40 rounded-xs -z-0"
                    aria-hidden="true"
                  />
                  <span className="relative z-10">make sense</span>
                </span>{" "}
                <br className="hidden sm:inline" />
                of what you learn.
              </h2>

              {/* Supporting Text */}
              <p className="mt-3.5 text-[14px] xl:text-[14.5px] leading-[1.65] text-white/70 font-sans max-w-md">
                Bring your notes, lectures, and learning materials together in one place.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Single Coordinated Page Footer: Spans full width, displays branding once */}
      <footer className="w-full px-6 sm:px-10 lg:px-10 xl:px-14 2xl:px-18 py-3 text-[12px] text-white/40 flex items-center justify-between border-t border-white/[0.05] shrink-0 font-sans select-none">
        <p>© {new Date().getFullYear()} Zenote</p>
        <p className="text-white/30 text-[12px]">Scholar&apos;s Workspace</p>
      </footer>
    </div>
  );
}
