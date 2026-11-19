/**
 * Strips any `.env*` files copied by `next build` into `.next/standalone`
 * so standalone build artifacts never carry local environment secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function scrubStandaloneEnv(
  standaloneDir = path.resolve(process.cwd(), ".next/standalone")
) {
  const removed = [];
  if (!fs.existsSync(standaloneDir)) {
    return removed;
  }

  for (const entry of fs.readdirSync(standaloneDir)) {
    if (entry.startsWith(".env")) {
      fs.rmSync(path.join(standaloneDir, entry), { force: true });
      removed.push(entry);
      console.log(`[build] Removed .next/standalone/${entry}`);
    }
  }
  return removed;
}

const isEntrypoint =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  scrubStandaloneEnv();
}
