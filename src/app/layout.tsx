import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";
import { siteConfig } from "@/lib/site-config";
import { WebsiteJsonLd } from "@/components/seo/json-ld";

const display = localFont({
  src: "../../public/fonts/SourceSerif4-Variable.woff2",
  variable: "--font-display",
  display: "swap",
});
const sans = localFont({
  src: "../../public/fonts/Inter-Variable.woff2",
  variable: "--font-sans",
  display: "swap",
});
const mono = localFont({
  src: [
    {
      path: "../../public/fonts/IBMPlexMono-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/IBMPlexMono-Medium.woff2",
      weight: "500",
      style: "normal",
    },
  ],
  variable: "--font-mono",
  display: "swap",
});
const manrope = localFont({
  src: "../../public/fonts/Manrope-Variable.woff2",
  variable: "--font-manrope",
  display: "swap",
});
const jakarta = localFont({
  src: "../../public/fonts/PlusJakartaSans-Variable.woff2",
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.siteUrl),
  title: {
    default: siteConfig.titleDefault,
    template: siteConfig.titleTemplate,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  authors: [{ name: "Zenote" }],
  creator: "Zenote",
  publisher: "Zenote",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: siteConfig.locale,
    url: siteConfig.siteUrl,
    siteName: siteConfig.name,
    title: siteConfig.titleDefault,
    description: siteConfig.description,
    images: [
      {
        url: siteConfig.logoUrl,
        width: 512,
        height: 512,
        alt: "Zenote Logo",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: siteConfig.titleDefault,
    description: siteConfig.description,
    images: [siteConfig.logoUrl],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: siteConfig.logoUrl, sizes: "any" },
    ],
    apple: [
      { url: siteConfig.logoUrl, sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/manifest.webmanifest",
  verification: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? {
        google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
      }
    : undefined,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} ${manrope.variable} ${jakarta.variable}`}
      suppressHydrationWarning
    >
      <head>
        <WebsiteJsonLd />
      </head>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
