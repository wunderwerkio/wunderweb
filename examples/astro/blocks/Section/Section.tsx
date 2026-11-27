import { type BlockProps, BoxFrame, ownBox } from "@wunderweb/react";

import type { SectionBlock } from "../../generated/types";

/** Rows on one shared background; the box is a <section>. */
export const Section = ownBox(function Section({
	block,
	ctx,
}: BlockProps<SectionBlock>) {
	return (
		<BoxFrame block={block as never} ctx={ctx} as="section">
			{ctx.render(block.blocks)}
		</BoxFrame>
	);
});
