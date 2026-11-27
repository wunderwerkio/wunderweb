// parseConfig: a site config from its text (a hosted service reads it from
// git); loadProject reads the same rules from disk.

import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/index.js";

describe("parseConfig", () => {
	it("fills in the defaults and keeps paths as written", () => {
		const c = parseConfig(
			"schema: 1\nlocales: [de, en]\ndefaultLocale: de\ncontent: ./site/content\n",
		);
		expect(c).toMatchObject({
			schema: 1,
			locales: ["de", "en"],
			defaultLocale: "de",
			content: "./site/content",
			generated: "./generated",
			theme: "./theme.yaml",
		});
	});

	it("names every problem of an invalid config", () => {
		expect(() => parseConfig("locales: []\ndefaultLocale: fr\n")).toThrow(
			/schema: core major version.*locales: at least one locale.*defaultLocale must be one of locales/,
		);
		expect(() =>
			parseConfig(
				"schema: 1\nlocales: [de]\ndefaultLocale: de\npackages: [a, a]\n",
			),
		).toThrow(/a package is listed twice/);
		// Wrong types, and an explicit null over a default.
		expect(() =>
			parseConfig(
				"schema: 1\nlocales: de\ndefaultLocale: de\ncontent: ~\ngenerated: 5\n",
			),
		).toThrow(
			/content: path required; generated: path required; locales: list of locale codes; defaultLocale must be one of locales/,
		);
		expect(() =>
			parseConfig("schema: 1\nlocales: [de, 3]\ndefaultLocale: de\n"),
		).toThrow(/locales: list of locale codes/);
		expect(() => parseConfig("")).toThrow(/not a mapping/);
		expect(() => parseConfig("- a\n- b\n")).toThrow(/not a mapping/);
	});
});
