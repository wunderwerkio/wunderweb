// Runtime through the public registry API, with test-local project blocks.
// Registry items (Section, Card, …) are rendered in registry/test.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
	type Annotation,
	type BlockLike,
	type BlockProps,
	BoxFrame,
	ButtonEl,
	createRegistry,
	languageLinks,
	ownBox,
	PAGE_DATA_ID,
	Page,
	RichText,
} from "../src/index.js";

const BPS = ["base", "md", "lg"];

type Plain = { type: "Plain"; body: string };
type Slots = { type: "Slots"; items: BlockLike[] };
type Tag = { type: "Tag"; text: string };
type Actions = {
	type: "Actions";
	items: { label: string; url?: string; opens?: string }[];
};

/** Renders only its inside: the runtime draws the box. */
function PlainBlock({ block }: BlockProps<Plain>) {
	return <RichText html={block.body} />;
}

function SlotsBlock({ block, ctx }: BlockProps<Slots>) {
	return <ul>{ctx.render(block.items)}</ul>;
}

/** Renders its box itself: flat (no inner wrapper), as <article>. */
const TagBlock = ownBox(function TagBlock({ block, ctx }: BlockProps<Tag>) {
	return (
		<BoxFrame block={block as never} ctx={ctx} as="article" flat>
			<span>{block.text}</span>
		</BoxFrame>
	);
});

function ActionsBlock({ block, ctx }: BlockProps<Actions>) {
	return (
		<>
			{block.items.map((b, i) => (
				<ButtonEl key={i} button={b} ctx={ctx} />
			))}
		</>
	);
}

function BoomBlock(): never {
	throw new Error("boom");
}

const registry = createRegistry<{
	Plain: Plain;
	Slots: Slots;
	Tag: Tag;
	Actions: Actions;
	Boom: { type: "Boom" };
}>({
	Plain: PlainBlock,
	Slots: SlotsBlock,
	Tag: TagBlock,
	Actions: ActionsBlock,
	Boom: BoomBlock,
});

function html(
	blocks: unknown[],
	opts: { dialogs?: Record<string, BlockLike[]>; inspect?: boolean } = {},
): string {
	const page = {
		locale: "de",
		alternates: {},
		homes: { de: "/" },
		header: [],
		footer: [],
		blocks,
		dialogs: opts.dialogs,
	} as never;
	return renderToStaticMarkup(
		<Page
			page={page}
			registry={registry}
			breakpoints={BPS}
			inspect={opts.inspect ?? false}
		/>,
	);
}

describe("box traits", () => {
	it("maps layout, place, appearance and visibility to classes", () => {
		const out = html([
			{
				type: "Plain",
				anchor: "intro",
				body: "<p>x</p>",
				layout: {
					container: "default",
					padding: { base: { top: 4 }, md: { top: 8 } },
					gap: { lg: 6 },
					textAlign: { md: "center" },
				},
				place: {
					maxWidth: { base: 320, md: "3xl" },
					x: { base: "center" },
					margin: { lg: { top: -12 } },
				},
				appearance: { textColor: "ink", rounded: "xl", shadow: "sm" },
				background: { color: "paper" },
				visible: { base: false, md: true },
			},
		]);
		expect(out).toContain('id="intro"');
		for (const c of [
			"wc-block wc-Plain",
			"wc-container-default",
			"pt-4",
			"md:pt-8",
			"lg:gap-6",
			"md:text-center",
			"max-w-(--wc-mw-base)",
			"md:max-w-3xl",
			"mx-auto",
			"lg:-mt-12",
			"text-ink",
			"rounded-xl",
			"shadow-xs",
			"bg-paper",
			"hidden",
			"md:block",
		]) {
			expect(out).toContain(c);
		}
		expect(out).toContain("--wc-mw-base:320px");
	});

	it("layers background asset, overlay and gradients", () => {
		const out = html([
			{
				type: "Plain",
				body: "<p>x</p>",
				background: {
					asset: { kind: "image", url: "https://cdn.example.com/a.jpg" },
					color: "ink",
					opacity: 0.8,
					gradients: [
						{
							kind: "linear",
							angle: 90,
							stops: [{ color: "#fff", opacity: 0 }, { color: "brand" }],
						},
					],
				},
			},
		]);
		expect(out).toContain('src="https://cdn.example.com/a.jpg"');
		expect(out).toContain("background-color:var(--color-ink);opacity:0.8");
		expect(out).toContain(
			"linear-gradient(90deg, color-mix(in srgb, #fff 0%, transparent), var(--color-brand))",
		);
		// Layered background: the box itself is not painted.
		expect(out).not.toContain("bg-ink");
	});

	it("renders before / after around the content", () => {
		const out = html([
			{
				type: "Plain",
				body: "<p>main</p>",
				before: [{ type: "Tag", text: "BEFORE-MARK" }],
				after: [{ type: "Actions", items: [{ label: "Go", url: "/go" }] }],
			},
		]);
		expect(out.indexOf("BEFORE-MARK")).toBeLessThan(out.indexOf("<p>main</p>"));
		expect(out.indexOf("<p>main</p>")).toBeLessThan(out.indexOf('href="/go"'));
		expect(out).toContain('data-variant="primary"');
	});
});

describe("registry", () => {
	it("wraps inside-only components in their box and passes slots", () => {
		const out = html([
			{
				type: "Slots",
				items: [{ type: "Tag", text: "slot" }],
				layout: { padding: { base: { top: 2 } } },
			},
		]);
		expect(out).toMatch(
			/<div class="wc-block wc-Slots relative" data-block="Slots"><div class="wc-inner relative flex flex-col pt-2 "><ul>.*slot/,
		);
	});

	it("lets ownBox components render their box with options", () => {
		const flat = html([{ type: "Tag", text: "t" }]);
		expect(flat).toBe(
			'<main class="wc-main"><article class="wc-block wc-Tag relative" data-block="Tag"><span>t</span></article></main>',
		);
		// Layout content needs the inner element, even for a flat box.
		const laidOut = html([
			{ type: "Tag", text: "t", layout: { padding: { base: { top: 2 } } } },
		]);
		expect(laidOut).toContain(
			'<div class="wc-inner relative flex flex-col pt-2 ">',
		);
	});

	it("fails loudly on unregistered blocks", () => {
		expect(() => html([{ type: "Nope" }])).toThrow(
			/no component registered for block type "Nope"/,
		);
	});

	it("language links fall back to the locale home", () => {
		expect(
			languageLinks({
				alternates: { de: "/ueber-uns" },
				homes: { de: "/", en: "/en" },
			}),
		).toEqual({
			de: { url: "/ueber-uns", translated: true },
			en: { url: "/en", translated: false },
		});
	});
});

describe("elements", () => {
	it("Button opens a dialog fragment (popover, no client JS)", () => {
		const out = html(
			[{ type: "Actions", items: [{ label: "Kosten", opens: "form" }] }],
			{
				dialogs: { form: [{ type: "Plain", body: "<p>dialog</p>" }] },
			},
		);
		expect(out.toLowerCase()).toContain('popovertarget="wc-dialog-form"');
		expect(out).toContain('id="wc-dialog-form" popover="auto"');
		expect(out).toContain("<p>dialog</p>");
	});

	it("each dialog renders once, after the page, however many buttons open it", () => {
		const out = html(
			[
				{
					type: "Actions",
					items: [
						{ label: "a", opens: "form" },
						{ label: "b", opens: "form" },
					],
				},
				{ type: "Actions", items: [{ label: "c", opens: "form" }] },
			],
			{ dialogs: { form: [{ type: "Plain", body: "<p>dialog</p>" }] } },
		);
		expect(out.match(/id="wc-dialog-form"/g)).toHaveLength(1);
		expect(out.match(/popovertarget="wc-dialog-form"/gi)).toHaveLength(3);
		expect(out.indexOf("</main>")).toBeLessThan(
			out.indexOf('id="wc-dialog-form"'),
		);
	});

	it("Button renders theme extensions through children and attrs", () => {
		const ctx = { dialogs: {} } as never;
		const out = renderToStaticMarkup(
			<ButtonEl
				button={{ label: "Go", url: "/go" }}
				ctx={ctx}
				attrs={{ "data-events": "contact" }}
			>
				<small>sub</small>
			</ButtonEl>,
		);
		expect(out).toContain('data-events="contact"');
		expect(out).toContain(
			'<span class="wc-button-label flex flex-col"><span>Go</span><small>sub</small></span>',
		);
	});
});

describe("annotate mode", () => {
	const blocks = [
		{
			type: "Slots",
			items: [
				{ type: "Plain", body: "<p>a</p>" },
				{ type: "Plain", body: "</script><p>b</p>" },
			],
		},
	];

	function annotated(annotate: Annotation | boolean, list: unknown[] = blocks) {
		return renderToStaticMarkup(
			<Page
				page={
					{
						locale: "de",
						alternates: {},
						homes: { de: "/" },
						header: [{ type: "Tag", text: "head" }],
						footer: [],
						blocks: list,
						dialogs: { form: [{ type: "Plain", body: "<p>dialog</p>" }] },
					} as never
				}
				registry={registry}
				breakpoints={BPS}
				annotate={annotate}
			/>,
		);
	}

	it("tags blocks with rendered paths, stamps the revision and embeds the page", () => {
		const out = annotated({ revision: 7 });
		for (const path of [
			"header/0",
			"blocks/0",
			"blocks/0/items/0",
			"blocks/0/items/1",
			"dialogs/form/0",
		]) {
			expect(out).toContain(`data-wc-path="${path}"`);
		}
		expect(out).toContain('<main class="wc-main" data-wc-revision="7">');
		expect(out).toContain(
			`<script id="${PAGE_DATA_ID}" type="application/json">`,
		);
		// Rich text cannot close the data script.
		const json = out
			.split(`<script id="${PAGE_DATA_ID}" type="application/json">`)[1]
			?.split("</script>")[0];
		expect(json).not.toContain("</script><p>b</p>");
		expect(JSON.parse(json ?? "")).toMatchObject({
			revision: 7,
			page: { blocks },
		});
		// No editor origins: no bridge.
		expect(out).not.toContain("mountBridge");
	});

	it("inlines the bridge for the editor's origins", () => {
		const out = annotated({
			revision: 1,
			editorOrigins: ["http://localhost:4310"],
		});
		expect(out).toContain("function mountBridge");
		expect(out).toContain('{"origins":["http://localhost:4310"]}');
	});

	it("renders a block with an error finding as a placeholder naming it", () => {
		const out = annotated({
			findings: {
				"blocks/0/items/1": [
					{ level: "error", message: "body: must not be empty" },
				],
				"blocks/0/items/0": [{ level: "warning", message: "restated default" }],
			},
		});
		expect(out).toContain("<p>a</p>");
		expect(out).not.toContain("<p>b</p>");
		expect(out).toMatch(
			/<div[^>]*data-wc-error=""[^>]*data-wc-path="blocks\/0\/items\/1"[^>]*>.*Plain.*body: must not be empty/,
		);
	});

	it("contains a block that throws while rendering", () => {
		const out = annotated(true, [
			{ type: "Plain", body: "<p>before</p>" },
			{ type: "Boom" },
			{ type: "Plain", body: "<p>after</p>" },
		]);
		expect(out).toContain("<p>before</p>");
		expect(out).toContain("<p>after</p>");
		expect(out).toMatch(
			/data-wc-error=""[^>]*data-wc-path="blocks\/1"[^>]*>.*Boom/,
		);
	});

	it("is off by default; inspect is an alias", () => {
		expect(html(blocks)).not.toContain("data-wc-path");
		expect(html(blocks)).not.toContain(PAGE_DATA_ID);
		expect(html(blocks, { inspect: true })).toContain(
			'data-wc-path="blocks/0/items/1"',
		);
	});
});

describe("priority (first block)", () => {
	const bg = (extra: Record<string, unknown> = {}) => ({
		type: "Box",
		background: {
			asset: { kind: "image", url: "https://cdn.test/hero.webp" },
		},
		...extra,
	});
	function BoxBlock({
		block,
		ctx,
	}: BlockProps<{ type: "Box"; items?: unknown[] }>) {
		return <>{block.items ? ctx.render(block.items as never) : null}</>;
	}
	const registry = createRegistry<{ Box: { type: "Box"; items?: unknown[] } }>({
		Box: BoxBlock,
	});
	const render = (blocks: unknown[], header: unknown[] = []) =>
		renderToStaticMarkup(
			<Page
				page={
					{
						locale: "de",
						alternates: {},
						homes: { de: "/" },
						header,
						footer: [],
						blocks,
					} as never
				}
				registry={registry}
				breakpoints={["base", "md"]}
			/>,
		);
	const imgs = (html: string) => html.match(/<img [^>]*>/g) ?? [];

	it("the first block's background loads at once, with high priority", () => {
		const list = imgs(render([bg(), bg()]));
		expect(list).toHaveLength(2);
		const [first, second] = list;
		expect(first).toContain('fetchPriority="high"');
		expect(first).not.toContain("loading=");
		expect(second).toContain('loading="lazy"');
		expect(second).not.toContain("fetchPriority");
	});

	it("not for child blocks, the header, or a first block hidden somewhere", () => {
		const nested = imgs(render([{ type: "Box", items: [bg()] }]));
		expect(nested).toHaveLength(1);
		expect(nested[0]).toContain('loading="lazy"');
		expect(nested[0]).not.toContain("fetchPriority");
		const header = imgs(render([{ type: "Box" }], [bg()]));
		expect(header).toHaveLength(1);
		expect(header[0]).toContain('loading="lazy"');
		expect(header[0]).not.toContain("fetchPriority");
		const hidden = imgs(render([bg({ visible: { base: false, md: true } })]));
		expect(hidden).toHaveLength(1);
		expect(hidden[0]).toContain('loading="lazy"');
		expect(hidden[0]).not.toContain("fetchPriority");
	});

	it("a first block visible at every breakpoint keeps it", () => {
		const shown = imgs(render([bg({ visible: { base: true, md: true } })]));
		expect(shown).toHaveLength(1);
		expect(shown[0]).toContain('fetchPriority="high"');
		expect(shown[0]).not.toContain("loading=");
	});
});
