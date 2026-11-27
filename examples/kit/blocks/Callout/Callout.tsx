import { type BlockProps, RichText } from "@wunderweb/react";

// A package block cannot import the site's generated/types: it types its
// own fields (block.yaml), the site's schema checks the content.
interface CalloutBlock {
	type: "Callout";
	title: string;
	body?: string;
	/** @deprecated Use title. */
	label?: string;
}

export function Callout({ block }: BlockProps<CalloutBlock>) {
	return (
		<aside className="kit-callout mx-auto max-w-xl rounded-lg p-6">
			<p className="kit-callout-title text-lg font-bold">{block.title}</p>
			{block.body ? <RichText html={block.body} /> : null}
		</aside>
	);
}
