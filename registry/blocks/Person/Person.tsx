import {
	type BlockProps,
	BoxFrame,
	imageSrcSet,
	ownBox,
} from "@wunderweb/react";

import type { PersonBlock } from "../../generated/types";

/** The avatar's box: h-12 w-12 (3rem, follows the font size), object-cover. */
const AVATAR = { width: 3, height: 3, fit: "cover", unit: "rem" } as const;

export const Person = ownBox(function Person({
	block,
	ctx,
}: BlockProps<PersonBlock>) {
	const shape =
		block.avatarShape === "rect"
			? ""
			: block.avatarShape === "rounded"
				? "rounded-lg"
				: "rounded-full";
	return (
		<BoxFrame block={block as never} ctx={ctx} flat>
			<div className="wc-person flex items-center gap-3">
				{block.avatars?.length ? (
					<div className="flex -space-x-3">
						{block.avatars.map((a, i) => (
							<img
								key={i}
								className={`h-12 w-12 object-cover ring-2 ring-current/10 ${shape}`}
								src={a.url}
								{...imageSrcSet(a, AVATAR)}
								alt={a.alt ?? ""}
								width={a.width}
								height={a.height}
								loading="lazy"
							/>
						))}
					</div>
				) : null}
				<div>
					<div className="wc-person-name font-semibold">{block.name}</div>
					{block.role && (
						<div className="wc-person-role text-sm opacity-80">
							{block.role}
						</div>
					)}
					{block.rating !== undefined && <Stars value={block.rating} />}
				</div>
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
