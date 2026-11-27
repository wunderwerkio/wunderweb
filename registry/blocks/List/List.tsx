import {
	type BlockProps,
	ButtonEl,
	Classes,
	cssColor,
	IconEl,
	paint,
	RichText,
	tw,
} from "@wunderweb/react";

import type { ListBlock } from "../../generated/types";

const LIST_MARK: Record<string, string> = {
	bullet: "•",
	check: "✓",
	thumbsup: "👍",
	none: "",
};

export function List({ block, ctx }: BlockProps<ListBlock>) {
	const c = new Classes(ctx.breakpoints).add(
		"wc-list",
		"flex",
		"flex-col",
		"list-none",
		"p-0",
	);
	c.resp(block.gap, (g) => tw.gap(g));
	const marker = block.marker ?? "bullet";
	const Tag = marker === "number" ? "ol" : "ul";

	const item = new Classes([]).add(
		"wc-list-item",
		"flex",
		"items-start",
		"gap-3",
	);
	if (block.itemLayout === "split") {
		item.add("sm:items-center");
	}
	if (block.itemRounded) {
		item.add(tw.rounded(block.itemRounded));
	}
	if (block.itemBackground || block.itemBorder || block.striped) {
		item.add("px-4", "py-3");
	}
	if (block.itemBorder) {
		item.add(
			tw.borderWidth(block.itemBorder.width),
			tw.borderStyle(block.itemBorder.style ?? "solid"),
		);
		paint(item, "border", block.itemBorder.color);
	}
	if (block.divided) {
		item.add("[&+&]:border-t", "[&+&]:pt-3", "border-current/20");
	}
	if (block.striped) {
		item.add("odd:bg-current/5");
	}
	const itemStyle = block.itemBackground
		? { backgroundColor: cssColor(block.itemBackground) }
		: undefined;
	const markStyle = block.markerColor
		? { color: cssColor(block.markerColor) }
		: undefined;

	return (
		<Tag className={c.className}>
			{block.items.map((it, i) => (
				<li key={i} className={item.className} style={itemStyle}>
					{(it.icon || marker !== "none") && (
						<span className="wc-list-marker shrink-0" style={markStyle}>
							{it.icon ? (
								<IconEl icon={{ size: "sm", ...it.icon }} />
							) : marker === "number" ? (
								`${i + 1}.`
							) : (
								LIST_MARK[marker]
							)}
						</span>
					)}
					<div
						className={`min-w-0 flex-1 ${block.itemLayout === "split" ? "sm:flex sm:items-center sm:justify-between sm:gap-4" : ""}`}
					>
						<div>
							{it.title && (
								<div className="wc-list-title font-semibold">
									{it.link ? (
										<a
											href={it.link.url}
											target={it.link.target}
											rel={it.link.rel}
										>
											{it.title}
										</a>
									) : (
										it.title
									)}
								</div>
							)}
							<RichText html={it.body} />
						</div>
						{it.action && (
							<div className="mt-2 shrink-0 sm:mt-0">
								<ButtonEl button={it.action} ctx={ctx} />
							</div>
						)}
					</div>
				</li>
			))}
		</Tag>
	);
}
