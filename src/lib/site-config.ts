/**
 * Site configuration and SEO identity for Zenote.
 *
 * Single source of truth for canonical URLs, metadata base, sitemaps,
 * Open Graph, Twitter cards, and Schema.org structured data.
 *
 * Identity Rules:
 * - Never uses localhost, 127.0.0.1, or preview deployment URLs in production SEO metadata.
 * - Prioritizes NEXT_PUBLIC_SITE_URL or SITE_URL if set to a valid non-local domain.
 * - Defaults to a single isolated configuration value ("https://zenote.app") that
 *   can be configured for the confirmed production domain.
 */

const DEFAULT_PRODUCTION_URL = "https://zenote.app";

export function resolveBaseUrl(): string {
  const publicUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (publicUrl && !publicUrl.includes("localhost") && !publicUrl.includes("127.0.0.1")) {
    return publicUrl.replace(/\/+$/, "");
  }

  const siteUrl = process.env.SITE_URL?.trim();
  if (siteUrl && !siteUrl.includes("localhost") && !siteUrl.includes("127.0.0.1")) {
    return siteUrl.replace(/\/+$/, "");
  }

  const nextAuthUrl = process.env.NEXTAUTH_URL?.trim();
  if (nextAuthUrl && !nextAuthUrl.includes("localhost") && !nextAuthUrl.includes("127.0.0.1")) {
    return nextAuthUrl.replace(/\/+$/, "");
  }

  return DEFAULT_PRODUCTION_URL;
}

export const siteConfig = {
  name: "Zenote",
  shortName: "Zenote",
  titleDefault: "Zenote — Lecture Intelligence & Knowledge Platform",
  titleTemplate: "%s | Zenote",
  description:
    "Record lectures with live transcription, import study materials, organize course knowledge, and learn with AI-powered notes, flashcards, and quizzes.",
  siteUrl: resolveBaseUrl(),
  logoUrl: "/zenote-logo-transparent.png",
  ogImageUrl: "/intro-hero.png",
  locale: "en_US",
} as const;

export function getSiteUrl(): string {
  return siteConfig.siteUrl;
}

export function absoluteUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${siteConfig.siteUrl}${normalizedPath}`;
}
