// The imgproxy transformer: signed /_img urls instead of build-time copies
// (ADR 0007). Signatures are checked against imgproxy's documented example
// and against values computed with openssl, not with the code under test.

import type { SitePage, SourcePage } from "@wunderweb/core";
import { describe, expect, it, vi } from "vitest";

import {
	imgproxySignature,
	imgproxyTransformer,
	responsiveImages,
} from "../src/index.js";

// imgproxy docs, "Signing a URL": key "secret", salt "hello", hex-encoded.
const KEY = "736563726574";
const SALT = "68656C6C6F";

describe("imgproxySignature", () => {
	it("matches imgproxy's documented example", () => {
		expect(
			imgproxySignature(
				"/rs:fill:300:400:0/g:sm/aHR0cDovL2V4YW1w/bGUuY29tL2ltYWdl/cy9jdXJpb3NpdHku/anBn.png",
				KEY,
				SALT,
			),
		).toBe("oKfUtW34Dvo2BGQehJFR4Nr0_rIjOtdtzJ3QFsUcXH8");
	});
});

describe("imgproxyTransformer", () => {
	const CDN = "https://cdn.test/media/a.jpg";
	const BUCKET = "https://bucket.test/media/a.jpg";
	// base64url("https://bucket.test/media/a.jpg"), no padding.
	const ENCODED = "aHR0cHM6Ly9idWNrZXQudGVzdC9tZWRpYS9hLmpwZw";
	// `printf 'hello<path>' | openssl dgst -sha256 -hmac secret -binary | base64url`
	const SIG_256 = "x-KDGVCj4ac7xoiyHtPw33L9-2iI1S9d_gmtl-Ouos4";
	const SIG_400 = "NN-eAQ0EjX9QiCeXCRZOC8-yQqLGSpXrfoZxUSwNTlA";

	const sized = () =>
		vi.fn(async (_url: string) => ({ width: 400, height: 300 }));
	const transformer = (size = sized()) =>
		imgproxyTransformer({
			key: KEY,
			salt: SALT,
			size,
			source: (url) => url.replace("https://cdn.test/", "https://bucket.test/"),
		});

	it("signs one extensionless /_img url per width, fit to the width", async () => {
		const t = transformer();
		const size = { width: 400, height: 300 };
		expect(await t.resize(CDN, size, [256, 384])).toEqual([
			{
				url: `/_img/${SIG_256}/rs:fit:256:0/${ENCODED}`,
				width: 256,
				height: 192,
			},
			{
				url: expect.stringMatching(
					new RegExp(`^/_img/[\\w-]{43}/rs:fit:384:0/${ENCODED}$`),
				),
				width: 384,
				height: 288,
			},
		]);
	});

	it("the full-size candidate is the original through imgproxy", () => {
		const t = transformer();
		expect(t.full?.(CDN, { width: 400, height: 300 })).toBe(
			`/_img/${SIG_400}/rs:fit:400:0/${ENCODED}`,
		);
	});

	it("backgrounds: full size or the center crop, at the background quality", () => {
		const t = transformer();
		const size = { width: 400, height: 300 };
		expect(t.background?.(CDN, size)).toBe(
			`/_img/58eLpZUewucFRVtmgw8MJE35ICOeRILwdr3UOVEfY9E/rs:fit:400:0/q:55/${ENCODED}`,
		);
		expect(t.background?.(CDN, size, { width: 225, height: 300 })).toBe(
			`/_img/1DQFt8t1JstkgwWpNknM6Ilqb5nQRttJnT3xyZZycCo/c:225:300:ce/q:55/${ENCODED}`,
		);
		const q40 = imgproxyTransformer({
			key: KEY,
			salt: SALT,
			size: sized(),
			backgroundQuality: 40,
		});
		expect(q40.background?.(BUCKET, size)).toBe(
			`/_img/UtrOMIpVD8z2R7kxhEck1L7tMZghoDRIyZUMkOEOpk4/rs:fit:400:0/q:40/${ENCODED}`,
		);
		expect(() =>
			imgproxyTransformer({
				key: KEY,
				salt: SALT,
				size: sized(),
				backgroundQuality: 0,
			}),
		).toThrow(/backgroundQuality/);
	});

	it("posters: capped at posterWidth, never enlarged, at the background quality", () => {
		const t = transformer();
		expect(t.poster?.(CDN, { width: 1280, height: 720 })).toBe(
			`/_img/AEM80oJYRsCiXpofcO8YsPewP2YJjI5ZtDhRpuniUkA/rs:fit:960:0/q:55/${ENCODED}`,
		);
		// Narrower than the cap: its own width (same path as the full background).
		expect(t.poster?.(CDN, { width: 400, height: 300 })).toBe(
			`/_img/58eLpZUewucFRVtmgw8MJE35ICOeRILwdr3UOVEfY9E/rs:fit:400:0/q:55/${ENCODED}`,
		);
		expect(() =>
			imgproxyTransformer({
				key: KEY,
				salt: SALT,
				size: sized(),
				posterWidth: 0,
			}),
		).toThrow(/posterWidth/);
	});

	it("takes another path prefix; without `source` signs the url itself", async () => {
		const t = imgproxyTransformer({
			// As IMGPROXY_PATH_PREFIX may be written: no leading slash.
			prefix: "images/",
			key: KEY,
			salt: SALT,
			size: sized(),
		});
		expect(t.full?.(BUCKET, { width: 400, height: 300 })).toBe(
			`/images/${SIG_400}/rs:fit:400:0/${ENCODED}`,
		);
	});

	it("rejects a key or salt that is not hex", () => {
		expect(() =>
			imgproxyTransformer({ key: "xyz", salt: SALT, size: sized() }),
		).toThrow(/key/);
		expect(() =>
			imgproxyTransformer({ key: KEY, salt: "", size: sized() }),
		).toThrow(/salt/);
	});

	it("measures each url once (the image header), only http(s) urls", async () => {
		const size = sized();
		const t = transformer(size);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			expect(await t.size(CDN)).toEqual({ width: 400, height: 300 });
			expect(await t.size(CDN)).toEqual({ width: 400, height: 300 });
			expect(size).toHaveBeenCalledTimes(1);
			expect(await t.size("/local.jpg")).toBeUndefined();
			expect(String(warn.mock.calls[0]?.[0])).toContain(
				"only absolute http(s)",
			);
		} finally {
			warn.mockRestore();
		}
	});
});

describe("responsiveImages with a transformer", () => {
	const config = {
		schema: 1,
		locales: ["de"],
		defaultLocale: "de",
		siteUrl: "https://example.com/",
	} as unknown as SourcePage["config"];
	const A = "https://cdn.test/media/a.jpg";

	it("uses the given transformer: every candidate an /_img url, no getImage", async () => {
		const getImage = vi.fn();
		const size = vi.fn(async () => ({ width: 400, height: 300 }));
		const page = {
			id: "home",
			url: "/",
			locale: "de",
			header: [],
			blocks: [
				{
					type: "Media",
					asset: { kind: "image", url: A, width: 1, height: 1 },
				},
			],
			footer: [],
			dialogs: {},
		} as unknown as SitePage;
		const out = await responsiveImages(
			{ config, breakpoints: [], page },
			{ getImage, inferRemoteSize: size },
			{ transformer: imgproxyTransformer({ key: KEY, salt: SALT, size }) },
		);
		const asset = (
			out.page.blocks[0] as unknown as {
				asset: { url: string; srcset: { url: string; width: number }[] };
			}
		).asset;
		expect(asset.srcset.map((c) => c.width)).toEqual([
			64, 96, 128, 192, 256, 384, 400,
		]);
		for (const c of asset.srcset) {
			expect(c.url).toMatch(/^\/_img\/[\w-]{43}\/rs:fit:\d+:0\/[\w-]+$/);
		}
		expect(asset.url).toBe(A);
		expect(getImage).not.toHaveBeenCalled();
	});
});
