// Elements for core types, used by block components: media (Asset), button
// (Button, incl. dialogs), icon (Icon). Blocks are project-owned; these
// helpers stay in the runtime so copied components stay thin.

import type { GateData } from "@wunderweb/core/consent";
import { Classes, tw } from "@wunderweb/core/tailwind";
import type { CSSProperties, ReactNode } from "react";

import { paint } from "./box.js";
import { Gate } from "./consent.js";
import type { Asset, Button, Icon } from "./core-types.js";
import { Svg } from "./html.js";
import { type ImageBox, imageSrcSet, posterOf } from "./images.js";
import type { BlockLike, RenderContext } from "./registry.js";

/** Options of a media element (e.g. the fields of a Media block). */
export interface MediaOptions {
	asset: Asset;
	/** "16:9": crop to ratio. Unset = natural size. */
	aspectRatio?: string | undefined;
	fit?: "cover" | "contain" | undefined;
	/** Cover the whole parent height. */
	fill?: boolean | undefined;
	rounded?: string | undefined;
	shadow?: string | undefined;
	/** Video only. false = muted autoplaying loop without controls. */
	controls?: boolean | undefined;
	loop?: boolean | undefined;
	muted?: boolean | undefined;
	play?: string | undefined;
}

/** Image, video or remote video (YouTube / Vimeo) of an Asset. */
export function MediaElement({ block }: { block: MediaOptions }) {
	const a = block.asset;
	const c = new Classes([]).add(
		"wc-media",
		"relative",
		"overflow-hidden",
		"w-full",
	);
	if (block.rounded) {
		c.add(tw.rounded(block.rounded));
	}
	if (block.shadow) {
		c.add(tw.shadow(block.shadow));
	}
	if (block.fill) {
		c.add("h-full");
	}
	const crop = Boolean(block.aspectRatio || block.fill);
	const style: CSSProperties = block.aspectRatio
		? { aspectRatio: block.aspectRatio.replace(":", " / ") }
		: {};
	const fit = block.fit ?? "cover";
	const inner = crop
		? `absolute inset-0 h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`
		: "block h-auto w-full";
	// Width unknown (sizes auto); a crop's shape is its ratio (fill: unknown).
	const box: ImageBox = crop
		? {
				fit,
				ratio: block.aspectRatio ? aspectRatio(block.aspectRatio) : undefined,
			}
		: {};

	return (
		<div className={c.className} style={style}>
			{a.kind === "image" && (
				<img
					className={inner}
					src={a.url}
					{...imageSrcSet(a, box)}
					alt={a.alt ?? ""}
					width={a.width}
					height={a.height}
					loading="lazy"
					decoding="async"
				/>
			)}
			{a.kind === "video" && (
				<video
					className={inner}
					src={a.url}
					poster={posterOf(a)}
					controls={block.controls !== false}
					autoPlay={block.controls === false}
					muted={block.controls === false || block.muted}
					loop={block.controls === false || block.loop}
					playsInline
				/>
			)}
			{a.kind === "remote-video" && (
				<RemoteVideo
					url={a.url}
					title={a.alt}
					consent={(a as GatedAsset).consent}
					className={crop ? inner : "block aspect-video h-auto w-full"}
				/>
			)}
		</div>
	);
}

/** "16:9" → 16 / 9 (undefined if malformed). */
function aspectRatio(value: string): number | undefined {
	const [w, h] = value.split(":").map(Number);
	return w && h ? w / h : undefined;
}

const YOUTUBE =
	/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/;
const VIMEO = /vimeo\.com\/(?:video\/)?(\d+)/;

/** A remote-video Asset as the loader resolves it on a site with consent. */
type GatedAsset = Asset & { consent?: GateData };

/**
 * YouTube / Vimeo embed (privacy-enhanced YouTube host). With `consent`
 * (the loader sets it on remote videos of a site with consent) a consent
 * gate stands in until the media category is granted.
 */
export function RemoteVideo({
	url,
	title,
	className,
	consent,
}: {
	url: string;
	title: string | undefined;
	className: string;
	/** Gate data (vendor, texts, site-owned poster) from the loader. */
	consent?: GateData | undefined;
}) {
	const yt = url.match(YOUTUBE)?.[1];
	const vimeo = url.match(VIMEO)?.[1];
	const src = yt
		? `https://www.youtube-nocookie.com/embed/${yt}`
		: vimeo
			? `https://player.vimeo.com/video/${vimeo}`
			: url;
	const frame = (
		<iframe
			className={className}
			src={src}
			title={title ?? "Video"}
			loading="lazy"
			allow="autoplay; fullscreen; picture-in-picture"
			allowFullScreen
		/>
	);
	if (!consent) {
		return frame;
	}
	return (
		<Gate gate={consent} fallback={url} className={className}>
			{frame}
		</Gate>
	);
}

/**
 * Button: a link styled by theme CSS via `.wc-button[data-variant]`.
 * `opens` toggles the page's popover with the fragment (no client JS). The
 * page renders each dialog once (see Page); the loader has already decided
 * between an #anchor url and its dialog (Button.opens as fallback).
 * `url: consent:settings` renders a button the consent script answers by
 * opening the consent settings (same look as the other buttons).
 * Theme extensions of Button render through `children` (extra label
 * content, e.g. a subtitle) and `attrs` (e.g. data-* for analytics).
 */
export function ButtonEl({
	button: b,
	className,
	children,
	attrs,
}: {
	button: Button;
	/** Not needed by the element; accepted so components pass it uniformly. */
	ctx?: RenderContext;
	className?: string | undefined;
	/** Extra label content after the label text, e.g. a subtitle. */
	children?: ReactNode;
	/** Extra attributes on the link / button element. */
	attrs?: Record<string, string | undefined>;
}) {
	const content = (
		<>
			{b.icon && (
				<Svg
					svg={b.icon}
					className="wc-button-icon inline-block h-[1.2em] w-[1.2em] shrink-0 [&>svg]:h-full [&>svg]:w-full"
				/>
			)}
			{!b.iconOnly && (
				<span className="wc-button-label flex flex-col">
					<span>{b.label}</span>
					{children}
				</span>
			)}
		</>
	);
	const common = {
		className: `wc-button inline-flex items-center justify-center gap-2 ${className ?? ""}`,
		"data-variant": b.variant ?? "primary",
		"data-size": b.size ?? "md",
		"data-icon-only": b.iconOnly ? "" : undefined,
		title: b.title ?? (b.iconOnly ? b.label : undefined),
		"aria-label": b.iconOnly ? b.label : undefined,
		...attrs,
	};

	// The consent script opens the settings; without it the button does nothing.
	if (b.url === CONSENT_SETTINGS) {
		return (
			<button
				type="button"
				aria-haspopup="dialog"
				data-wc-consent-open=""
				{...common}
			>
				{content}
			</button>
		);
	}
	if (b.opens && !b.url) {
		return (
			<button type="button" popoverTarget={dialogId(b.opens)} {...common}>
				{content}
			</button>
		);
	}
	return (
		<a href={b.url} target={b.target} rel={b.rel} {...common}>
			{content}
		</a>
	);
}

/** Url of a Button opening the consent settings. */
const CONSENT_SETTINGS = "consent:settings";

/** Element id of the dialog showing a fragment. */
export function dialogId(ref: string): string {
	return `wc-dialog-${ref}`;
}

/**
 * Popover dialog with a fragment's blocks (Button.opens). Page renders one
 * per dialog the page opens; block components never render dialogs.
 */
export function Dialog({
	fragment,
	blocks,
	ctx,
}: {
	fragment: string;
	blocks: BlockLike[];
	ctx: RenderContext;
}) {
	const id = dialogId(fragment);
	return (
		<div
			id={id}
			popover="auto"
			className="wc-dialog m-auto max-h-[90vh] w-[min(64rem,95vw)] overflow-auto rounded-xl p-0 backdrop:bg-black/60"
		>
			{ctx.render(blocks, id)}
		</div>
	);
}

const ICON_SIZE: Record<string, string> = {
	sm: "size-6",
	md: "size-10",
	lg: "size-14",
	xl: "size-18",
};

/** Icon: SVG or text glyph, sized by Icon.size, optional shape behind it. */
export function IconEl({ icon }: { icon: Icon }) {
	const c = new Classes([]).add(
		"wc-icon",
		"inline-flex",
		"items-center",
		"justify-center",
		"shrink-0",
		ICON_SIZE[icon.size ?? "md"],
		"[&>svg]:h-full",
		"[&>svg]:w-full",
	);
	paint(c, "text", icon.color);
	if (icon.background) {
		paint(c, "bg", icon.background);
		c.add(
			"p-2",
			icon.shape === "circle"
				? "rounded-full"
				: icon.shape === "rounded"
					? "rounded-lg"
					: "",
		);
	}
	if (icon.svg) {
		return <Svg svg={icon.svg} className={c.className} style={c.style} />;
	}
	return (
		<span className={`${c.className} font-bold`} style={c.style}>
			{icon.text}
		</span>
	);
}
