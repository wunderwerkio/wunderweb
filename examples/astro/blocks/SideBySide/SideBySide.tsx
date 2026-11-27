import { type BlockProps, Classes, tw } from "@wunderweb/react";

import type { SideBySideBlock } from "../../generated/types";

/**
 * Two columns on a 24-column grid per breakpoint. Below the first ratio the
 * columns stack. `reverse` swaps the visual order, stacked order stays.
 */
export function SideBySide({ block, ctx }: BlockProps<SideBySideBlock>) {
	const split = block.split ?? {};
	const grid = new Classes(ctx.breakpoints).add("grid", "grid-cols-1");
	const start = new Classes(ctx.breakpoints).add("wc-start", "min-w-0");
	const end = new Classes(ctx.breakpoints).add("wc-end", "min-w-0");

	grid.resp(split.gap, (g) => tw.gap(g));
	if (split.alignY) {
		grid.add(tw.alignItems(split.alignY));
	}

	// ratio "7:5" → grid-cols-12, start col-span-7, end col-span-5.
	grid.resp(split.ratio, (r) => tw.cols(total(r)));
	start.resp(split.ratio, (r) => tw.colSpan(part(r, 0)));
	end.resp(split.ratio, (r) => tw.colSpan(part(r, 1)));

	// Reverse per breakpoint; carried forward until changed (mobile first).
	start.resp(split.reverse, (rev) => tw.order(rev ? 2 : "none"));
	end.resp(split.reverse, (rev) => tw.order(rev ? 1 : "none"));

	return (
		<div className={grid.className}>
			<div className={start.className}>{ctx.render(block.start)}</div>
			<div className={end.className}>
				{block.end ? ctx.render(block.end) : null}
			</div>
		</div>
	);
}

function total(r: string): number {
	return r
		.split(":")
		.map(Number)
		.reduce((a, b) => a + b, 0);
}

function part(r: string, i: number): number {
	return Number(r.split(":")[i]);
}
