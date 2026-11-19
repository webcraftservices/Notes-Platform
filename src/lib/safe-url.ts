/**
 * Strict URL protocol allow-listing for user- or externally-supplied links.
 * Rejects `javascript:`, `data:`, `vbscript:`, control-character smuggling,
 * and malformed URLs before persistence or UI rendering.
 */

const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/;

export function toSafeHttpUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  if (CONTROL_CHARS_RE.test(raw)) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isSafeHttpUrl(raw: string | null | undefined): boolean {
  return toSafeHttpUrl(raw) !== null;
}

/**
 * Allows either a safe relative app path (`/api/...`, starting with single `/`)
 * or a strictly validated `http:` / `https:` URL.
 */
export function toSafeAppOrHttpUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  if (CONTROL_CHARS_RE.test(raw)) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }
  return toSafeHttpUrl(trimmed);
}
