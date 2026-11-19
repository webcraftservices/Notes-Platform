import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const rootDir = process.cwd();
const entryFile = path.resolve(rootDir, "src/workers/index.ts");
const outFile = path.resolve(rootDir, "dist/workers/index.cjs");

async function main() {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  await build({
    entryPoints: [entryFile],
    outfile: outFile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    packages: "external",
    sourcemap: true,
    tsconfig: path.resolve(rootDir, "tsconfig.json"),
    logLevel: "info",
    define: {
      "process.env.ZENOTE_WORKER_BUNDLED": '"true"',
    },
  });

  if (!fs.existsSync(outFile)) {
    throw new Error(`Worker build did not produce output file: ${outFile}`);
  }

  const contents = fs.readFileSync(outFile, "utf8");
  if (!contents.length) {
    throw new Error(`Worker bundle is empty: ${outFile}`);
  }

  // Verify no unresolved TypeScript path aliases remain in runtime require/import calls
  const unresolvedAliasMatch = contents.match(/(?:require|import)\(["']@\/[^"']+["']\)/);
  if (unresolvedAliasMatch) {
    throw new Error(
      `Unresolved @/ path alias left in compiled worker bundle: ${unresolvedAliasMatch[0]}`
    );
  }

  const stats = fs.statSync(outFile);
  console.log(
    `[build-worker] Built ${path.relative(rootDir, outFile)} (${Math.round(stats.size / 1024)} KB)`
  );
}

main().catch((err) => {
  console.error("[build-worker] Build failed:", err);
  process.exit(1);
});

