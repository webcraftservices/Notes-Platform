/**
 * Phase 9.3 security headers — see docs/security-hardening.md for the
 * resource audit behind this specific set of directives (self-hosted
 * fonts via next/font, Google profile photos proxied through
 * /_next/image so the browser never loads googleusercontent.com
 * directly, no external scripts/stylesheets, same-origin-only iframe in
 * the PDF viewer, mic access for the lecture recorder).
 *
 * Stage A production container updates:
 *   - Configures `output: "standalone"` for slim multi-stage Docker images.
 *   - Resolves the configured `STORAGE_ENDPOINT` origin into CSP `connect-src`
 *     while retaining the default Cloudflare R2 origin fallback when unset.
 */
const DEFAULT_R2_ORIGIN = "https://f03d7c364f5dd204ce76f719835c5c28.r2.cloudflarestorage.com";

function resolveConnectSrcStorageOrigins() {
  const rawEndpoint = process.env.STORAGE_ENDPOINT?.trim();
  const extraOrigin = process.env.CSP_EXTRA_CONNECT_SRC?.trim();
  const origins = new Set();

  if (rawEndpoint) {
    try {
      const parsed = new URL(rawEndpoint);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        origins.add(parsed.origin);
      }
    } catch {
      // Ignore invalid STORAGE_ENDPOINT during CSP generation
    }
  } else {
    origins.add(DEFAULT_R2_ORIGIN);
  }

  if (extraOrigin) {
    for (const candidate of extraOrigin.split(/\s+/)) {
      if (candidate) origins.add(candidate);
    }
  }

  return Array.from(origins).join(" ");
}

function buildCspHeader() {
  const storageOrigins = resolveConnectSrcStorageOrigins();
  return [
    "default-src 'self'",
    process.env.NODE_ENV === "development"
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://assets.aceternity.com",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src 'self' ${storageOrigins} https://api.web3forms.com`.trim(),
    "frame-src 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

function buildSecurityHeaders() {
  return [
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
    { key: "Content-Security-Policy", value: buildCspHeader() },
  ];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
    instrumentationHook: true,
    serverComponentsExternalPackages: ["bullmq", "ioredis", "pdfjs-dist"],
    outputFileTracingIncludes: {
      "/**": [
        "./node_modules/pdfjs-dist/package.json",
        "./node_modules/pdfjs-dist/standard_fonts/**/*",
      ],
    },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" }, // Google profile photos
      { protocol: "https", hostname: "assets.aceternity.com" },
    ],
  },
  webpack(config, { webpack }) {
    // pptx2html@0.3.4 contains an import of './txml' with lowercase 'x' in
    // src/process_pptx.js, but the file on disk is 'tXml.js'. On case-sensitive
    // filesystems (Linux CI/production Docker), Webpack fails to resolve './txml'.
    // NormalModuleReplacementPlugin redirects './txml' to './tXml' within pptx2html.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^\.\/txml$/,
        (resource) => {
          if (resource.context && resource.context.includes("pptx2html")) {
            resource.request = "./tXml";
          }
        }
      )
    );
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: buildSecurityHeaders() }];
  },
};

module.exports = nextConfig;
