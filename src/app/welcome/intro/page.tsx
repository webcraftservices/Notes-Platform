import type { Metadata, Viewport } from "next";
import { IntroContent } from "@/components/onboarding/intro-content";

export const metadata: Metadata = {
  title: "Meet Zenote — Lecture Intelligence & Knowledge Platform",
  description:
    "Explore Zenote: record lectures with live transcription, import documents, organize course knowledge into subjects and chapters, and study with AI-assisted notes, flashcards, and quizzes.",
  alternates: {
    canonical: "/welcome/intro",
  },
  openGraph: {
    title: "Meet Zenote — Everything You Learn, In One Calm Place",
    description:
      "Explore Zenote: record lectures with live transcription, import PDFs and docs, organize course knowledge, and learn with AI-assisted study tools.",
    url: "/welcome/intro",
    type: "website",
    images: [
      {
        url: "/intro-hero.png",
        width: 1200,
        height: 630,
        alt: "Meet Zenote — Knowledge & Lecture Intelligence",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Meet Zenote — Everything You Learn, In One Calm Place",
    description:
      "Explore Zenote: record lectures with live transcription, import PDFs and docs, organize course knowledge, and learn with AI-assisted study tools.",
    images: ["/intro-hero.png"],
  },
};

// Route-scoped: this page is always dark, so ask the browser for dark scrollbars/UI.
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0E0E10",
};

export default function ZenoteIntroPage() {
  return <IntroContent />;
}
