import { type BlockProps, Classes, tw } from "@wunderweb/react";

import type { TilesBlock } from "../../generated/types";

/** Items as a grid (cells may span), a wrapping flex row or masonry columns. */
export function Tiles({ block, ctx }: BlockProps<TilesBlock>) {
	const g = block.grid ?? {};
	const mode = g.mode ?? "grid";
	const c = new Classes(ctx.breakpoints).add("wc-tiles", `wc-tiles-${mode}`);

	c.resp(g.gap, (v) =>
		mode === "masonry" ? [tw.gapX(v), tw.childMb(v)] : tw.gap(v),
	);
	c.resp(g.margin, (m) =>
		(["top", "right", "bottom", "left"] as const)
			.filter((s) => m[s] !== undefined)
			.map((s) => tw.margin(s, m[s] as number)),
	);
	const display =
		mode === "flex" ? "flex" : mode === "masonry" ? "block" : "grid";
	c.add(display);
	c.resp(g.visible, (shown) => (shown ? display : "hidden"));

	if (mode === "grid") {
		c.add("grid-flow-row-dense");
		c.resp(g.columns, (n) => tw.cols(n));
	}
	if (mode === "masonry") {
		c.resp(g.columns, (n) => tw.columns(n));
		c.add("*:break-inside-avoid");
	}
	if (mode === "flex") {
		c.add("flex-wrap");
		if (g.alignX) {
			c.add(tw.justify(g.alignX));
		}
		c.add(
			g.equalHeight
				? "items-stretch"
				: g.alignY
					? tw.alignItems(g.alignY)
					: undefined,
		);
	}

	return <div className={c.className}>{ctx.render(block.items)}</div>;
}
