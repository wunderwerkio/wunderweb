// Writes src/core-types.ts: the core v1 contract types with open tokens (any theme).
// Run after changing the core schema: node scripts/core-types.mjs [--check]

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildModel, loadCore, toTypeScript } from "@wunderweb/core";

const OUT = join(import.meta.dirname, "..", "src", "core-types.ts");
const text = toTypeScript(buildModel(loadCore(1)), { open: true });

if (process.argv.includes("--check")) {
	if (readFileSync(OUT, "utf8") !== text) {
		console.error("src/core-types.ts is stale: node scripts/core-types.mjs");
		process.exit(1);
	}
	process.exit(0);
}
writeFileSync(OUT, text);
