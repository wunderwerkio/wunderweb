// Consent end to end in a browser: the Astro example (configured with
// consent) served by `astro dev` from a copy, every request leaving the
// page recorded by host and answered by a stub (Google, Meta, YouTube,
// Vimeo never see a test). WUNDERWEB_CONSENT_HOSTS allows 127.0.0.1, so
// the tags load as on the production host.
//
// Observed only from outside the page: what the visitor sees and operates,
// requests by host, the data layer, cookies and the stored choice.
//
// Needs the built packages (pnpm build) and Google Chrome (CHROME_PATH or
// a standard location).

import { type ChildProcess, spawn } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	type Browser,
	type BrowserContext,
	chromium,
	type Page,
} from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const EXAMPLE = join(ROOT, "examples", "astro");
const KEY = "wc-consent";

const CHROME = [
	process.env.CHROME_PATH,
	"/usr/bin/google-chrome",
	"/usr/local/bin/google-chrome",
	"/opt/google/chrome/chrome",
	"/usr/bin/chromium",
].find((p): p is string => Boolean(p && existsSync(p)));

let project: string;
let astro: ChildProcess;
let site: string;
let browser: Browser;

async function freePort(): Promise<number> {
	const s = createServer().listen(0);
	await new Promise((r) => s.once("listening", r));
	const { port } = s.address() as AddressInfo;
	await new Promise((r) => s.close(r));
	return port;
}

async function waitFor(url: string, timeout = 120000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url);
			if (res.ok) {
				return;
			}
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`${url} not up within ${timeout} ms`);
}

/** A visitor: a fresh browser context whose outgoing requests are recorded. */
interface Visitor {
	context: BrowserContext;
	page: Page;
	/** Hosts of every request that left the site, in order. */
	hosts: string[];
	urls: string[];
}

const STUBS: [RegExp, string, string][] = [
	[/googletagmanager\.com\/gtag\/js/, "text/javascript", "/* gtag.js stub */"],
	[/connect\.facebook\.net\//, "text/javascript", "/* fbevents.js stub */"],
];

async function visitor(
	opts: { stored?: unknown; javaScript?: boolean } = {},
): Promise<Visitor> {
	const context = await browser.newContext({
		javaScriptEnabled: opts.javaScript !== false,
		viewport: { width: 1280, height: 900 },
	});
	const v: Visitor = {
		context,
		page: await context.newPage(),
		hosts: [],
		urls: [],
	};
	await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => {
		const url = route.request().url();
		v.hosts.push(new URL(url).hostname);
		v.urls.push(url);
		const stub = STUBS.find(([re]) => re.test(url));
		return route.fulfill({
			status: 200,
			contentType: stub?.[1] ?? "text/html",
			body: stub?.[2] ?? "<!doctype html><title>stub</title>",
		});
	});
	if (opts.stored !== undefined) {
		// Before any page script, once: a reload keeps what the page stored.
		await context.addInitScript(
			([key, value]) => {
				if (!sessionStorage.getItem("wc-test-seeded")) {
					sessionStorage.setItem("wc-test-seeded", "1");
					localStorage.setItem(key as string, JSON.stringify(value));
				}
			},
			[KEY, opts.stored],
		);
	}
	return v;
}

const stored = (c: Record<string, boolean>, over: object = {}) => ({
	v: 1,
	t: Date.now(),
	c,
	...over,
});

/** The data layer as plain arrays, e.g. ["consent", "default", {...}]. */
const dataLayer = (page: Page) =>
	page.evaluate(() =>
		(
			(window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ??
			[]
		).map((a) => Array.from(a)),
	) as Promise<unknown[][]>;

const storedChoice = (page: Page) =>
	page.evaluate(
		(key) => JSON.parse(localStorage.getItem(key) ?? "null")?.c ?? null,
		KEY,
	);

const index = (layer: unknown[][], ...head: unknown[]) =>
	layer.findIndex((e) => head.every((h, i) => e[i] === h));

const ALL_DENIED = {
	analytics_storage: "denied",
	ad_storage: "denied",
	ad_user_data: "denied",
	ad_personalization: "denied",
};
const ALL_GRANTED = {
	analytics_storage: "granted",
	ad_storage: "granted",
	ad_user_data: "granted",
	ad_personalization: "granted",
};

/**
 * Holds the page's load event until `release()`: the page gets an image
 * that answers only then. DOMContentLoaded is not held.
 */
async function holdLoad(page: Page, url: string): Promise<() => void> {
	let release = () => {};
	const held = new Promise<void>((r) => {
		release = r;
	});
	await page.route("https://hold.test/**", async (route) => {
		await held;
		// The page may have navigated away meanwhile.
		await route.fulfill({ status: 204 }).catch(() => {});
	});
	await page.route(url, async (route) => {
		const res = await route.fetch();
		const body = (await res.text()).replace(
			"</body>",
			'<img src="https://hold.test/x.gif" alt=""></body>',
		);
		await route.fulfill({ response: res, body });
	});
	return release;
}

/** Records every script element with a src added to the page, with document.readyState then. */
const recordScripts = (context: BrowserContext) =>
	context.addInitScript(() => {
		const w = window as unknown as { __scripts: [string, string][] };
		w.__scripts = [];
		new MutationObserver((records) => {
			for (const r of records) {
				for (const n of r.addedNodes) {
					if (n instanceof HTMLScriptElement && n.src) {
						w.__scripts.push([n.src, document.readyState]);
					}
				}
			}
		}).observe(document, { childList: true, subtree: true });
	});

/** readyState when the first script matching `re` was added, undefined: not added. */
const addedAt = (page: Page, re: RegExp) =>
	page
		.evaluate(
			() => (window as unknown as { __scripts: [string, string][] }).__scripts,
		)
		.then((all) => all.find(([src]) => re.test(src))?.[1]);

const GTAG = /googletagmanager\.com\/gtag\/js/;
const FBEVENTS = /connect\.facebook\.net\/.*fbevents\.js/;

const touches = (v: Visitor, re: RegExp) => v.hosts.some((h) => re.test(h));
const META = /facebook\.(net|com)$/;
const VIDEO = /youtube|vimeo|ytimg/;

const banner = (page: Page) =>
	page.getByRole("dialog", { name: "Cookies und externe Dienste" });
const settings = (page: Page) =>
	page.getByRole("dialog", { name: "Cookie-Einstellungen" });

const E2E_TIMEOUT = 60000;
/** Vendor scripts come after the load event and an idle callback (up to 2 s). */
const VENDOR_LOAD = { timeout: 10000 };

describe.skipIf(!CHROME)("consent in the browser", () => {
	const contexts: BrowserContext[] = [];
	const visit = async (opts?: Parameters<typeof visitor>[0]) => {
		const v = await visitor(opts);
		contexts.push(v.context);
		return v;
	};

	beforeAll(async () => {
		project = mkdtempSync(join(tmpdir(), "wc-consent-e2e-"));
		for (const f of [
			"astro.config.mjs",
			"tsconfig.json",
			"package.json",
			"wunderweb.config.yaml",
			"theme.yaml",
			"content",
			"blocks",
			"generated",
			"src",
		]) {
			cpSync(join(EXAMPLE, f), join(project, f), { recursive: true });
		}
		symlinkSync(join(EXAMPLE, "node_modules"), join(project, "node_modules"));
		const port = await freePort();
		site = `http://127.0.0.1:${port}`;
		astro = spawn(
			join(EXAMPLE, "node_modules", ".bin", "astro"),
			["dev", "--port", String(port), "--host", "127.0.0.1"],
			{
				cwd: project,
				env: {
					...Object.fromEntries(
						Object.entries(process.env).filter(
							([k]) => !k.startsWith("VITEST"),
						),
					),
					NODE_ENV: "development",
					WUNDERWEB_CONSENT_HOSTS: "127.0.0.1",
					ASTRO_TELEMETRY_DISABLED: "1",
				},
				stdio: "ignore",
			},
		);
		await waitFor(`${site}/`);
		browser = await chromium.launch({
			headless: true,
			...(CHROME ? { executablePath: CHROME } : {}),
		});
	}, 180000);

	afterAll(async () => {
		for (const c of contexts) {
			await c.close().catch(() => {});
		}
		await browser?.close();
		astro?.kill("SIGTERM");
		if (project) {
			rmSync(project, { recursive: true, force: true });
		}
	});

	it(
		"first visit: banner, Consent Mode default denied before any config, Google loads, nothing else",
		async () => {
			const v = await visit();
			await v.page.goto(`${site}/`);
			await expect.poll(() => banner(v.page).isVisible()).toBe(true);

			const layer = await dataLayer(v.page);
			const dflt = index(layer, "consent", "default");
			expect(dflt).toBe(0);
			expect(layer[dflt]?.[2]).toMatchObject(ALL_DENIED);
			expect(index(layer, "consent", "update")).toBe(-1);
			expect(index(layer, "config", "G-EXAMPLE123")).toBeGreaterThan(dflt);
			expect(index(layer, "config", "AW-123456789")).toBeGreaterThan(dflt);
			await expect
				.poll(
					() => v.urls.some((u) => u.includes("googletagmanager.com/gtag/js")),
					VENDOR_LOAD,
				)
				.toBe(true);

			const cookies = await v.context.cookies();
			expect(cookies.filter((c) => c.name.startsWith("_ga"))).toEqual([]);
			expect(touches(v, META)).toBe(false);
			expect(touches(v, VIDEO)).toBe(false);
			// Both videos wait behind gates naming their vendor.
			expect(await v.page.locator("iframe").count()).toBe(0);
			await expect
				.poll(() =>
					v.page
						.getByRole("button", { name: "YouTube einmal laden" })
						.isVisible(),
				)
				.toBe(true);
			await expect
				.poll(() =>
					v.page
						.getByRole("button", { name: "Vimeo einmal laden" })
						.isVisible(),
				)
				.toBe(true);
			// No category is stored before the visitor decides.
			expect(await storedChoice(v.page)).toBeNull();
		},
		E2E_TIMEOUT,
	);

	it(
		"accept all: every signal granted, Meta loads, the gates turn into the videos",
		async () => {
			const v = await visit();
			await v.page.goto(`${site}/`);
			await banner(v.page)
				.getByRole("button", { name: "Alle akzeptieren" })
				.click();
			await expect.poll(() => banner(v.page).isVisible()).toBe(false);

			const layer = await dataLayer(v.page);
			const update = layer.find((e) => e[0] === "consent" && e[1] === "update");
			expect(update?.[2]).toEqual(ALL_GRANTED);
			await expect
				.poll(
					() => v.urls.some((u) => u.includes("connect.facebook.net")),
					VENDOR_LOAD,
				)
				.toBe(true);
			const fbq = await v.page.evaluate(() =>
				(
					window as unknown as { fbq: { queue: ArrayLike<unknown>[] } }
				).fbq.queue.map((a) => Array.from(a)),
			);
			expect(fbq).toEqual([
				["init", "1234567890"],
				["track", "PageView"],
			]);
			await expect
				.poll(() =>
					v.page
						.locator('iframe[src^="https://www.youtube-nocookie.com/embed/"]')
						.count(),
				)
				.toBe(1);
			expect(
				await v.page
					.locator('iframe[src^="https://player.vimeo.com/"]')
					.count(),
			).toBe(1);
			expect(await storedChoice(v.page)).toEqual({
				statistics: true,
				marketing: true,
				media: true,
			});
		},
		E2E_TIMEOUT,
	);

	it(
		"only necessary: everything stays denied, no Meta, no YouTube",
		async () => {
			const v = await visit();
			await v.page.goto(`${site}/`);
			await banner(v.page)
				.getByRole("button", { name: "Nur notwendige" })
				.click();
			await expect.poll(() => banner(v.page).isVisible()).toBe(false);
			const layer = await dataLayer(v.page);
			const update = layer.find((e) => e[0] === "consent" && e[1] === "update");
			expect(update?.[2]).toEqual(ALL_DENIED);
			await v.page.waitForTimeout(300);
			expect(touches(v, META)).toBe(false);
			expect(touches(v, VIDEO)).toBe(false);
			expect(await v.page.locator("iframe").count()).toBe(0);
			expect(await storedChoice(v.page)).toEqual({
				statistics: false,
				marketing: false,
				media: false,
			});
		},
		E2E_TIMEOUT,
	);

	it(
		"a selection of only Statistik grants analytics, no advertising signal, no Meta",
		async () => {
			const v = await visit();
			await v.page.goto(`${site}/`);
			await banner(v.page)
				.getByRole("button", { name: "Einstellungen" })
				.click();
			const dialog = settings(v.page);
			await expect.poll(() => dialog.isVisible()).toBe(true);
			// Nothing pre-ticked; necessary is always on.
			for (const name of ["Statistik", "Marketing", "Externe Medien"]) {
				expect(await dialog.getByRole("checkbox", { name }).isChecked()).toBe(
					false,
				);
			}
			expect(
				await dialog.getByRole("checkbox", { name: /Notwendig/ }).isChecked(),
			).toBe(true);
			expect(
				await dialog.getByRole("checkbox", { name: /Notwendig/ }).isDisabled(),
			).toBe(true);
			// Purpose and vendors per category.
			expect(await dialog.textContent()).toContain("Google Analytics");
			expect(await dialog.textContent()).toContain("Google Ads");
			expect(await dialog.textContent()).toContain("Meta");
			expect(
				await dialog
					.getByRole("link", { name: "Datenschutzerklärung" })
					.getAttribute("href"),
			).toBe("/datenschutz");

			await dialog.getByRole("checkbox", { name: "Statistik" }).check();
			await dialog.getByRole("button", { name: "Auswahl speichern" }).click();
			await expect.poll(() => dialog.isVisible()).toBe(false);
			const layer = await dataLayer(v.page);
			const update = layer.find((e) => e[0] === "consent" && e[1] === "update");
			expect(update?.[2]).toEqual({
				...ALL_DENIED,
				analytics_storage: "granted",
			});
			await v.page.waitForTimeout(300);
			expect(touches(v, META)).toBe(false);
			expect(await storedChoice(v.page)).toEqual({
				statistics: true,
				marketing: false,
				media: false,
			});
		},
		E2E_TIMEOUT,
	);

	it(
		"a returning visitor's choice is applied before the first config, without a banner",
		async () => {
			const v = await visit({
				stored: stored({ statistics: true, marketing: false, media: true }),
			});
			await v.page.goto(`${site}/`);
			const layer = await dataLayer(v.page);
			const update = index(layer, "consent", "update");
			expect(update).toBeGreaterThan(index(layer, "consent", "default"));
			expect(update).toBeLessThan(index(layer, "config", "G-EXAMPLE123"));
			expect(layer[update]?.[2]).toEqual({
				...ALL_DENIED,
				analytics_storage: "granted",
			});
			await expect
				.poll(() => v.page.locator('iframe[src*="youtube-nocookie"]').count())
				.toBe(1);
			expect(await banner(v.page).isVisible()).toBe(false);
		},
		E2E_TIMEOUT,
	);

	it(
		"asks again when the consent version was raised or the choice expired",
		async () => {
			const old = await visit({
				stored: stored(
					{ statistics: true, marketing: true, media: true },
					{ v: 0 },
				),
			});
			await old.page.goto(`${site}/`);
			await expect.poll(() => banner(old.page).isVisible()).toBe(true);
			expect(index(await dataLayer(old.page), "consent", "update")).toBe(-1);

			const expired = await visit({
				stored: stored(
					{ statistics: true, marketing: true, media: true },
					{ t: Date.now() - 366 * 86400000 },
				),
			});
			await expired.page.goto(`${site}/`);
			await expect.poll(() => banner(expired.page).isVisible()).toBe(true);
			expect(touches(expired, META)).toBe(false);

			// A time in the future (a changed clock) counts as expired too.
			const future = await visit({
				stored: stored(
					{ statistics: true, marketing: true, media: true },
					{ t: Date.now() + 30 * 86400000 },
				),
			});
			await future.page.goto(`${site}/`);
			await expect.poll(() => banner(future.page).isVisible()).toBe(true);
		},
		E2E_TIMEOUT,
	);

	it(
		"load once: that video loads, the stored choice is unchanged, other gates stay",
		async () => {
			const v = await visit({
				stored: stored({ statistics: false, marketing: false, media: false }),
			});
			await v.page.goto(`${site}/`);
			await v.page
				.getByRole("button", { name: "YouTube einmal laden" })
				.click();
			await expect
				.poll(() => v.page.locator('iframe[src*="youtube-nocookie"]').count())
				.toBe(1);
			expect(await v.page.locator('iframe[src*="vimeo"]').count()).toBe(0);
			expect(
				await v.page
					.getByRole("button", { name: "Vimeo einmal laden" })
					.isVisible(),
			).toBe(true);
			expect(await storedChoice(v.page)).toEqual({
				statistics: false,
				marketing: false,
				media: false,
			});
		},
		E2E_TIMEOUT,
	);

	it(
		"always allow from a gate grants external media and loads every gate",
		async () => {
			const v = await visit({
				stored: stored({ statistics: false, marketing: false, media: false }),
			});
			await v.page.goto(`${site}/`);
			await v.page
				.getByRole("button", { name: "Externe Medien immer erlauben" })
				.first()
				.click();
			await expect.poll(() => v.page.locator("iframe").count()).toBe(2);
			expect(await storedChoice(v.page)).toEqual({
				statistics: false,
				marketing: false,
				media: true,
			});
		},
		E2E_TIMEOUT,
	);

	it(
		"the consent:settings button and rich-text link open the settings with the stored choice",
		async () => {
			const v = await visit({
				stored: stored({ statistics: true, marketing: false, media: true }),
			});
			await v.page.goto(`${site}/datenschutz`);
			const dialog = settings(v.page);
			for (const opener of [
				v.page
					.locator("footer")
					.getByRole("button", { name: "Cookie-Einstellungen" }),
				v.page
					.locator("main")
					.getByRole("link", { name: "Cookie-Einstellungen" }),
			]) {
				await opener.click();
				await expect.poll(() => dialog.isVisible()).toBe(true);
				expect(
					await dialog.getByRole("checkbox", { name: "Statistik" }).isChecked(),
				).toBe(true);
				expect(
					await dialog.getByRole("checkbox", { name: "Marketing" }).isChecked(),
				).toBe(false);
				expect(
					await dialog
						.getByRole("checkbox", { name: "Externe Medien" })
						.isChecked(),
				).toBe(true);
				await dialog.getByRole("button", { name: "Schließen" }).click();
				await expect.poll(() => dialog.isVisible()).toBe(false);
			}
			// No floating button: the settings open only from content.
			expect(v.page.url()).toBe(`${site}/datenschutz`);
		},
		E2E_TIMEOUT,
	);

	it(
		"withdrawing Marketing sends the denied update, removes its cookies and reloads without Meta",
		async () => {
			const v = await visit({
				stored: stored({ statistics: true, marketing: true, media: false }),
			});
			await v.page.goto(`${site}/`);
			await expect
				.poll(
					() => v.urls.some((u) => u.includes("connect.facebook.net")),
					VENDOR_LOAD,
				)
				.toBe(true);
			// What the vendors would have set (the stubs set nothing).
			await v.context.addCookies(
				["_fbp", "_gcl_au", "_ga"].map((name) => ({
					name,
					value: "1.1.1",
					domain: "127.0.0.1",
					path: "/",
				})),
			);
			const sent: unknown[][] = [];
			await v.page.exposeFunction("__record", (e: unknown[]) => sent.push(e));
			await v.page.evaluate(() => {
				const w = window as unknown as {
					dataLayer: { push: (a: ArrayLike<unknown>) => number };
					__record: (e: unknown[]) => void;
				};
				const push = w.dataLayer.push.bind(w.dataLayer);
				w.dataLayer.push = (a) => {
					w.__record(Array.from(a));
					return push(a);
				};
			});

			const metaBefore = v.urls.filter((u) =>
				u.includes("connect.facebook.net"),
			).length;
			await v.page
				.locator("footer")
				.getByRole("button", { name: "Cookie-Einstellungen" })
				.click();
			const dialog = settings(v.page);
			await dialog.getByRole("checkbox", { name: "Marketing" }).uncheck();
			const reloaded = v.page.waitForEvent("load");
			await dialog.getByRole("button", { name: "Auswahl speichern" }).click();
			await reloaded;

			expect(sent).toContainEqual([
				"consent",
				"update",
				{ ...ALL_DENIED, analytics_storage: "granted" },
			]);
			const names = (await v.context.cookies()).map((c) => c.name);
			expect(names).not.toContain("_fbp");
			expect(names).not.toContain("_gcl_au");
			expect(names).toContain("_ga");
			await v.page.waitForTimeout(300);
			expect(
				v.urls.filter((u) => u.includes("connect.facebook.net")).length,
			).toBe(metaBefore);
			expect(await v.page.evaluate(() => "fbq" in window)).toBe(false);
			expect(await storedChoice(v.page)).toEqual({
				statistics: true,
				marketing: false,
				media: false,
			});
		},
		E2E_TIMEOUT,
	);

	it(
		"keyboard: the banner comes first, the dialog keeps focus, Escape closes without saving",
		async () => {
			const v = await visit();
			await v.page.goto(`${site}/`);
			await expect.poll(() => banner(v.page).isVisible()).toBe(true);
			// Without style.reject both choices share one variant.
			const variant = (action: string) =>
				banner(v.page)
					.locator(`[data-wc-consent-action="${action}"]`)
					.getAttribute("data-variant");
			expect(await variant("reject")).toBe(await variant("accept"));
			// The description is the text, not the links after it.
			expect(
				await banner(v.page)
					.getAttribute("aria-describedby")
					.then((id) => v.page.locator(`#${id}`).textContent()),
			).not.toContain("Einstellungen");
			// First stop: the banner's privacy link, the settings link next to
			// it, then the two choices ("accept all" last, on the right).
			await v.page.keyboard.press("Tab");
			expect(
				await v.page.evaluate(
					() => document.activeElement?.closest("#wc-consent-banner") !== null,
				),
			).toBe(true);
			expect(
				await v.page.evaluate(() => document.activeElement?.textContent),
			).toBe("Datenschutzerklärung");
			await v.page.keyboard.press("Tab");
			expect(
				await v.page.evaluate(() => document.activeElement?.textContent),
			).toBe("Einstellungen");
			await v.page.keyboard.press("Tab");
			expect(
				await v.page.evaluate(() => document.activeElement?.textContent),
			).toBe("Nur notwendige");
			await v.page.keyboard.press("Tab");
			expect(
				await v.page.evaluate(() => document.activeElement?.textContent),
			).toBe("Alle akzeptieren");
			await v.page.keyboard.press("Shift+Tab");
			await v.page.keyboard.press("Shift+Tab");
			await v.page.keyboard.press("Enter");
			const dialog = settings(v.page);
			await expect.poll(() => dialog.isVisible()).toBe(true);
			for (let i = 0; i < 12; i++) {
				await v.page.keyboard.press("Tab");
				expect(
					await v.page.evaluate(
						() =>
							document.activeElement?.closest("#wc-consent-settings") !== null,
					),
				).toBe(true);
			}
			await dialog.getByRole("checkbox", { name: "Marketing" }).check();
			await v.page.keyboard.press("Escape");
			await expect.poll(() => dialog.isVisible()).toBe(false);
			expect(await storedChoice(v.page)).toBeNull();
			expect(await banner(v.page).isVisible()).toBe(true);
			// Focus returns to the button that opened the dialog.
			expect(
				await v.page.evaluate(() => document.activeElement?.textContent),
			).toBe("Einstellungen");
		},
		E2E_TIMEOUT,
	);

	it(
		"without JavaScript the gate offers the link to the original, no iframe",
		async () => {
			const v = await visit({ javaScript: false });
			await v.page.goto(`${site}/`);
			expect(await v.page.locator("iframe").count()).toBe(0);
			await expect
				.poll(() =>
					v.page
						.getByRole("link", { name: "Bei YouTube öffnen" })
						.getAttribute("href"),
				)
				.toBe("https://www.youtube.com/watch?v=2oV060kNYfU");
			expect(
				await v.page
					.getByRole("button", { name: "YouTube einmal laden" })
					.count(),
			).toBe(0);
			expect(touches(v, VIDEO)).toBe(false);
		},
		E2E_TIMEOUT,
	);

	it(
		"English pages ask in English",
		async () => {
			const v = await visit();
			await v.page.goto(`${site}/en`);
			await expect
				.poll(() =>
					v.page
						.getByRole("dialog", { name: "Cookies and external services" })
						.isVisible(),
				)
				.toBe(true);
			expect(
				await v.page
					.getByRole("button", { name: "Load YouTube once" })
					.isVisible(),
			).toBe(true);
		},
		E2E_TIMEOUT,
	);

	it(
		"Google's tag and the Pixel are added after the load event; commands queue before",
		async () => {
			const v = await visit({
				stored: stored({ statistics: true, marketing: true, media: false }),
			});
			await recordScripts(v.context);
			const release = await holdLoad(v.page, `${site}/`);
			await v.page.goto(`${site}/`, { waitUntil: "domcontentloaded" });
			await v.page.waitForTimeout(500);
			expect(await v.page.evaluate(() => document.readyState)).toBe(
				"interactive",
			);
			// Consent and config are queued, the Pixel's queue is filled …
			const layer = await dataLayer(v.page);
			expect(index(layer, "consent", "default")).toBe(0);
			expect(index(layer, "config", "G-EXAMPLE123")).toBeGreaterThan(
				index(layer, "consent", "update"),
			);
			expect(
				await v.page.evaluate(() =>
					(
						window as unknown as { fbq: { queue: ArrayLike<unknown>[] } }
					).fbq.queue.map((a) => Array.from(a)),
				),
			).toEqual([
				["init", "1234567890"],
				["track", "PageView"],
			]);
			// … but neither vendor script is on the page yet.
			expect(await addedAt(v.page, GTAG)).toBeUndefined();
			expect(await addedAt(v.page, FBEVENTS)).toBeUndefined();
			expect(v.urls.some((u) => GTAG.test(u) || FBEVENTS.test(u))).toBe(false);

			release();
			await expect
				.poll(() => v.urls.some((u) => GTAG.test(u)), VENDOR_LOAD)
				.toBe(true);
			await expect
				.poll(() => v.urls.some((u) => FBEVENTS.test(u)), VENDOR_LOAD)
				.toBe(true);
			expect(await addedAt(v.page, GTAG)).toBe("complete");
			expect(await addedAt(v.page, FBEVENTS)).toBe("complete");
		},
		E2E_TIMEOUT,
	);

	it(
		"load: eager adds Google's tag while the page is still loading",
		async () => {
			const config = join(project, "wunderweb.config.yaml");
			const original = readFileSync(config, "utf8");
			writeFileSync(
				config,
				original.replace(/\nconsent:\n/, "\nconsent:\n  load: eager\n"),
			);
			try {
				const v = await visit();
				await recordScripts(v.context);
				const release = await holdLoad(v.page, `${site}/`);
				// The dev server picks the config up on a later request.
				await expect
					.poll(
						async () => {
							await v.page.goto(`${site}/`, { waitUntil: "domcontentloaded" });
							return v.page.evaluate(
								() =>
									(
										window as unknown as {
											__wcConsent?: { config: { load?: string } };
										}
									).__wcConsent?.config.load,
							);
						},
						{ timeout: 30000 },
					)
					.toBe("eager");
				const state = await addedAt(v.page, GTAG);
				expect(state).toBeDefined();
				expect(state).not.toBe("complete");
				expect(await v.page.evaluate(() => document.readyState)).not.toBe(
					"complete",
				);
				release();
			} finally {
				writeFileSync(config, original);
			}
		},
		E2E_TIMEOUT,
	);

	it(
		"a site without consent config renders as before: no banner, the iframe",
		async () => {
			const config = join(project, "wunderweb.config.yaml");
			const original = readFileSync(config, "utf8");
			writeFileSync(config, original.replace(/\nconsent:[\s\S]*$/, "\n"));
			writeFileSync(
				join(project, "content", "de", "fragments", "footer.yaml"),
				"fragment: footer\nblocks:\n  - {type: Text, body: <p>Footer</p>}\n",
			);
			writeFileSync(
				join(project, "content", "de", "pages", "privacy.yaml"),
				"id: privacy\ntitle: Datenschutz\npath: /datenschutz\nblocks:\n  - {type: Text, body: <p>x</p>}\n",
			);
			writeFileSync(
				join(project, "content", "en", "fragments", "footer.yaml"),
				"fragment: footer\nblocks:\n  - {type: Text, body: <p>Footer</p>}\n",
			);
			writeFileSync(
				join(project, "content", "en", "pages", "privacy.yaml"),
				"id: privacy\ntitle: Privacy\npath: /privacy\nblocks:\n  - {type: Text, body: <p>x</p>}\n",
			);
			const v = await visit();
			await expect
				.poll(
					async () => {
						await v.page.goto(`${site}/`);
						return v.page.locator('iframe[src*="youtube-nocookie"]').count();
					},
					{ timeout: 30000 },
				)
				.toBe(1);
			expect(
				await v.page
					.locator("#wc-consent-banner, #wc-consent-settings")
					.count(),
			).toBe(0);
			expect(await v.page.evaluate(() => "dataLayer" in window)).toBe(false);
			expect(touches(v, /googletagmanager/)).toBe(false);
		},
		E2E_TIMEOUT,
	);
});
