// Site stylesheets style the theme, not blocks (checked by `generate`).

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkSiteCss, componentClasses, selectors } from "../src/index.js";

function project(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "wc-css-"));
	for (const [f, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, f)), { recursive: true });
		writeFileSync(join(root, f), text);
	}
	return root;
}

const root = project({
	"blocks/Card/Card.tsx":
		'export const Card = () => <div className="wc-card-icon flex gap-3" />;',
	"blocks/Tiles/Tiles.tsx":
		// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source with a template literal
		"export const Tiles = ({ m }) => <div className={`wc-tiles wc-tiles-${m}`} />;",
	"blocks/Rating/Rating.tsx":
		'export const Rating = () => <span className="wc-stars" />;',
	"blocks/Person/Person.tsx":
		'export const Person = () => <span className="wc-stars" />;',
	"components/SiteButton.tsx":
		'export const B = () => <small className="wc-button-subtitle site-pill" />;',
});
const ctx = {
	richTextClasses: ["highlight-brush", "text-section"],
	componentClasses: componentClasses(root, join(root, "blocks")),
};
const check = (css: string) => checkSiteCss(css, "app/globals.css", ctx);

describe("site css", () => {
	it("allows theme styling: elements, rich text, buttons, regions, shared classes", () => {
		expect(
			check(`
				@import "tailwindcss";
				@theme { --font-display: x; }
				@layer base { html { color: red; } h1, h2 { font-size: 35px; } }
				.wc-rich .text-section, .wc-rich :is(h1, h2):has(> .highlight-brush) { font-size: 51px; }
				.wc-button[data-variant="primary"]:hover { color: red; }
				.wc-button .wc-button-subtitle { opacity: .7; }
				.wc-header:has([data-sticky]) { position: sticky; }
				.wc-stars { color: gold; }
				.site-pill { border-radius: 99px; }
				@keyframes spin { from { transform: none; } to { transform: rotate(1turn); } }
				@media (width >= 768px) { .wc-rich .text-section { font-size: 51px; } }
			`),
		).toEqual([]);
	});

	it("rejects block internals, runtime markup and region overrides", () => {
		const problems = check(`
			.wc-card-icon[data-icon-badge] .wc-icon { padding: 15px; }
			.wc-tiles-flex > .wc-Media { width: auto; }
			.wc-start > .wc-block > .wc-inner { height: 100%; }
			.wc-footer .wc-button[data-size="sm"] { min-height: 48px; }
			@media (width >= 768px) { .wc-Card .wc-icon { height: 60px; } }
		`).join("\n");
		expect(problems).toMatch(
			/\.wc-card-icon is rendered only by block Card; style it in blocks\/Card\/Card\.css/,
		);
		expect(problems).toMatch(/\.wc-icon is runtime markup/);
		expect(problems).toMatch(/\.wc-tiles-flex is rendered only by block Tiles/);
		expect(problems).toMatch(/\.wc-Media is runtime markup/);
		expect(problems).toMatch(/\.wc-inner is runtime markup/);
		expect(problems).toMatch(/\.wc-Card is rendered only by block Card/);
		expect(problems).toMatch(/styles blocks by page region \(\.wc-footer …\)/);
	});

	it("parses selector lists, skipping at-rule preludes, keyframes and strings", () => {
		expect(
			selectors(`
				/* .wc-x { } */
				.a, .b:is(.c, .d) > p { content: "}{"; }
				@media (width >= 1px) { .e { x: y; } }
				@keyframes k { from { x: y; } 50% { x: z; } }
				@supports (animation-timeline: view()) { .f { x: y; } }
			`),
		).toEqual([".a", ".b:is(.c, .d) > p", ".e", ".f"]);
	});
});
