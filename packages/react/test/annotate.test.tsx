// @vitest-environment jsdom
// Annotate mode in the browser: blocks keyed by source path keep their DOM
// (videos, marquees, open dialogs) when a block is inserted before them.

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import {
	type Annotation,
	type BlockProps,
	createRegistry,
	Page,
} from "../src/index.js";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Plain = { type: "Plain"; text: string };
const registry = createRegistry<{ Plain: Plain }>({
	Plain: ({ block }: BlockProps<Plain>) => <p>{block.text}</p>,
});

const HOME = "de/pages/home.yaml";
const CTA = "de/fragments/cta.yaml";

/** Page [Include(cta), Plain "B"] with the cta fragment's blocks expanded. */
function page(fragment: string[]) {
	const blocks = [...fragment, "B"].map((text) => ({ type: "Plain", text }));
	const sources: NonNullable<Annotation["sources"]> = {};
	fragment.forEach((_, i) => {
		sources[`blocks/${i}`] = {
			file: CTA,
			path: `blocks/${i}`,
			via: [{ file: HOME, path: "blocks/0" }],
		};
	});
	sources[`blocks/${fragment.length}`] = { file: HOME, path: "blocks/1" };
	return {
		page: {
			locale: "de",
			alternates: {},
			homes: {},
			header: [],
			footer: [],
			blocks,
		} as never,
		sources,
	};
}

describe("annotate keys", () => {
	it("an insert into an included fragment keeps the later sibling mounted", async () => {
		const el = document.createElement("div");
		const root = createRoot(el);
		const render = async (fragment: string[]) => {
			const { page: p, sources } = page(fragment);
			await act(async () => {
				root.render(
					<Page
						page={p}
						registry={registry}
						breakpoints={["base"]}
						annotate={{ sources }}
					/>,
				);
			});
		};
		const b = () =>
			[...el.querySelectorAll("p")]
				.find((x) => x.textContent === "B")
				?.closest("[data-wc-path]");

		await render(["A"]);
		const before = b();
		expect(before?.getAttribute("data-wc-path")).toBe("blocks/1");
		await render(["A", "A2"]);
		// Same element: moved, not remounted; its rendered path is updated.
		expect(b()).toBe(before);
		expect(before?.getAttribute("data-wc-path")).toBe("blocks/2");
		await act(async () => root.unmount());
	});
});
