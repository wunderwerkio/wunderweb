// The canonical YAML form of a content file, from core (the CLI's `format`
// and the hosted editor's normalize both use it).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatYaml, NOT_CANONICAL, Walker } from "../src/index.js";

/** The walker of a site with blocks (the Astro example's schema). */
const walker = () =>
	new Walker(
		JSON.parse(
			readFileSync(
				join(
					import.meta.dirname,
					"../../../examples/astro/generated/schema.json",
				),
				"utf8",
			),
		),
	);

describe("formatYaml", () => {
	it("leaves a canonical file as it is", () => {
		const text = "title: Home\nblocks:\n  - type: Text\n    body: <p>a</p>\n";
		expect(formatYaml(text)).toEqual({ text, changed: false, ids: 0 });
	});

	it("rewrites another form, keeping comments and quoting", () => {
		const r = formatYaml("# home\ntitle:   'Home'\nblocks: [ ]\n");
		expect(r).toEqual({
			text: "# home\ntitle: 'Home'\nblocks: []\n",
			changed: true,
			ids: 0,
		});
	});

	it("fills in missing block ids right after the type", () => {
		const r = formatYaml(
			"title: Home\nblocks:\n  - type: Text\n    body: <p>a</p>\n",
			{ walker: walker(), root: "Page" },
		);
		expect(r).toMatchObject({ changed: true, ids: 1 });
		expect("text" in r && r.text).toMatch(
			/^title: Home\nblocks:\n {2}- type: Text\n {4}id: [a-z0-9]{8}\n {4}body: <p>a<\/p>\n$/,
		);
	});

	it("refuses to write an id where it would change the content", () => {
		// The second block is an alias of the first: its id cannot be its own.
		const r = formatYaml(
			"title: Home\nblocks:\n  - &t {type: Text, body: <p>a</p>}\n  - *t\n",
			{ walker: walker(), root: "Page" },
		);
		expect(r).toMatchObject({ kind: "unsafe" });
	});

	it("refuses a file that is not one YAML document", () => {
		expect(formatYaml("a: 1\n---\nb: 2\n")).toEqual({
			error: "a content file holds one YAML document",
			kind: "yaml",
		});
		expect(formatYaml("title: [\n")).toMatchObject({ kind: "yaml" });
	});

	it("names the command that makes a file editable", () => {
		expect(NOT_CANONICAL).toContain("format");
	});
});
