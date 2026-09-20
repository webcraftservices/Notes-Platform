/**
 * Phase 9.3 security headers — see docs/security-hardening.md for the
 * resource audit behind this specific set of directives (self-hosted
 * fonts via next/font, Google profile photos proxied through
 * /_next/image so the browser never loads googleusercontent.com
 * directly, no external scripts/stylesheets, same-origin-only iframe in
 * the PDF viewer, mic access for the lecture recorder).
 *
 * script-src/style-src include 'unsafe-inline': Next.js App Router's RSC
 * hydration relies on inline <script> tags, and this app has no
 * nonce-plumbing (middleware + root layout) to allow a stricter policy
 * without risking breaking hydration in production, which can't be fully
 * exercised in this environment (see docs/security-hardening.md's build
 * limitation). Every other directive is as strict as the app's actual
 * resource usage allows.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Belt-and-braces alongside frame-ancestors above — X-Frame-Options is
  // still honored by browsers that don't support the CSP directive.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // camera is unused anywhere in the app; microphone is needed, same-origin
  // only, for the lecture recorder (components/materials/recorder-panel.tsx).
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()" },
  // Safe to always send: browsers only honor HSTS on a response actually
  // received over HTTPS, so this has no effect in plain-HTTP local dev.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy", value: CSP },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" }, // Google profile photos
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

module.exports = nextConfig;
