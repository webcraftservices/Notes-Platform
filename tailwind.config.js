/**
 * Design tokens for the Knowledge Platform.
 *
 * Direction: "scholar's desk, not SaaS dashboard." The product's core act is
 * marking up source material — a lecture, a PDF, a photographed whiteboard —
 * and surfacing what matters. The palette and the signature "highlight"
 * treatment (see globals.css .highlight-mark) come directly from that: a
 * warm graphite/paper base with a single amber "highlighter" accent used
 * only for what the AI has judged important, never decoratively.
 *
 * Display face: Source Serif 4 (restrained, editorial, legible at heading
 * sizes) paired with Inter for body/UI and IBM Plex Mono for timestamps,
 * durations, and code — deliberately not a single do-everything sans.
 */
const { fontFamily } = require("tailwindcss/defaultTheme");

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: "#FAF9F6",
          raised: "#FFFFFF",
        },
        ink: {
          DEFAULT: "#1B1C20",
          muted: "#5B5C63",
          faint: "#9A9AA1",
        },
        graphite: {
          950: "#101116",
          900: "#16171D",
          800: "#1E1F27",
          700: "#292A34",
          600: "#3A3C48",
        },
        line: {
          DEFAULT: "#E7E5E0",
          dark: "#2C2D36",
        },
        accent: {
          DEFAULT: "#C6862A", // highlighter amber — reserved for AI-flagged importance
          soft: "#F3E3C4",
          strong: "#9C6A1C",
        },
        signal: {
          info: "#3E6FA6",
          success: "#3E8564",
          danger: "#B4463F",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", ...fontFamily.serif],
        sans: ["var(--font-sans)", ...fontFamily.sans],
        mono: ["var(--font-mono)", ...fontFamily.mono],
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "10px",
        lg: "14px",
      },
      boxShadow: {
        subtle: "0 1px 2px rgba(20, 20, 22, 0.04), 0 1px 1px rgba(20,20,22,0.03)",
        panel: "0 4px 16px rgba(20, 20, 22, 0.06), 0 1px 2px rgba(20,20,22,0.04)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
