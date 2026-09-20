# Production Security Boundary Hardening — Phase 9.3

Evidence-driven audit of the categories below, against the actual code at
checkpoint `5a36f0f`. Findings only — no speculative hardening. For each
category: what was inspected, what was found, and what (if anything)
changed.

## Summary of changes

| Finding | Severity | Change |
|---|---|---|
| `NoteBlock.content` accepted arbitrary JSON, rendered through a Tiptap version with a known `mergeAttributes()` prototype-pollution/XSS bug | **P0** | `lib/validation/safe-json.ts` — reject `__proto__`/`constructor`/`prototype` keys anywhere in the content tree |
| `image-size`/`music-metadata` had upstream infinite-loop DoS advisories reachable via accepted upload MIME types (HEIC, audio), running synchronously in the upload request path | **P1** | Upgraded to `image-size@2.0.4` / `music-metadata@11.15.0` (empirically verified compatible with this app's narrow usage — no code changes needed) |
| No HTTP security headers anywhere | **P1** | Added `headers()` to `next.config.js` |
| Google OAuth callback forwarded raw provider/exception text into a browser-visible redirect URL | **P2** | Generic message + `logServerError()`, mirroring the Phase 9.1 pattern for AI provider errors |

Everything else in this document is a category that was audited and found
**not** to need a change, with the evidence for that conclusion.

---

## A. HTTP security headers

**Before:** `next.config.js` set zero security headers.

**Resource audit performed first:** fonts are self-hosted via `next/font/google`
(no runtime request to any Google Fonts domain); Google profile photos are
proxied through `/_next/image` (the browser never requests
`googleusercontent.com` directly — `images.remotePatterns` only controls what
the *server* is allowed to fetch); the PDF viewer's iframe (`components/
materials/pdf-viewer.tsx`) only ever receives a same-origin `readUrl`; no
`rewrites()`, no Server Actions actually used despite the config flag being
present, no WebSockets, no custom server.

**Implemented:** `X-Content-Type-Options: nosniff`, `X-Frame-Options:
SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` (blocks camera/geolocation/payment/usb; allows
microphone same-origin-only for the lecture recorder), `Strict-Transport-
Security`, and a `Content-Security-Policy`.

**CSP limitation, documented rather than forced:** Next.js App Router's RSC
hydration relies on inline `<script>` tags, so `script-src`/`style-src`
include `'unsafe-inline'`. A stricter nonce-based CSP is possible in Next 14
(middleware generates a nonce, passed through to the CSP header and picked up
by Next's own inline scripts) but requires middleware + root-layout plumbing
this repo doesn't have yet, and a production build to fully verify hydration
still works — this sandbox's build already fails at the pre-existing
`fonts.googleapis.com` step before reaching that point, so it couldn't be
verified end-to-end here. Every other directive (`object-src 'none'`,
`base-uri 'self'`, `frame-ancestors 'self'`, `form-action 'self'`,
`img/media/connect/font-src` all scoped to `'self'` plus the minimum needed
schemes) is as strict as the app's actual resource usage allows.
**To upgrade later:** add nonce generation to `middleware.ts`, read it via
`headers()` in `app/layout.tsx`, and pass it to any raw `<script>` tags.

Tests: `src/lib/__tests__/security-headers.test.ts`.

## B. Authentication / session security

Inspected `src/lib/auth.ts` and, directly in the installed package (not
memory), `node_modules/next-auth/core/lib/cookie.js` and `core/init.js`.

**Finding: no risk, no change needed.** No cookie overrides exist in
`authOptions`, so NextAuth's defaults apply everywhere: `httpOnly: true`,
`sameSite: "lax"`, and `secure` automatically `true` whenever `NEXTAUTH_URL`
starts with `https://` (verified directly in `init.js`). The
`CredentialsProvider`'s `authorize()` returns only `{id, email, name, image}`
— never a password hash. No custom `redirect` callback is defined, so
NextAuth's own default (same-origin-only) open-redirect protection is
unmodified. Not redesigned, per the phase's explicit non-goal.

## C. CSRF / cross-origin state changes

Audited every state-changing route pattern named in the phase prompt.

**Finding: no new protection needed.** Session cookies are `SameSite=Lax`
(confirmed in B), which blocks the cookie from being attached to a
cross-site `fetch`/form submission that isn't a top-level GET navigation.
Independently, every state-changing route parses `req.json()` — a
form-encoded CSRF submission (the classic no-JS CSRF vector, which *would*
carry cookies even under `Lax` for a simple cross-site POST) produces a body
that fails `.json()` parsing and is rejected by the route's own zod schema
before anything happens. Combined with D below (no CORS), a cross-origin
`fetch()` with credentials would additionally be blocked by the browser's own
CORS policy. No webhooks exist in this app (nothing to treat separately from
browser CSRF, per the phase's instruction). No CSRF library added.

## D. CORS / origin trust

**Finding: no risk, no change needed.** Grepped the entire `src/` tree for
`Access-Control-Allow`/CORS middleware — none exists. Every route relies on
the browser's default same-origin policy. Per the phase's own instruction
("if CORS is not required, do not add it"), nothing was added.

## E. Open redirects

Grepped for `redirect`/`callbackUrl`/`returnTo`/`next`/`url` patterns across
the app. **Finding: no risk, no change needed.** Every `redirect()`/
`NextResponse.redirect()` call site is either a hardcoded internal path
(`/sign-in`, `/home`, `/onboarding`) or the intentional Google OAuth
redirects (to Google's own auth endpoint, and to this app's own `/settings`
page — both already audited under G). No `callbackUrl`/`returnTo`/`next`
query-parameter-driven redirect exists anywhere in custom app code, and
NextAuth's own default redirect callback (same-origin-only) is unmodified.

## F. File upload / storage security, SSRF

Inspected the full upload path: `api/materials/upload-url` →
`api/storage/upload` → `services/storage-local.ts` / `storage-s3.ts` →
`api/storage/read`.

**Finding: no risk, no change needed.** `storageKey` is 100% server-generated
(`materials/${user.id}/${materialId}.${extension}` — the user-supplied
filename is only ever used as a display string, never as part of a storage
path). `LocalStorageService.sanitizeKey()` additionally defends against path
traversal (`.`/`..` segments, disallowed characters) as defense-in-depth,
even though the generation path above means it's never actually fed
attacker-influenced input today. `/api/storage/read` re-derives authorization
from the database via `getAccessibleMaterialByStorageKey(key, user.id)` — it
never trusts the `key` query parameter against the filesystem directly.

**SSRF:** searched for every server-side `fetch`/HTTP call using
user-supplied input. The "link import" material type
(`createLinkMaterialSchema`) only *stores* the submitted URL as
`sourceUrl` — grepped the entire codebase and confirmed nothing ever fetches
it server-side (the "fetch and extract text" part of that feature isn't
built yet). The Google Drive client (`services/google-drive.ts`) uses a
hardcoded host (`https://www.googleapis.com`) with every user-influenced
value (`fileId`) passed through `encodeURIComponent()` before interpolation,
so it can't be used to redirect the request to a different host or inject
extra path/query segments. **No SSRF surface exists in this application
today** — documented per the phase's explicit instruction, not assumed.

## G. Google OAuth / Drive security

Inspected every file and route named in the phase prompt.

- **OAuth state** (`google-oauth-state.ts`): HMAC-SHA256 signed, timing-safe
  compared, 10-minute TTL, bound to the requesting user's id. Correct as-is.
- **Redirect URI**: derived from `NEXTAUTH_URL` (falls back to the request's
  own origin only if unset) and matched exactly the same way in `connect`
  and `callback`. Google's own exact-match enforcement on registered
  redirect URIs is the real security boundary here regardless. **Documented
  operational note, not a code change:** `NEXTAUTH_URL` should always be set
  explicitly in production.
- **State verification**: `callback` correctly calls
  `verifyOAuthState(state, user.id)` — bound to the *current* session's user,
  which is real CSRF protection for the account-linking flow (an attacker
  can't complete a victim's OAuth flow using their own state token).
- **Token storage**: `google-connection.ts` encrypts both access and refresh
  tokens at rest via `lib/crypto.ts` — AES-256-GCM, random IV per encryption,
  auth-tag verified on decrypt, key derived with scrypt. Correct as
  implemented; not touched.
- **Token/client-bundle exposure**: grepped for any token value reaching a
  client component or a `NextResponse.json` body — none found; tokens are
  only ever read/written server-side.
- **Found and fixed (P2):** the callback route forwarded `err.message` from
  a caught exception straight into the `/settings` redirect URL, which could
  include Google's own token-exchange error response body (not our secrets,
  but unnecessary exposure of provider internals via a URL, landing in
  browser history/referrers). Fixed — see `google/callback/route.ts`; the
  same generic-message-plus-server-log pattern already established in Phase
  9.1 for AI provider errors.
- **`google/import`'s route** has the same class of `err.message` passthrough
  in its generic catch (502 JSON response). Lower severity than the callback
  case (a JSON API response the owning user's own client reads, not a URL
  landing in browser history) — **documented, not changed**, to keep this
  phase's diff focused on the two concrete, higher-value fixes.

Not redesigned, per the phase's explicit non-goal.

## H. API input boundaries

Grepped every validation schema for `z.any()`/unconstrained `z.record()`.
Found exactly two: `noteBlockSchema.content` (fixed — see the P0 finding
above) and `submitQuizAttemptSchema.answers` (lower severity — values are
constrained to `string | boolean`, so there's no DOM-attribute-injection
path even with a `__proto__` key, but given the same guard already exists
and costs nothing extra, it was applied there too for consistency — see
`lib/validation/safe-json.ts`). No other unconstrained input boundaries were
found feeding Prisma, storage, or an external API directly.

## I. Authorization / IDOR / BOLA

This was the most time spent of any category, given its explicit priority.
Read `lib/access.ts` in full (materials, notes, subjects, chapters, topics,
groups, AI conversations, Google connections) and spot-checked
representative routes for each resource type, confirming every one imports
from `lib/access.ts` and checks ownership/membership before any mutation.

**Finding: the existing architecture is sound — no vulnerability found, no
change made.** Specifically checked (and confirmed already correctly
defended) the exact IDOR pattern the phase prompt describes — a user
supplying an ID for a sub-resource that belongs to a *different* parent than
the one they're authorized for: `notes/[noteId]/blocks/route.ts` already
explicitly derives `existingIds` from `db.noteBlock.findMany({where:{noteId:
note.id}})` before allowing any client-supplied block id to be treated as an
update target, with an inline comment noting this exact bug was caught
before shipping. `lib/access.ts` is not redesigned, per the phase's explicit
non-goal.

## J. Dependency security

Ran `npm audit` (read-only; never `--force`). 43 findings — assessed each
cluster for actual production relevance rather than treating the count as
the finding:

- **`next` (2 critical, several high):** the RCE advisories are
  `GHSA-p293-qw3h-jr36` (Windows-hosted servers only — this app shows no
  Windows-specific deployment assumption anywhere) and `GHSA-2xp9-vwfh-vxw4`
  (AVIF image optimization — confirmed via the advisory that exposure
  requires the app to have explicitly added `image/avif` to
  `images.formats`; this app's `next.config.js` never sets `formats` at
  all, so it's on Next's default, which doesn't include AVIF — **not
  exposed**). The SSRF/DoS entries specific to Server Actions, `rewrites()`,
  and WebSocket upgrades don't apply either: this app has no Server Actions
  actually invoked anywhere (`"use server"` doesn't appear in the codebase
  despite the config flag being present), no `rewrites()` config, and no
  WebSocket/custom-server code. The remaining fix requires a Next 14→16
  major version bump — explicitly out of scope for this phase
  ("do not upgrade Next.js unnecessarily") and too large a blast radius to
  safely execute and fully verify here. **Not upgraded — documented as a
  separate, dedicated future project**, given the volume of accumulated
  advisories even though the specific ones checked don't apply to this
  app's actual configuration.
- **`vitest`/`vite`/`@vitest/mocker`/`esbuild` (critical/moderate):**
  dev-only, never shipped to production. The critical one requires the
  Vitest UI dev server to be running and listening, which this project
  doesn't use. Not upgraded (major version bump, dev tooling only).
- **`image-size`, `music-metadata` (high):** **fixed** — see the P1 finding
  above.
- **`pptx2html` → `d3`/`d3-color` (high, ReDoS, no fix available):**
  `pptx2html` (already patched via `patch-package` for an unrelated issue)
  pulls in `d3-color`'s vulnerable regex. This is a DoS-only risk (not RCE),
  no fix is available upstream, and replacing `pptx2html` entirely is not a
  "safe targeted" change. **Accepted, documented risk** — worth revisiting
  if `pptx2html` ever ships a fix or this app moves off it.
- **`@tiptap/*` (moderate, several entries):** the specific one that mattered
  (`@tiptap/core`'s `mergeAttributes()` bug) is the P0 finding above, fixed
  at the input-validation boundary rather than by upgrading Tiptap itself
  (a v2→v3 major bump across the whole editor is out of scope for a
  "targeted" fix). The other moderate entries in this cluster are the same
  underlying advisory surfacing through Tiptap's many sub-packages.
- **`js-yaml`, `postcss`, `glob`, `@next/eslint-plugin-next`,
  `eslint-config-next`:** all transitive, dev/build-tooling only (ESLint
  config, PostCSS build pipeline) — not shipped to production, not
  upgraded.

**`isomorphic-dompurify` Node engine check (carried over from Phase 9.1):**
re-verified against the actual runtime — `package.json` requires Node
`^22.22.2 || ^24.15.0 || >=26.0.0`; this environment runs Node `22.22.2`,
which satisfies it. No change needed.

No dependency was upgraded across a major version boundary in this phase
except `image-size` and `music-metadata`, both empirically verified
compatible with this app's specific (narrow) usage before upgrading — see
`src/lib/__tests__/metadata-extraction.test.ts`.

---

## Files changed this phase

- `next.config.js` — security headers
- `src/lib/validation/notes.ts`, `src/lib/validation/quiz-attempt.ts` —
  prototype-pollution guard applied
- `src/app/api/integrations/google/callback/route.ts` — safe error message
- `package.json`/`package-lock.json` — `image-size`, `music-metadata`
  upgraded to their patched versions

## New files

- `src/lib/validation/safe-json.ts` — the prototype-pollution guard
- Tests: `security-headers.test.ts`, `safe-json.test.ts`,
  `metadata-extraction.test.ts`, `notes/[noteId]/blocks/__tests__/
  route.test.ts`, `integrations/google/callback/__tests__/route.test.ts`
