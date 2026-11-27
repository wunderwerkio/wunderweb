// @vitest-environment jsdom
// The edit mode refresh: the page is fetched again and swapped in place;
// unchanged elements keep their DOM, tooling elements stay.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mountRefresh } from "../src/refresh-script.js";

type RefreshWindow = Window & { __wunderwebRefresh?: () => void };

const page = (main: string, extra = "") =>
	`<!doctype html><html lang="en"><head><title>T ${main}</title></head><body>` +
	`<header class="wc-header"><nav>Nav</nav></header>` +
	`<main class="wc-main" data-wc-revision="${main}"><p>${main}</p></main>` +
	`<footer class="wc-footer">Footer</footer>${extra}` +
	`<script id="wc-page" type="application/json">{"revision":${main}}</script>` +
	"<script>/* bridge */</script></body></html>";

function load(html: string) {
	const doc = new DOMParser().parseFromString(html, "text/html");
	document.documentElement.lang = "de";
	document.body.replaceChildren(
		...[...doc.body.children].map((el) => document.importNode(el, true)),
	);
	const host = document.createElement("div");
	host.setAttribute("data-wc-bridge", "");
	document.body.append(host);
}

const refresh = () => (window as RefreshWindow).__wunderwebRefresh?.();

describe("mountRefresh", () => {
	let responses: string[];
	let fetches: number;

	beforeEach(() => {
		delete (window as RefreshWindow).__wunderwebRefresh;
		responses = [];
		fetches = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				fetches++;
				return new Response(responses.shift() ?? page("0"), { status: 200 });
			}),
		);
		load(page("1"));
		mountRefresh();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("replaces changed elements only and keeps the bridge", async () => {
		const header = document.querySelector("header");
		responses.push(page("2"));
		refresh();
		await vi.waitFor(() =>
			expect(document.querySelector("main")?.dataset.wcRevision).toBe("2"),
		);
		expect(document.querySelector("header")).toBe(header);
		expect(document.querySelector("[data-wc-bridge]")).not.toBeNull();
		expect(document.querySelector("#wc-page")?.textContent).toBe(
			'{"revision":2}',
		);
		expect(document.title).toBe("T 2");
		expect(document.documentElement.lang).toBe("en");
		expect(document.querySelectorAll("main")).toHaveLength(1);
	});

	it("asks for the framed render: a fetch is no frame navigation, so it sends the frame header", async () => {
		refresh();
		await vi.waitFor(() => expect(fetches).toBe(1));
		const init = vi.mocked(fetch).mock.calls[0]?.[1];
		expect(new Headers(init?.headers).get("x-wunderweb-frame")).toBe("1");
	});

	it("swaps the whole content when elements were added", async () => {
		responses.push(page("2", '<div id="wc-dialog-x" popover>Dialog</div>'));
		refresh();
		await vi.waitFor(() =>
			expect(document.getElementById("wc-dialog-x")).not.toBeNull(),
		);
		const order = [...document.body.children].map(
			(el) => el.id || el.tagName.toLowerCase(),
		);
		expect(order).toEqual([
			"header",
			"main",
			"footer",
			"wc-dialog-x",
			"wc-page",
			"script",
			"div",
		]);
	});

	it("runs one refresh at a time and once more for calls during it", async () => {
		responses.push(page("2"), page("3"));
		refresh();
		refresh();
		refresh();
		await vi.waitFor(() =>
			expect(document.querySelector("main")?.dataset.wcRevision).toBe("3"),
		);
		expect(fetches).toBe(2);
	});

	it("registers once", () => {
		const first = (window as RefreshWindow).__wunderwebRefresh;
		mountRefresh();
		expect((window as RefreshWindow).__wunderwebRefresh).toBe(first);
	});
});
