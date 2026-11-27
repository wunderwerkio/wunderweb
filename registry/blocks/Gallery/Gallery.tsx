import {
	type BlockProps,
	Classes,
	type ImageBox,
	imageSrcSet,
	tw,
} from "@wunderweb/react";
import type { CSSProperties } from "react";

import type { GalleryBlock, GalleryItem } from "../../generated/types";

const MARQUEE_REPEAT = 3;
const MARQUEE_DEFAULT_SECONDS = 40;

/** Images as grid, masonry or marquee (animation in Gallery.css). */
export function Gallery({ block, ctx }: BlockProps<GalleryBlock>) {
	const mode = block.mode ?? "grid";
	const shape =
		block.shape === "circle"
			? "rounded-full"
			: block.shape === "rounded"
				? "rounded-xl"
				: "";
	const img = new Classes([]).add(
		"block",
		"w-full",
		shape,
		block.grayscale ? "grayscale" : undefined,
	);

	if (mode === "marquee") {
		const m = block.marquee ?? {};
		const h = block.itemHeight ?? 80;
		const items = Array.from(
			{ length: MARQUEE_REPEAT },
			() => block.items,
		).flat();
		const mask = m.fadeEdges
			? "[mask-image:linear-gradient(to_right,transparent,#000_10%,#000_90%,transparent)]"
			: "";
		// Gallery.gap spaces the items; unset keeps the default gap-6.
		const track = new Classes(ctx.breakpoints).add(
			"wc-marquee-track",
			"flex",
			"w-max",
			"list-none",
			"p-0",
			block.gap ? undefined : "gap-6",
			m.pauseOnHover ? "hover:[animation-play-state:paused]" : undefined,
		);
		track.resp(block.gap, (g) => tw.gap(g));
		// h px high at the image's own ratio, every shape: `!w-auto` wins over
		// a circle's inline width.
		const marqueeBox: ImageBox = { height: h };
		return (
			<div className={`wc-marquee overflow-hidden ${mask}`}>
				<ul
					className={track.className}
					style={
						{
							"--wc-marquee-duration": `${m.duration ?? MARQUEE_DEFAULT_SECONDS}s`,
						} as CSSProperties
					}
				>
					{items.map((it, i) => (
						<li
							key={i}
							className="shrink-0"
							aria-hidden={i >= block.items.length}
						>
							<GalleryImage
								item={it}
								className={`${img.className} !w-auto object-contain`}
								style={{
									height: h,
									...(block.shape === "circle"
										? { width: h, objectFit: "cover" }
										: {}),
								}}
								box={marqueeBox}
							/>
						</li>
					))}
				</ul>
			</div>
		);
	}

	const c = new Classes(ctx.breakpoints).add(
		"wc-gallery",
		"list-none",
		"p-0",
		mode === "masonry" ? "block" : "grid",
	);
	c.resp(block.columns, (n) =>
		mode === "masonry" ? tw.columns(n) : tw.cols(n),
	);
	c.resp(block.gap, (g) =>
		mode === "masonry" ? [tw.gapX(g), tw.childMb(g)] : tw.gap(g),
	);
	const style: CSSProperties = block.aspectRatio
		? { aspectRatio: block.aspectRatio.replace(":", " / "), objectFit: "cover" }
		: {};
	// Column width unknown (sizes auto); height from the ratio or the image.
	const [rw, rh] = (block.aspectRatio ?? "").split(":").map(Number);
	const box: ImageBox = rw && rh ? { ratio: rw / rh, fit: "cover" } : {};
	return (
		<ul className={c.className}>
			{block.items.map((it, i) => (
				<li key={i} className="break-inside-avoid">
					<GalleryImage
						item={it}
						className={img.className}
						style={style}
						box={box}
					/>
					{it.caption && (
						<span className="wc-caption mt-1 block">{it.caption}</span>
					)}
				</li>
			))}
		</ul>
	);
}

function GalleryImage({
	item,
	className,
	style,
	box,
}: {
	item: GalleryItem;
	className: string;
	style: CSSProperties;
	/** The box the image is drawn in (srcset / sizes). */
	box: ImageBox;
}) {
	const img = (
		<img
			className={className}
			style={style}
			src={item.asset.url}
			{...imageSrcSet(item.asset, box)}
			alt={item.asset.alt ?? ""}
			width={item.asset.width}
			height={item.asset.height}
			loading="lazy"
			decoding="async"
		/>
	);
	return item.link ? (
		<a href={item.link.url} target={item.link.target} rel={item.link.rel}>
			{img}
		</a>
	) : (
		img
	);
}
