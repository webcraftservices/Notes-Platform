"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            className: "!bg-paper-raised !text-ink !border !border-line dark:!bg-graphite-800 dark:!text-white dark:!border-line-dark",
          }}
        />
      </ThemeProvider>
    </SessionProvider>
  );
}
