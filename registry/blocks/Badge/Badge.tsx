import {
	type BlockProps,
	BoxFrame,
	Classes,
	ownBox,
	paint,
} from "@wunderweb/react";

import type { BadgeBlock } from "../../generated/types";

export const Badge = ownBox(function Badge({
	block,
	ctx,
}: BlockProps<BadgeBlock>) {
	const c = new Classes([]).add(
		"wc-badge",
		"inline-block",
		"rounded-full",
		"px-3",
		"py-1",
		"text-sm",
	);
	paint(c, "bg", block.color);
	paint(c, "text", block.textColor);
	return (
		<BoxFrame block={block as never} ctx={ctx} flat>
			<span className={c.className} style={c.style}>
				{block.text}
			</span>
		</BoxFrame>
	);
});
