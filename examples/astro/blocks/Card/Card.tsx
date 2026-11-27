import {
	type BlockProps,
	Classes,
	IconEl,
	RichText,
	tw,
} from "@wunderweb/react";

import type { CardBlock } from "../../generated/types";

/**
 * Card: media bleeds to the card edges (negative margins = padding), icon
 * above or beside the body, forced text alignment (Card.css).
 */
export function Card({ block, ctx }: BlockProps<CardBlock>) {
	const align = new Classes(ctx.breakpoints).add("wc-card-body", "min-w-0");
	align.resp(block.textAlign, (a) =>
		a === "inherit" ? "wc-align-inherit" : ["wc-force-align", tw.textAlign(a)],
	);

	const media = block.media ? <CardMedia block={block} ctx={ctx} /> : null;
	const icon = block.icon ? <IconEl icon={block.icon} /> : null;
	const body = <RichText html={block.body} className={align.className} />;

	if (media || !icon) {
		return (
			<>
				{media}
				{body}
			</>
		);
	}

	const row = new Classes(ctx.breakpoints).add("wc-card-icon", "flex", "gap-3");
	row.resp(block.iconPlacement, (p) =>
		p === "top"
			? ["flex-col", "items-[inherit]"]
			: p === "start"
				? ["flex-row", "items-start"]
				: ["flex-row-reverse", "items-start"],
	);
	return (
		<div className={row.className}>
			<div className="shrink-0">{icon}</div>
			<div className="min-w-0 flex-1">{body}</div>
		</div>
	);
}

/** Card media bleeds over the card's padding (top, left, right). */
function CardMedia({ block, ctx }: BlockProps<CardBlock>) {
	const c = new Classes(ctx.breakpoints).add("wc-card-media");
	c.resp(block.layout?.padding, (p) =>
		[
			p.top ? tw.margin("top", -p.top) : undefined,
			p.left ? tw.margin("left", -p.left) : undefined,
			p.right ? tw.margin("right", -p.right) : undefined,
		].filter((x): x is string => Boolean(x)),
	);
	return <div className={c.className}>{ctx.render(block.media)}</div>;
}
