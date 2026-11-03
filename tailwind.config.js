/**
 * Design tokens for Zenote.
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
        satoshi: ["Satoshi", "var(--font-sans)", ...fontFamily.sans],
        display: ["var(--font-display)", "Georgia", ...fontFamily.serif],
        sans: ["var(--font-sans)", ...fontFamily.sans],
        manrope: ["var(--font-manrope)", "'Manrope'", ...fontFamily.sans],
        jakarta: ["var(--font-jakarta)", "'Plus Jakarta Sans'", ...fontFamily.sans],
        noto: ["'Noto Serif'", "Georgia", ...fontFamily.serif],
        maname: ["'Maname'", ...fontFamily.sans],
        mono: ["var(--font-mono)", ...fontFamily.mono],
      },
      spacing: {
        120: "30rem",
      },
      aspectRatio: {
        "9/16": "9 / 16",
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
      keyframes: {
        shine: {
          "0%": { "background-position": "0% 0%" },
          "50%": { "background-position": "100% 100%" },
          "100%": { "background-position": "0% 0%" },
        },
        "shine-pulse": {
          "0%": { "background-position": "0% 0%" },
          "50%": { "background-position": "100% 100%" },
          "100%": { "background-position": "0% 0%" },
        },
        orbit: {
          "0%": {
            transform:
              "rotate(calc(var(--angle) * 1deg)) translateY(calc(var(--radius) * 1px)) rotate(calc(var(--angle) * -1deg))",
          },
          "100%": {
            transform:
              "rotate(calc(var(--angle) * 1deg + 360deg)) translateY(calc(var(--radius) * 1px)) rotate(calc((var(--angle) * -1deg) - 360deg))",
          },
        },
        "border-beam": {
          "0%": {
            "offset-distance": "0%",
          },
          "100%": {
            "offset-distance": "100%",
          },
        },
      },
      animation: {
        shine: "shine var(--duration, 10s) infinite linear",
        "shine-pulse": "shine-pulse var(--duration, 8s) infinite linear",
        orbit: "orbit calc(var(--duration)*1s) linear infinite",
        "border-beam": "border-beam calc(var(--duration)*1s) infinite linear",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
