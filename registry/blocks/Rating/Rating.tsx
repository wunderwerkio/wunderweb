import {
	type BlockProps,
	BoxFrame,
	imageSrcSet,
	ownBox,
} from "@wunderweb/react";

import type { RatingBlock } from "../../generated/types";

export const Rating = ownBox(function Rating({
	block,
	ctx,
}: BlockProps<RatingBlock>) {
	return (
		<BoxFrame block={block as never} ctx={ctx} flat>
			<div className="wc-rating flex items-center gap-2">
				{block.logo && (
					<img
						className="h-6 w-auto"
						src={block.logo.url}
						// h-6 w-auto: 1.5rem high, as wide as the logo's ratio.
						{...imageSrcSet(block.logo, { height: 1.5, unit: "rem" })}
						alt={block.logo.alt ?? ""}
						width={block.logo.width}
						height={block.logo.height}
					/>
				)}
				<Stars value={block.value} />
				{block.label && <span className="wc-rating-label">{block.label}</span>}
			</div>
		</BoxFrame>
	);
});

function Stars({ value }: { value: number }) {
	const full = Math.round(value);
	return (
		<span className="wc-stars" role="img" aria-label={`${value} / 5`}>
			{"★".repeat(full)}
			<span className="opacity-30">{"★".repeat(5 - full)}</span>
		</span>
	);
}
