import {
	type BlockProps,
	BoxFrame,
	MediaElement,
	ownBox,
	RichText,
} from "@wunderweb/react";

import type { MediaBlock } from "../../generated/types";

/**
 * Image or video. The link wraps the media itself (no overlay link), so
 * the box renders without it; `fill` makes box and media fill the cell.
 */
export const Media = ownBox(function Media({
	block,
	ctx,
}: BlockProps<MediaBlock>) {
	const frame = { ...block, link: undefined } as never;
	const el = <MediaElement block={block} />;
	return (
		<BoxFrame
			block={frame}
			ctx={ctx}
			outerClass={block.fill ? "h-full" : undefined}
			innerClass={block.fill ? "h-full" : undefined}
		>
			{block.link ? (
				<a
					href={block.link.url}
					target={block.link.target}
					rel={block.link.rel}
					className="block h-full"
				>
					{el}
				</a>
			) : (
				el
			)}
			{block.caption && (
				<RichText html={block.caption} className="wc-caption mt-2" />
			)}
		</BoxFrame>
	);
});
