// The frame protocol: the postMessage messages between the hosted editor
// and the page's bridge (the site runtime's `bridge-script.js`, with the
// Astro refresh script). The contract a site's preview build keeps with the
// editor: versioned with core. Types only.
//
//   editor ──ToBridge──▶ page    hello, select, hover, scrollTo, mode, refresh, dialogs
//   page ──FromBridge──▶ editor  ready, rendered, select, hover, navigate, rects, box
//
// Messages carry `wc` as their type and go to explicit origins only (the
// page's annotation names the editor origins it answers).

/** Editor → page bridge (postMessage, explicit origins). */
export type ToBridge =
	/** Asks the page to (re)announce itself with `ready`. */
	| { wc: "hello" }
	| { wc: "select"; path: string | null }
	| { wc: "hover"; path: string | null }
	| { wc: "scrollTo"; path: string; margin?: number }
	| { wc: "mode"; mode: "edit" | "off" }
	| { wc: "refresh"; revision: number }
	| { wc: "openDialog"; ref: string }
	| { wc: "closeDialog" };

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Page bridge → editor. */
export type FromBridge =
	| { wc: "ready"; url: string; revision: number }
	| { wc: "rendered"; revision: number }
	| { wc: "select"; path: string | null }
	| { wc: "hover"; path: string | null }
	| { wc: "navigate"; url: string }
	/** Union rect per path (one path may map to several elements). */
	| { wc: "rects"; rects: Record<string, Rect> }
	/** Spacing of the selected block as rendered (null: nothing selected). */
	| { wc: "box"; path: string | null; box: BoxModel | null };

/** Sides in px. */
export interface Edges {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

/**
 * The selected block's spacing as the browser lays it out, in px and in
 * frame viewport coordinates: what the editor draws and lets you drag.
 */
export interface BoxModel {
	outer: Rect;
	/** Outer margin (place.margin). */
	margin: Edges;
	/** Frame viewport width: picks the breakpoint an edit applies to. */
	viewport: number;
	/** Root font size in px (1 spacing step = 0.25rem). */
	rem: number;
	/** The box's inner element (layout.padding, layout.gap); absent for flat blocks. */
	inner?: {
		rect: Rect;
		padding: Edges;
		/** layout.gap in px, along `row` (children side by side) or a column. */
		gap: number;
		row: boolean;
		children: Rect[];
	};
	/** Content the block lays out itself with a gap, e.g. a Tiles grid. */
	grids?: {
		rect: Rect;
		rowGap: number;
		columnGap: number;
		children: Rect[];
	}[];
}
