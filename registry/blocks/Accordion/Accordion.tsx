import {
	type BlockProps,
	Classes,
	cssColor,
	paint,
	RichText,
} from "@wunderweb/react";

import type { AccordionBlock } from "../../generated/types";

/** Native <details> items sharing a name: one open at a time, no client JS. */
export function Accordion({ block }: BlockProps<AccordionBlock>) {
	const head = new Classes([]).add(
		"flex",
		"cursor-pointer",
		"list-none",
		"items-center",
		"justify-between",
		"gap-4",
		"p-4",
		"font-semibold",
		"[&::-webkit-details-marker]:hidden",
	);
	paint(head, "text", block.itemTextColor);
	const bg = block.itemBackground
		? { backgroundColor: cssColor(block.itemBackground) }
		: undefined;
	const name = `wc-acc-${Math.abs(hash(block.items.map((i) => i.title).join()))}`;
	return (
		<div
			className="wc-accordion flex flex-col gap-2"
			data-icon={block.icon ?? "chevron"}
		>
			{block.items.map((it, i) => (
				<details
					key={i}
					name={name}
					className="wc-accordion-item group overflow-hidden rounded-md"
					style={bg}
				>
					<summary className={head.className} style={head.style}>
						<span>{it.title}</span>
						<span
							aria-hidden="true"
							className="wc-accordion-icon shrink-0 transition-transform group-open:rotate-180"
						>
							{block.icon === "plus" ? "+" : "⌄"}
						</span>
					</summary>
					<RichText html={it.body} className="px-4 pb-4" />
				</details>
			))}
		</div>
	);
}

function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) {
		h = (h * 31 + s.charCodeAt(i)) | 0;
	}
	return h;
}
