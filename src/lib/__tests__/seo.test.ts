import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { siteConfig, getSiteUrl, absoluteUrl, resolveBaseUrl } from "@/lib/site-config";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import manifest from "@/app/manifest";
import { generateStructuredData } from "@/components/seo/json-ld";

describe("SEO Foundation & Site Identity", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Site Configuration & Domain Resolution", () => {
    it("never falls back to localhost or 127.0.0.1 in production URLs", () => {
      process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
      process.env.NEXTAUTH_URL = "http://127.0.0.1:3000";
      expect(resolveBaseUrl()).toBe("https://zenote.app");
    });

    it("respects NEXT_PUBLIC_SITE_URL when set to a valid domain", () => {
      process.env.NEXT_PUBLIC_SITE_URL = "https://custom-zenote-domain.com/";
      expect(resolveBaseUrl()).toBe("https://custom-zenote-domain.com");
    });

    it("generates correct absolute URLs", () => {
      const url = absoluteUrl("/welcome/intro");
      expect(url).toMatch(/^https:\/\/[^/]+\/welcome\/intro$/);
      expect(url).not.toContain("//welcome");
    });

    it("provides accurate metadata description without false claims", () => {
      expect(siteConfig.name).toBe("Zenote");
      expect(siteConfig.description).toContain("Record lectures");
      expect(siteConfig.description).toContain("notes");
    });
  });

  describe("Robots.txt Rules", () => {
    it("allows public marketing and discovery routes", () => {
      const result = robots();
      const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;
      expect(rule).toBeDefined();
      expect(rule?.allow).toBeDefined();
      const allowList = Array.isArray(rule?.allow) ? rule?.allow : [rule?.allow];
      expect(allowList).toContain("/");
      expect(allowList).toContain("/welcome");
      expect(allowList).toContain("/welcome/intro");
      // Auth pages are crawlable so crawlers can read the noindex tag
      expect(allowList).toContain("/sign-in");
      expect(allowList).toContain("/sign-up");
    });

    it("disallows private application routes, API routes, and test routes", () => {
      const result = robots();
      const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;
      expect(rule).toBeDefined();
      expect(rule?.disallow).toBeDefined();
      const disallowList = Array.isArray(rule?.disallow) ? rule?.disallow : [rule?.disallow];
      expect(disallowList).toContain("/api/");
      expect(disallowList).toContain("/home");
      expect(disallowList).toContain("/subjects");
      expect(disallowList).toContain("/materials");
      expect(disallowList).toContain("/groups");
      expect(disallowList).toContain("/settings");
      expect(disallowList).toContain("/onboarding");
      expect(disallowList).toContain("/welcome/test-hero");
    });

    it("points to the canonical sitemap XML", () => {
      const result = robots();
      expect(result.sitemap).toMatch(/^https:\/\/[^/]+\/sitemap\.xml$/);
    });
  });

  describe("XML Sitemap", () => {
    it("contains only public, canonical indexable pages", () => {
      const entries = sitemap();
      const urls = entries.map((e) => e.url);

      expect(urls).toHaveLength(3);
      expect(urls).toContain(`${getSiteUrl()}/`);
      expect(urls).toContain(`${getSiteUrl()}/welcome`);
      expect(urls).toContain(`${getSiteUrl()}/welcome/intro`);

      // Must NOT contain auth, private app, or test routes
      expect(urls.some((u) => u.includes("/sign-in"))).toBe(false);
      expect(urls.some((u) => u.includes("/sign-up"))).toBe(false);
      expect(urls.some((u) => u.includes("/home"))).toBe(false);
      expect(urls.some((u) => u.includes("/api"))).toBe(false);
      expect(urls.some((u) => u.includes("/test-hero"))).toBe(false);
    });

    it("has valid priority and changeFrequency values", () => {
      const entries = sitemap();
      for (const entry of entries) {
        expect(entry.priority).toBeGreaterThan(0);
        expect(entry.priority).toBeLessThanOrEqual(1.0);
        expect(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]).toContain(
          entry.changeFrequency
        );
      }
    });
  });

  describe("Web App Manifest", () => {
    it("returns valid manifest properties", () => {
      const m = manifest();
      expect(m.name).toBe("Zenote");
      expect(m.short_name).toBe("Zenote");
      expect(m.start_url).toBe("/");
      expect(m.icons).toBeDefined();
      expect(m.icons?.length).toBeGreaterThan(0);
    });
  });

  describe("JSON-LD Structured Data", () => {
    it("generates Schema.org Graph with Organization, WebSite, and SoftwareApplication", () => {
      const data = generateStructuredData();
      expect(data["@context"]).toBe("https://schema.org");
      expect(data["@graph"]).toBeDefined();

      const types = data["@graph"].map((item) => item["@type"]);
      expect(types).toContain("Organization");
      expect(types).toContain("WebSite");
      expect(types).toContain("SoftwareApplication");
    });

    it("uses real official logo and does not invent fake ratings or reviews", () => {
      const data = generateStructuredData();
      const jsonString = JSON.stringify(data);

      expect(jsonString).toContain("/zenote-logo-transparent.png");
      expect(jsonString).not.toContain("aggregateRating");
      expect(jsonString).not.toContain("reviewRating");
      expect(jsonString).not.toContain("reviewCount");
    });
  });
});
