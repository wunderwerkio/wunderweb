import {
	type BlockProps,
	BoxFrame,
	ButtonEl,
	Classes,
	ownBox,
	tw,
} from "@wunderweb/react";

import type { ButtonsBlock } from "../../generated/types";

/** Buttons in a row or column; without layout the box has no inner wrapper. */
export const Buttons = ownBox(function Buttons({
	block,
	ctx,
}: BlockProps<ButtonsBlock>) {
	const c = new Classes(ctx.breakpoints).add("wc-buttons", "flex", "flex-wrap");
	c.resp(block.direction, (d) => tw.direction(d));
	c.resp(block.justify, (j) => tw.justify(j));
	c.resp(block.gap, (g) => tw.gap(g));
	const full = new Classes(ctx.breakpoints);
	full.resp(block.fullWidth, (f) => tw.fullWidth(f));
	return (
		<BoxFrame block={block as never} ctx={ctx} flat>
			<div className={c.className}>
				{block.items.map((b, i) => (
					<ButtonEl key={i} button={b} ctx={ctx} className={full.className} />
				))}
			</div>
		</BoxFrame>
	);
});
