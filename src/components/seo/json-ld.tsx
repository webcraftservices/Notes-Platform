import React from "react";
import { siteConfig, absoluteUrl } from "@/lib/site-config";

export function generateStructuredData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${siteConfig.siteUrl}/#organization`,
        name: siteConfig.name,
        url: siteConfig.siteUrl,
        logo: {
          "@type": "ImageObject",
          "@id": `${siteConfig.siteUrl}/#logo`,
          url: absoluteUrl(siteConfig.logoUrl),
          contentUrl: absoluteUrl(siteConfig.logoUrl),
          caption: siteConfig.name,
        },
      },
      {
        "@type": "WebSite",
        "@id": `${siteConfig.siteUrl}/#website`,
        url: siteConfig.siteUrl,
        name: siteConfig.name,
        description: siteConfig.description,
        publisher: {
          "@id": `${siteConfig.siteUrl}/#organization`,
        },
        inLanguage: "en-US",
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${siteConfig.siteUrl}/#software`,
        name: siteConfig.name,
        applicationCategory: "EducationalApplication",
        operatingSystem: "Web",
        url: siteConfig.siteUrl,
        description: siteConfig.description,
        publisher: {
          "@id": `${siteConfig.siteUrl}/#organization`,
        },
      },
    ],
  };
}

export function WebsiteJsonLd() {
  const structuredData = generateStructuredData();

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
    />
  );
}
