import { type BlockProps, BoxFrame, IconEl, ownBox } from "@wunderweb/react";

import type { IconBlockBlock } from "../../generated/types";

export const IconBlock = ownBox(function IconBlock({
	block,
	ctx,
}: BlockProps<IconBlockBlock>) {
	return (
		<BoxFrame block={block as never} ctx={ctx} flat>
			<IconEl icon={block.icon} />
		</BoxFrame>
	);
});
