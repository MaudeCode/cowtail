// Bundles the CLI for Node into dist/cowtail.js, or the path given as the first argument.
// COWTAIL_* variables set at build time, such as COWTAIL_VERSION, are inlined into the bundle.
import { chmodSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const cliDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = process.argv[2] ? resolve(process.argv[2]) : join(cliDir, "dist", "cowtail.js");

if (!process.argv[2]) {
  rmSync(join(cliDir, "dist"), { recursive: true, force: true });
}

const define = Object.fromEntries(
  Object.entries(process.env)
    .filter(([key]) => key.startsWith("COWTAIL_"))
    .map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)]),
);

await build({
  entryPoints: [join(cliDir, "src", "cli.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  define,
  logLevel: "warning",
});

chmodSync(outfile, 0o755);
