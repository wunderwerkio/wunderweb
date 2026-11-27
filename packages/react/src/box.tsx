// Box trait → elements and classes. Every block renders inside a BoxFrame
// (the runtime's default box, or the component's own with options):
//
//   <outer  place, appearance, visible, edges, relative>        ← block's own box
//     <bg   absolute: base, asset, color overlay, gradients>
//     <deco absolute: decorations>
//     <inner layout: container, padding, gap, align, minHeight, textAlign>
//       before · content · after
//
// Classes come from core/tailwind (safelisted); unbounded values (px widths)
// use CSS variables set inline.

import { BASE, Classes, type Resp, tw } from "@wunderweb/core/tailwind";
import type { CSSProperties, ReactNode } from "react";

import type {
	Background,
	BoxLayout,
	Decoration,
	Gradient,
	Placement,
} from "./core-types.js";
import { Svg } from "./html.js";
import {
	fullSrcSet,
	type ImageAsset,
	type ImageBox,
	imageSrcSet,
	PORTRAIT_MEDIA,
	posterOf,
} from "./images.js";
import type {
	BlockComponent,
	BlockLike,
	BlockProps,
	RenderContext,
} from "./registry.js";

export const SIDES = ["top", "right", "bottom", "left"] as const;

const EDGE_HEIGHT = "clamp(24px, 4vw, 64px)";

// Edge shapes, drawn in the next / previous block's color would need layout
// knowledge; instead the edge is cut out of this box with a clip-path.
const EDGE_PATH: Record<string, (bottom: boolean) => string> = {
	wave: (b) =>
		b
			? "M0 0 H100 V60 Q75 100 50 80 T0 80 Z"
			: "M0 100 H100 V40 Q75 0 50 20 T0 20 Z",
	slant: (b) => (b ? "M0 0 H100 V60 L0 100 Z" : "M0 40 L100 0 V100 H0 Z"),
	curve: (b) =>
		b ? "M0 0 H100 V60 Q50 120 0 60 Z" : "M0 40 Q50 -20 100 40 V100 H0 Z",
};

interface Box {
	anchor?: string;
	layout?: BoxLayout;
	place?: Placement;
	background?: Background;
	appearance?: {
		textColor?: string;
		rounded?: string;
		shadow?: string;
		border?: { width: number; color?: string; style?: string };
	};
	edges?: { top?: string; bottom?: string };
	decorations?: Decoration[];
	visible?: Resp<boolean>;
	before?: BlockLike[];
	after?: BlockLike[];
	link?: { url: string; label?: string; target?: string; rel?: string };
}

export interface FrameProps {
	block: BlockLike & Box;
	ctx: RenderContext;
	children: ReactNode;
	/** Classes for the inner element, e.g. grid classes of Tiles. */
	innerClass?: string | undefined;
	innerStyle?: CSSProperties;
	/** Extra outer classes, e.g. a card's flex column. */
	outerClass?: string | undefined;
	/** Element for the outer box, e.g. "section". */
	as?: "div" | "section" | "header" | "footer" | "nav" | "article";
	/** Blocks without layout of their own (value-like leaves) skip the inner wrapper. */
	flat?: boolean;
}

/** Renders a block's box (Box, Surround and Linkable traits) around its content. */
export function BoxFrame({
	block,
	ctx,
	children,
	innerClass,
	innerStyle,
	outerClass,
	as = "div",
	flat,
}: FrameProps) {
	const breakpoints = ctx.breakpoints;
	const outer = new Classes(breakpoints).add(
		"wc-block",
		`wc-${block.type}`,
		"relative",
		outerClass,
	);
	const inner = new Classes(breakpoints).add(
		"wc-inner",
		"relative",
		"flex",
		"flex-col",
	);

	placement(outer, block.place);
	appearance(outer, block.appearance, block.background);
	visibility(outer, block.visible);
	layout(outer, inner, block.layout);

	const bg = background(block.background, ctx.priority === true);
	const edges = edgeStyle(block.edges);
	const Tag = as;

	const before = block.before?.length
		? ctx.render(block.before, "before")
		: null;
	const after = block.after?.length ? ctx.render(block.after, "after") : null;
	const content = (
		<>
			{before}
			{children}
			{after}
		</>
	);
	const link = block.link ? (
		<a
			className="absolute inset-0 z-20"
			href={block.link.url}
			target={block.link.target}
			rel={block.link.rel}
		>
			<span className="sr-only">{block.link.label ?? block.link.url}</span>
		</a>
	) : null;

	return (
		<Tag
			id={block.anchor}
			className={outer.className}
			style={{ ...outer.style, ...edges }}
			data-block={block.type}
			{...(ctx.path === undefined ? {} : { "data-wc-path": ctx.path })}
		>
			{bg}
			{block.decorations?.map((d, i) => (
				<DecorationEl key={i} d={d} breakpoints={breakpoints} />
			))}
			{flat && !hasLayout(block.layout) ? (
				content
			) : (
				<div
					className={`${inner.className} ${innerClass ?? ""}`}
					style={{ ...inner.style, ...innerStyle }}
				>
					{content}
				</div>
			)}
			{link}
		</Tag>
	);
}

/** Default box: wraps a component that renders only the inside. */
export function withBox<B>(Inner: BlockComponent<B>): BlockComponent<B> {
	return function Boxed({ block, ctx }: BlockProps<B>) {
		return (
			<BoxFrame block={block as never} ctx={ctx}>
				<Inner block={block} ctx={ctx} />
			</BoxFrame>
		);
	};
}

function hasLayout(l: BoxLayout | undefined): boolean {
	return Boolean(l && Object.keys(l).length);
}

// ----------------------------------------------------------------- outer

function placement(c: Classes, p: Placement | undefined) {
	if (!p) {
		return;
	}
	c.resp(p.maxWidth, (v, bp) => {
		if (typeof v === "number") {
			c.var(`--wc-mw-${bp}`, `${v}px`);
		}
		return [tw.maxWidth(v, bp), "w-full"];
	});
	c.resp(p.x, (v) => tw.placeX(v));
	c.resp(p.y, (v) => tw.self(v));
	c.resp(p.margin, (m) =>
		SIDES.filter((s) => m[s] !== undefined).map((s) =>
			tw.margin(s, m[s] as number),
		),
	);
	c.resp(p.colSpan, (v) => tw.colSpan(v));
	c.resp(p.rowSpan, (v) => tw.rowSpan(v));
}

function appearance(
	c: Classes,
	a: Box["appearance"],
	bg: Background | undefined,
) {
	// A plain color background (no asset, no gradient, no opacity) paints the box itself.
	if (
		bg?.color &&
		!bg.asset &&
		!bg.gradients?.length &&
		bg.opacity === undefined
	) {
		paint(c, "bg", bg.color);
	}
	if (!a) {
		return;
	}
	if (a.textColor) {
		c.add(tw.text(a.textColor));
	}
	if (a.rounded) {
		c.add(tw.rounded(a.rounded), "overflow-hidden");
	}
	if (a.shadow) {
		c.add(tw.shadow(a.shadow));
	}
	if (a.border) {
		c.add(
			tw.borderWidth(a.border.width),
			tw.borderStyle(a.border.style ?? "solid"),
		);
		paint(c, "border", a.border.color);
	}
}

/** Token → class, hex → inline style. */
export function paint(
	c: Classes,
	kind: "bg" | "text" | "border",
	v: string | undefined,
) {
	if (!v) {
		return;
	}
	if (v.startsWith("#")) {
		c.style[
			kind === "bg"
				? "backgroundColor"
				: kind === "text"
					? "color"
					: "borderColor"
		] = v;
		return;
	}
	c.add(
		kind === "bg" ? tw.bg(v) : kind === "text" ? tw.text(v) : tw.borderColor(v),
	);
}

/** CSS color value of a Paint (token → theme variable). */
export function cssColor(
	v: string | undefined,
	opacity?: number,
): string | undefined {
	if (!v) {
		return undefined;
	}
	const base = v.startsWith("#") ? v : `var(--color-${v})`;
	return opacity === undefined
		? base
		: `color-mix(in srgb, ${base} ${Math.round(opacity * 100)}%, transparent)`;
}

function visibility(c: Classes, v: Resp<boolean> | undefined) {
	c.resp(v, (shown) => (shown ? "block" : "hidden"));
}

// ----------------------------------------------------------------- inner

function layout(outer: Classes, inner: Classes, l: BoxLayout | undefined) {
	if (!l) {
		return;
	}
	if (l.container) {
		inner.add(`wc-container-${l.container}`);
	}
	if (l.alignX) {
		inner.add(tw.alignItems(l.alignX));
	}
	if (l.alignY) {
		inner.add(tw.justify(l.alignY));
	}
	if (l.clip) {
		outer.add("overflow-hidden");
	}

	inner.resp(l.padding, (p) =>
		SIDES.filter((s) => p[s] !== undefined).map((s) =>
			tw.padding(s, p[s] as number),
		),
	);
	inner.resp(l.gap, (g) => tw.gap(g));
	inner.resp(l.textAlign, (t) => tw.textAlign(t));

	// min-height sits on the outer box (background fills it); inner stretches.
	outer.resp(l.minHeight, (v, bp) => {
		if (typeof v === "number") {
			outer.var(`--wc-mh-${bp}`, `${v}px`);
		}
		return [tw.minHeight(v, bp), "flex", "flex-col"];
	});
	if (l.minHeight) {
		inner.add("flex-1", "w-full");
	}
}

// ----------------------------------------------------------------- background

/** `priority`: the page's first block; its image loads at once, with high priority. */
function background(b: Background | undefined, priority: boolean): ReactNode {
	if (!b) {
		return null;
	}
	const layered = b.asset || b.gradients?.length || b.opacity !== undefined;
	if (!layered) {
		return null;
	}

	const position = b.position ?? "cover";
	const fit: BackgroundFit =
		position === "cover" || position === "contain" || position === "fill"
			? position
			: "none";
	const objectPosition =
		fit === "none" ? (b.position ?? "center").replace("-", " ") : "center";
	const assetOpacity = b.color ? undefined : b.opacity;
	const assetStyle: CSSProperties = {
		objectFit: fit as CSSProperties["objectFit"],
		objectPosition,
		opacity: assetOpacity,
		filter: b.blur ? `blur(${b.blur}px)` : undefined,
		transform: b.blur ? "scale(1.05)" : undefined,
	};

	return (
		<div
			className="wc-bg absolute inset-0 -z-0 overflow-hidden"
			aria-hidden="true"
			data-parallax={b.parallax ? "" : undefined}
		>
			{b.base && (
				<div
					className="absolute inset-0"
					style={{ backgroundColor: cssColor(b.base) }}
				/>
			)}
			{b.asset && (
				<BackgroundAsset
					asset={b.asset}
					style={assetStyle}
					parallax={b.parallax ?? false}
					fit={fit}
					priority={priority}
				/>
			)}
			{b.color && (
				<div
					className="absolute inset-0"
					style={{ backgroundColor: cssColor(b.color), opacity: b.opacity }}
				/>
			)}
			{[...(b.gradients ?? [])].reverse().map((g, i) => (
				<div
					key={i}
					className="absolute inset-0"
					style={{ backgroundImage: gradientCss(g) }}
				/>
			))}
		</div>
	);
}

/** object-fit of a background asset: stretched, or anchored at natural size ("none"). */
type BackgroundFit = NonNullable<ImageBox["fit"]> | "none";

function BackgroundAsset({
	asset,
	style,
	parallax,
	fit,
	priority,
}: {
	asset: NonNullable<Background["asset"]>;
	style: CSSProperties;
	parallax: boolean;
	fit: BackgroundFit;
	priority: boolean;
}) {
	// Parallax: the layer is taller than the box and moves with scroll (wc-parallax, CSS scroll timeline).
	const cls = parallax
		? "wc-parallax absolute inset-x-0 -top-[20%] h-[140%] w-full"
		: "absolute inset-0 h-full w-full";
	if (asset.kind === "video") {
		return (
			<video
				className={cls}
				style={style}
				src={asset.url}
				poster={posterOf(asset)}
				autoPlay
				muted
				loop
				playsInline
			/>
		);
	}
	if (asset.kind === "remote-video") {
		return null;
	}
	const img = (
		<img
			className={cls}
			style={style}
			src={asset.url}
			// Contain / fill: drawn at most as wide as the box. Cover and
			// anchored assets have no copies (their drawn width needs the layout),
			// at most an image server's background url at full size.
			// The priority image loads eagerly: no sizes="auto".
			{...(fit === "contain" || fit === "fill"
				? imageSrcSet(asset, { fit }, { eager: priority })
				: fullSrcSet(asset))}
			alt={asset.alt ?? ""}
			width={asset.width}
			height={asset.height}
			{...(priority
				? { fetchPriority: "high" as const }
				: { loading: "lazy" as const })}
			decoding="async"
		/>
	);
	// The hero's center crop on upright phones: a tall cover box draws the
	// image by its height and centers it, so the crop looks the same there.
	const portrait = (asset as ImageAsset).portrait;
	if (fit !== "cover" || !portrait || parallax) {
		return img;
	}
	return (
		<picture>
			<source media={PORTRAIT_MEDIA} srcSet={`${portrait.url} 1x`} />
			{img}
		</picture>
	);
}

export function gradientCss(g: Gradient): string {
	const stops = g.stops
		.map(
			(s) =>
				`${cssColor(s.color, s.opacity)}${s.at !== undefined ? ` ${s.at}%` : ""}`,
		)
		.join(", ");
	if (g.kind === "linear") {
		return `linear-gradient(${g.angle ?? 180}deg, ${stops})`;
	}
	return `radial-gradient(circle at ${(g.center ?? "center").replace("-", " ")}, ${stops})`;
}

// ----------------------------------------------------------------- edges, decorations

function edgeStyle(e: Box["edges"]): CSSProperties {
	const top = e?.top && e.top !== "straight" ? EDGE_PATH[e.top] : undefined;
	const bottom =
		e?.bottom && e.bottom !== "straight" ? EDGE_PATH[e.bottom] : undefined;
	if (!top && !bottom) {
		return {};
	}
	// mask: full box minus the edge shapes (SVG in a data url, stretched to the edge height).
	const svg = (d: string) =>
		`url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><path d='${d}'/></svg>`)}")`;
	const layers: string[] = [];
	const sizes: string[] = [];
	const positions: string[] = [];
	const repeat: string[] = [];
	if (top) {
		layers.push(svg(top(false)));
		sizes.push(`100% ${EDGE_HEIGHT}`);
		positions.push("top");
		repeat.push("no-repeat");
	}
	if (bottom) {
		layers.push(svg(bottom(true)));
		sizes.push(`100% ${EDGE_HEIGHT}`);
		positions.push("bottom");
		repeat.push("no-repeat");
	}
	// Middle part: solid, between the edges.
	layers.push("linear-gradient(#000, #000)");
	sizes.push(
		`100% calc(100% - ${top ? EDGE_HEIGHT : "0px"} - ${bottom ? EDGE_HEIGHT : "0px"} + 2px)`,
	);
	positions.push(`0 calc(${top ? EDGE_HEIGHT : "0px"} - 1px)`);
	repeat.push("no-repeat");

	const mask = {
		maskImage: layers.join(", "),
		maskSize: sizes.join(", "),
		maskPosition: positions.join(", "),
		maskRepeat: repeat.join(", "),
	};
	return {
		...mask,
		WebkitMaskImage: mask.maskImage,
		WebkitMaskSize: mask.maskSize,
		WebkitMaskPosition: mask.maskPosition,
		WebkitMaskRepeat: mask.maskRepeat,
	} as CSSProperties;
}

function DecorationEl({
	d,
	breakpoints,
}: {
	d: Decoration;
	breakpoints: string[];
}) {
	const [v, h] = d.anchor.includes("-")
		? d.anchor.split("-")
		: ["center", "top", "bottom"].includes(d.anchor)
			? [d.anchor, "center"]
			: ["center", d.anchor];
	const style: CSSProperties = { width: d.width };
	const transform: string[] = [];
	if (v === "top" || v === "bottom") {
		style[v] = d.offsetY ?? 0;
	} else {
		style.top = "50%";
		transform.push("translateY(-50%)");
	}
	if (h === "left" || h === "right") {
		style[h] = d.offsetX ?? 0;
	} else {
		style.left = "50%";
		transform.push("translateX(-50%)");
	}
	style.transform = transform.join(" ") || undefined;

	const c = new Classes(breakpoints).add(
		"wc-deco",
		"pointer-events-none",
		"absolute",
		"z-0",
		"[&>svg]:block",
		"[&>svg]:h-auto",
		"[&>svg]:w-full",
	);
	c.resp(d.visible, (shown) => (shown ? "block" : "hidden"));
	return <Svg className={c.className} style={style} svg={d.svg} />;
}

export { BASE };
