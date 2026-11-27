// Every dynamic class the runtime can emit for a model: generated from the
// same functions the runtime uses (tailwind.ts), so emitted classes always
// exist in the compiled CSS.

import { breakpoints, enumValues, type Model } from "./model.js";
import {
	ALIGN_ITEMS,
	at,
	BASE,
	JUSTIFY,
	LINE,
	MAX_SPAN,
	PLACE_X,
	RADIUS,
	SELF,
	SHADOW,
	TEXT_ALIGN,
	tw,
} from "./tailwind.js";

export function safelist(model: Model): string[] {
	const bps = breakpoints(model);
	const spacing = enumValues(model.types.Spacing).map(Number);
	const signed = enumValues(model.types.SignedSpacing).map(Number);
	const colors = enumValues(model.types.Color).map(String);
	const spans = range(1, MAX_SPAN);
	const named = enumValues(model.types.NamedWidth).map(String);
	const heights = enumValues(model.types.NamedHeight).map(String);

	const responsive: (string | undefined)[] = [
		...(["top", "right", "bottom", "left"] as const).flatMap((s) =>
			spacing.map((v) => tw.padding(s, v)),
		),
		...(["top", "bottom"] as const).flatMap((s) =>
			signed.map((v) => tw.margin(s, v)),
		),
		// Negative left / right: Card media bleeds over the card padding.
		...(["left", "right"] as const).flatMap((s) =>
			spacing.flatMap((v) => [tw.margin(s, v), tw.margin(s, -v)]),
		),
		...spacing.flatMap((v) => [tw.gap(v), tw.gapX(v), tw.childMb(v)]),
		...Object.values(ALIGN_ITEMS),
		...Object.values(JUSTIFY),
		...Object.values(SELF),
		...Object.values(TEXT_ALIGN),
		...Object.values(PLACE_X).flat(),
		"flex",
		"grid",
		"block",
		"hidden",
		...spans.flatMap((n) => [
			tw.cols(n),
			tw.colSpan(n),
			tw.rowSpan(n),
			tw.columns(n),
		]),
		...bps.map((bp) => tw.colsVar(bp)),
		tw.order(1),
		tw.order(2),
		tw.order("none"),
		...named.map((n) => tw.maxWidth(n, BASE)),
		...bps.flatMap((bp) => [tw.maxWidth(0, bp), tw.minHeight(0, bp)]),
		...heights
			.map((h) => tw.minHeight(h, BASE))
			.filter((x): x is string => Boolean(x)),
		tw.direction("row"),
		tw.direction("column"),
		tw.fullWidth(true),
		tw.fullWidth(false),
	];

	const plain: string[] = [
		...Object.keys(model.tokens.ContainerSize).map((c) => `wc-container-${c}`),
		...colors.flatMap((c) => [tw.bg(c), tw.text(c), tw.borderColor(c)]),
		...range(1, 8).map(tw.borderWidth),
		...Object.values(LINE),
		...Object.values(RADIUS),
		...Object.values(SHADOW),
	];

	const all = [
		...plain,
		...bps.flatMap((bp) =>
			responsive.filter((c): c is string => Boolean(c)).map((c) => at(bp, c)),
		),
	];
	return [...new Set(all)];
}

function range(from: number, to: number): number[] {
	return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
