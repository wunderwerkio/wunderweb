import { type BlockProps, RichText } from "@wunderweb/react";

import type { TextBlock } from "../../generated/types";

export function Text({ block }: BlockProps<TextBlock>) {
	return <RichText html={block.body} />;
}
