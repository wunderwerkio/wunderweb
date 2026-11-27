// The names from before the rename to wunderweb, still read for a
// transition (plan q7qmb9, decision 7): the config file
// wundercms.config.yaml and the package blocks key "wundercms", each with a
// deprecation warning. New names win; both config files at once are an error.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	CONFIG_FILE,
	configFileOf,
	findProject,
	LEGACY_CONFIG_FILE,
	loadProject,
} from "../src/index.js";

function write(root: string, files: Record<string, string>) {
	for (const [f, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, f)), { recursive: true });
		writeFileSync(join(root, f), text);
	}
}

const CONFIG = "schema: 1\nlocales: [de]\ndefaultLocale: de\n";

function project(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "wunderweb-legacy-"));
	write(root, files);
	return root;
}

afterEach(() => {
	vi.restoreAllMocks();
});

const warnings = () => {
	const spy = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
	return () => spy.mock.calls.map((c) => String(c[0]));
};

describe("the legacy config file", () => {
	it("names the files", () => {
		expect(CONFIG_FILE).toBe("wunderweb.config.yaml");
		expect(LEGACY_CONFIG_FILE).toBe("wundercms.config.yaml");
	});

	it("loads a project that has only wundercms.config.yaml, with a warning", () => {
		const seen = warnings();
		const root = project({ [LEGACY_CONFIG_FILE]: CONFIG });
		mkdirSync(join(root, "sub"));
		const p = findProject(join(root, "sub"));
		expect(p.root).toBe(root);
		expect(p.config.locales).toEqual(["de"]);
		expect(loadProject(root).config.defaultLocale).toBe("de");
		expect(seen()).toEqual([
			expect.stringMatching(
				/wundercms\.config\.yaml is deprecated: rename it to wunderweb\.config\.yaml \(`wunderweb migrate`\)/,
			),
		]);
	});

	it("prefers nothing when both exist: that is an error", () => {
		const root = project({
			[CONFIG_FILE]: CONFIG,
			[LEGACY_CONFIG_FILE]: CONFIG,
		});
		expect(() => findProject(root)).toThrow(
			/both wunderweb\.config\.yaml and wundercms\.config\.yaml/,
		);
		expect(() => loadProject(root)).toThrow(/both/);
	});

	it("loads the new name without a warning", () => {
		const seen = warnings();
		const root = project({ [CONFIG_FILE]: CONFIG });
		expect(findProject(root).root).toBe(root);
		expect(seen()).toEqual([]);
	});

	it("picks the file from a listing (a commit's tree)", () => {
		expect(configFileOf((f) => f === CONFIG_FILE)).toBe(CONFIG_FILE);
		expect(configFileOf((f) => f === LEGACY_CONFIG_FILE)).toBe(
			LEGACY_CONFIG_FILE,
		);
		expect(configFileOf(() => false)).toBeUndefined();
		expect(() => configFileOf(() => true)).toThrow(/both/);
	});
});

describe("the legacy package blocks key", () => {
	it('reads "wundercms": {"blocks"} of a package, with a warning', () => {
		const seen = warnings();
		const root = project({
			[CONFIG_FILE]: `${CONFIG}packages: ["@acme/old-kit"]\n`,
			"node_modules/@acme/old-kit/package.json": JSON.stringify({
				name: "@acme/old-kit",
				wundercms: { blocks: "./blocks" },
			}),
			"node_modules/@acme/old-kit/blocks/Note/block.yaml":
				"in: [PageBlock]\nfields:\n  body: string\n",
		});
		const p = loadProject(root);
		expect(p.packageBlocks).toEqual([
			expect.objectContaining({
				package: "@acme/old-kit",
				specifier: "@acme/old-kit/blocks",
			}),
		]);
		expect(seen()).toEqual([
			expect.stringMatching(
				/@acme\/old-kit: "wundercms" in its package\.json is deprecated: name it "wunderweb"/,
			),
		]);
	});
});
