export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Form column */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-20">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-ink text-[13px] font-display font-semibold text-paper dark:bg-white dark:text-graphite-950">
              K
            </div>
            <span className="font-display text-[15px] font-semibold tracking-tight">Knowledge</span>
          </div>
          {children}
        </div>
      </div>

      {/* Signature panel: a marginalia-style composition using the highlight
          motif on real, representative product copy — not stock art. */}
      <div className="relative hidden overflow-hidden bg-graphite-950 lg:block">
        <div className="flex h-full flex-col justify-center px-16 py-20">
          <p className="font-mono text-xs uppercase tracking-widest text-white/40">
            Lecture 12 · Thermodynamics
          </p>
          <h2 className="mt-6 max-w-md font-display text-[28px] font-medium leading-snug text-white">
            Two systems are in{" "}
            <span className="highlight-mark bg-graphite-950" style={{ backgroundPosition: "0 82%" }}>
              thermal equilibrium
            </span>{" "}
            when no net heat flows between them.
          </h2>
          <div className="mt-8 space-y-3 border-l border-white/10 pl-4">
            <p className="text-sm text-white/50">
              <span className="mr-2 rounded-sm bg-accent/20 px-1.5 py-0.5 font-mono text-[11px] text-accent">
                EXAM
              </span>
              Zeroth Law follows directly from this definition.
            </p>
            <p className="text-sm text-white/50">
              <span className="mr-2 rounded-sm bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white/70">
                12:45
              </span>
              Jump to where this was explained.
            </p>
          </div>
          <p className="mt-16 max-w-xs text-sm text-white/40">
            Your recordings, notes, and materials — understood, organized, and searchable.
          </p>
        </div>
      </div>
    </div>
  );
}
