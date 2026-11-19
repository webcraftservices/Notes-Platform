/**
 * src/lib/search/snippet-extractor.ts
 *
 * 160-Character Contextual Snippet Windowing with Query Match Density,
 * Word Boundary Snapping, and Safe Unicode Ellipsis Formatting.
 */

export interface SnippetOptions {
  targetLength?: number; // default 160
  leadChars?: number;    // default 45
}

/**
 * Extracts a contextual snippet of ~160 characters centered around the highest
 * density of query term matches, snapping to word boundaries and using clean Unicode ellipses.
 */
export function extractContextualSnippet(
  text: string | null | undefined,
  query: string | null | undefined,
  options: SnippetOptions = {}
): string {
  if (!text || typeof text !== "string") return "";

  const rawTarget = options.targetLength ?? 160;
  const targetLength = Number.isFinite(rawTarget)
    ? Math.max(20, Math.floor(rawTarget))
    : 160;
  const rawLead = options.leadChars ?? 45;
  const leadChars = Number.isFinite(rawLead)
    ? Math.min(Math.max(5, Math.floor(rawLead)), targetLength - 5)
    : Math.min(45, targetLength - 5);

  // 1. Normalize whitespace
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return "";
  if (normalized.length <= targetLength) return normalized;

  // 2. Tokenize search query into meaningful words
  const queryStr = (query ?? "").trim();
  const rawTokens = queryStr.split(/\s+/).filter((t) => t.length > 0);
  const cleanTokens = rawTokens
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase())
    .filter((t) => t.length >= 2 || (rawTokens.length === 1 && t.length >= 1));

  const uniqueTokens = Array.from(new Set(cleanTokens));

  // 3. Fallback: If no query tokens, return clean prefix
  if (uniqueTokens.length === 0) {
    return snapPrefix(normalized, targetLength);
  }

  // 4. Find all token occurrence positions in lowercased text
  const lowerText = normalized.toLowerCase();
  interface MatchPos {
    start: number;
    end: number;
    token: string;
  }
  const matches: MatchPos[] = [];

  for (const token of uniqueTokens) {
    let pos = lowerText.indexOf(token, 0);
    while (pos !== -1) {
      matches.push({ start: pos, end: pos + token.length, token });
      pos = lowerText.indexOf(token, pos + 1);
    }
  }

  // 5. Fallback: Zero query tokens matched (e.g. semantic match)
  if (matches.length === 0) {
    return snapPrefix(normalized, targetLength);
  }

  matches.sort((a, b) => a.start - b.start);

  // 6. Sliding Window: Find Window Centered on Highest Match Density
  let bestScore = -1;
  let bestStart = 0;
  let bestEnd = Math.min(normalized.length, targetLength);

  for (const m of matches) {
    let wStart = Math.max(0, m.start - leadChars);
    let wEnd = Math.min(normalized.length, wStart + targetLength);

    if (wEnd - wStart < targetLength) {
      wStart = Math.max(0, wEnd - targetLength);
    }

    // Evaluate window density score
    let totalOccurrences = 0;
    const coveredTokens = new Set<string>();

    for (const match of matches) {
      if (match.start >= wStart && match.end <= wEnd) {
        totalOccurrences++;
        coveredTokens.add(match.token);
      }
    }

    const score = coveredTokens.size * 10 + totalOccurrences;
    if (score > bestScore) {
      bestScore = score;
      bestStart = wStart;
      bestEnd = wEnd;
    }
  }

  // 7. Word Boundary Snapping
  let snappedStart = bestStart;
  let snappedEnd = bestEnd;

  // Snap Left Boundary
  if (snappedStart > 0) {
    if (normalized[snappedStart] !== " ") {
      const nextSpace = normalized.indexOf(" ", snappedStart);
      if (nextSpace !== -1 && nextSpace - snappedStart <= 15) {
        snappedStart = nextSpace + 1;
      } else {
        const prevSpace = normalized.lastIndexOf(" ", snappedStart);
        if (prevSpace !== -1 && snappedStart - prevSpace <= 15) {
          snappedStart = prevSpace + 1;
        }
      }
    } else {
      snappedStart += 1;
    }
  }

  // Snap Right Boundary
  if (snappedEnd < normalized.length) {
    if (normalized[snappedEnd] !== " ") {
      const prevSpace = normalized.lastIndexOf(" ", snappedEnd);
      if (prevSpace !== -1 && snappedEnd - prevSpace <= 20) {
        snappedEnd = prevSpace;
      } else {
        const nextSpace = normalized.indexOf(" ", snappedEnd);
        if (nextSpace !== -1 && nextSpace - snappedEnd <= 15) {
          snappedEnd = nextSpace;
        }
      }
    }
  }

  if (snappedEnd <= snappedStart) {
    snappedStart = bestStart;
    snappedEnd = bestEnd;
  }

  // 8. Ellipsis Discipline
  let snippet = normalized.slice(snappedStart, snappedEnd).trim();
  if (snappedStart > 0) {
    snippet = `… ${snippet}`;
  }
  if (snappedEnd < normalized.length) {
    snippet = `${snippet} …`;
  }

  return snippet;
}

function snapPrefix(text: string, targetLength: number): string {
  if (text.length <= targetLength) return text;
  const prevSpace = text.lastIndexOf(" ", targetLength);
  const boundary = prevSpace !== -1 && targetLength - prevSpace <= 25 ? prevSpace : targetLength;
  return `${text.slice(0, boundary).trim()} …`;
}

export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

/**
 * Splits a plain-text snippet into highlighted and non-highlighted segments
 * for XSS-safe React rendering without dangerouslySetInnerHTML.
 */
export function splitSnippetForHighlight(
  snippet: string,
  query: string
): HighlightSegment[] {
  if (!snippet) return [];
  const rawTokens = (query ?? "")
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((t) => t.length >= 2);

  if (rawTokens.length === 0) {
    return [{ text: snippet, highlighted: false }];
  }

  const escapedTokens = Array.from(new Set(rawTokens.map((t) => t.toLowerCase())))
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  const regex = new RegExp(`(${escapedTokens.join("|")})`, "gi");
  const parts = snippet.split(regex);
  const tokenSet = new Set(rawTokens.map((t) => t.toLowerCase()));

  return parts
    .filter((p) => p.length > 0)
    .map((part) => ({
      text: part,
      highlighted: tokenSet.has(part.toLowerCase()),
    }));
}
