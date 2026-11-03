import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-config";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/welcome",
          "/welcome/intro",
          "/sign-in",
          "/sign-up",
        ],
        disallow: [
          "/api/",
          "/_next/",
          "/home",
          "/subjects",
          "/materials",
          "/groups",
          "/quizzes",
          "/flashcards",
          "/assistant",
          "/search",
          "/settings",
          "/onboarding",
          "/invitations/",
          "/welcome/test-hero",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
