import { type BlockProps, Classes, cssColor, Svg, tw } from "@wunderweb/react";
import type { CSSProperties } from "react";

import type { TimelineBlock } from "../../generated/types";

/**
 * Timeline: items alternate along a center line from md; stacked with the
 * line on the left below md. Marker: number, icon or none.
 */
export function Timeline({ block, ctx }: BlockProps<TimelineBlock>) {
	const items = block.items;
	const marker = block.marker ?? "number";
	const shape = block.markerShape ?? "rounded";
	const mirror = block.mirror !== false;
	const line = cssColor(block.lineColor) ?? "currentColor";
	// marker none: the marker box keeps its place (grid column) but shows nothing.
	const markerStyle: CSSProperties =
		marker === "none"
			? { visibility: "hidden" }
			: {
					backgroundColor: cssColor(block.markerBackground) ?? line,
					color: cssColor(block.markerColor),
				};
	const radius =
		shape === "circle"
			? "rounded-full"
			: shape === "rounded"
				? "rounded-md"
				: "rounded-none";
	// Items stack in a flex column, so `gap` spaces them.
	const list = new Classes(ctx.breakpoints).add(
		"wc-timeline",
		"relative",
		"flex",
		"flex-col",
		"list-none",
		"p-0",
	);
	list.resp(block.gap, (v) => tw.gap(v));

	return (
		<ol
			className={list.className}
			style={{ "--wc-line": line } as CSSProperties}
		>
			<span
				aria-hidden="true"
				className="absolute top-0 bottom-0 left-5 w-0.5 md:left-1/2 md:-translate-x-1/2"
				style={{ backgroundColor: line }}
			/>
			{items.map((item, i) => {
				const left = i % 2 === 1;
				return (
					<li
						key={i}
						className="relative grid grid-cols-[2.5rem_1fr] gap-4 md:grid-cols-[1fr_2.5rem_1fr] md:gap-8"
					>
						<span
							className={`wc-marker z-10 flex h-10 w-10 items-center justify-center font-bold md:col-start-2 md:row-start-1 ${radius} ${block.stickyMarker ? "sticky top-1/2 self-start" : "self-start"}`}
							style={markerStyle}
						>
							{marker === "number" ? (
								i + 1
							) : marker === "icon" ? (
								<Svg
									svg={block.markerIcon}
									className="block h-5 w-5 [&>svg]:h-full [&>svg]:w-full"
								/>
							) : null}
						</span>
						<div
							className={`min-w-0 md:row-start-1 ${left ? `md:col-start-1 ${mirror ? "md:text-end" : ""}` : "md:col-start-3"}`}
						>
							{ctx.render(item)}
						</div>
					</li>
				);
			})}
		</ol>
	);
}
