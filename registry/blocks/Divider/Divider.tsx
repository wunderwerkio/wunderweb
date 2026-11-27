import {
	type BlockProps,
	BoxFrame,
	Classes,
	ownBox,
	paint,
	tw,
} from "@wunderweb/react";

import type { DividerBlock } from "../../generated/types";

export const Divider = ownBox(function Divider({
	block,
	ctx,
}: BlockProps<DividerBlock>) {
	const c = new Classes([]).add(
		"wc-divider",
		"w-full",
		"border-t",
		tw.borderStyle(block.style ?? "solid"),
	);
	paint(c, "border", block.color);
	return (
		<BoxFrame block={block as never} ctx={ctx} flat>
			<hr className={c.className} style={c.style} />
		</BoxFrame>
	);
});
