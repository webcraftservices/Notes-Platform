import type { Metadata, Viewport } from "next";
import ZenoteWelcomeContent from "@/components/onboarding/zenote-welcome-content";

export const metadata: Metadata = {
  title: "Welcome",
  description:
    "Experience Zenote: a calm, focused workspace to capture lectures, organize study materials, and build lasting knowledge.",
  alternates: {
    canonical: "/welcome",
  },
  openGraph: {
    title: "Welcome to Zenote",
    description:
      "Experience Zenote: a calm, focused workspace to capture lectures, organize study materials, and build lasting knowledge.",
    url: "/welcome",
    type: "website",
    images: [
      {
        url: "/zenote-logo-transparent.png",
        width: 512,
        height: 512,
        alt: "Zenote",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Welcome to Zenote",
    description:
      "Experience Zenote: a calm, focused workspace to capture lectures, organize study materials, and build lasting knowledge.",
    images: ["/zenote-logo-transparent.png"],
  },
};

// Route-scoped: welcome is always dark, so instruct the browser for dark viewport/theme
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#101116",
};

export default function WelcomePage() {
  return <ZenoteWelcomeContent />;
}
