import type { BlockProps } from "@wunderweb/react";

import type { StackBlock } from "../../generated/types";

/** Leaf blocks stacked vertically; the box's layout.gap spaces them. */
export function Stack({ block, ctx }: BlockProps<StackBlock>) {
	return <>{ctx.render(block.items)}</>;
}
