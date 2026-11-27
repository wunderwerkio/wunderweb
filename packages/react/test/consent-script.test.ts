// The consent client script as inlined into a page: minified (no tab,
// newline or comment, a size cap) and still working, both parts run in
// jsdom like in a browser: Consent Mode default first, vendor scripts only
// after the load event, the banner's "accept all" granting and queueing the
// Pixel. The Astro browser test covers the full page in Chrome.

import { type ConsentConfig, pageConsent } from "@wunderweb/core/consent";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { consentHeadScript, consentScript } from "../src/index.js";

const CONFIG: ConsentConfig = {
	version: 1,
	hosts: ["example.com"],
	categories: {
		statistics: ["analytics_storage"],
		marketing: ["ad_storage", "ad_user_data", "ad_personalization"],
		media: [],
	},
	vendors: {
		google: { ids: ["G-TEST123", "AW-123456789"] },
		meta: { id: "1234567890", category: "marketing" },
	},
};

const head = (config: ConsentConfig = CONFIG) =>
	consentHeadScript(pageConsent(config, "de", (u) => u));

/** A page with both parts and a banner with "accept all", on example.com. */
function page(config: ConsentConfig = CONFIG) {
	const dom = new JSDOM(
		`<!doctype html><html><head><script>${head(config)}</script></head><body>
<div id="wc-consent-banner" hidden><button data-wc-consent-action="accept">Alle akzeptieren</button></div>
<script>${consentScript}</script><p>content</p></body></html>`,
		{ url: "https://example.com/", runScripts: "dangerously" },
	);
	const w = dom.window as unknown as Window & {
		dataLayer: ArrayLike<unknown>[];
		fbq?: { queue: ArrayLike<unknown>[] };
	};
	return {
		w,
		layer: () => Array.from(w.dataLayer, (a) => Array.from(a)),
		srcs: () =>
			Array.from(w.document.querySelectorAll("script[src]"), (s) =>
				s.getAttribute("src"),
			),
	};
}

/** After the load event and the idle callback (setTimeout in jsdom). */
async function loaded(w: Window) {
	if (w.document.readyState !== "complete") {
		await new Promise((r) => w.addEventListener("load", r, { once: true }));
	}
	await new Promise((r) => setTimeout(r, 50));
}

const GTAG = "https://www.googletagmanager.com/gtag/js?id=G-TEST123";
const FBEVENTS = "https://connect.facebook.net/en_US/fbevents.js";

describe("consent client script", () => {
	it("is minified: no tab, newline or comment, small", () => {
		for (const script of [head(), consentScript]) {
			expect(script).not.toMatch(/[\t\n]/);
			// A comment: /* … */ or // (not the one in https://).
			expect(script).not.toMatch(/\/\*|(^|[^:])\/\//);
		}
		expect(head().length).toBeLessThan(1700);
		expect(consentScript.length).toBeLessThan(4500);
	});

	it("runs: default first, both configs, Google's tag only after the load event", async () => {
		const { w, layer, srcs } = page();
		expect(layer().slice(0, 3)).toEqual([
			[
				"consent",
				"default",
				{
					ad_storage: "denied",
					ad_user_data: "denied",
					ad_personalization: "denied",
					analytics_storage: "denied",
					wait_for_update: 500,
				},
			],
			["set", "ads_data_redaction", true],
			["set", "url_passthrough", true],
		]);
		expect(layer()[3]?.[0]).toBe("js");
		expect(layer().slice(4)).toEqual([
			["config", "G-TEST123"],
			["config", "AW-123456789"],
		]);
		expect(srcs()).toEqual([]);
		// No choice yet: the banner shows.
		expect(w.document.getElementById("wc-consent-banner")?.hidden).toBe(false);

		await loaded(w);
		expect(srcs()).toEqual([GTAG]);
	});

	it("accept all sends the granted update, queues the Pixel, loads fbevents.js after", async () => {
		const { w, layer, srcs } = page();
		await loaded(w);
		w.document
			.querySelector<HTMLElement>('[data-wc-consent-action="accept"]')
			?.click();
		expect(layer().at(-1)).toEqual([
			"consent",
			"update",
			{
				analytics_storage: "granted",
				ad_storage: "granted",
				ad_user_data: "granted",
				ad_personalization: "granted",
			},
		]);
		expect(Array.from(w.fbq?.queue ?? [], (a) => Array.from(a))).toEqual([
			["init", "1234567890"],
			["track", "PageView"],
		]);
		await loaded(w);
		expect(srcs()).toEqual([GTAG, FBEVENTS]);
		expect(w.document.getElementById("wc-consent-banner")?.hidden).toBe(true);
	});

	it("load: eager adds Google's tag at once", () => {
		const { srcs } = page({ ...CONFIG, load: "eager" });
		expect(srcs()).toEqual([GTAG]);
	});
});
