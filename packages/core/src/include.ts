// Include expansion: a fragment's blocks with slot overrides applied.
//
//   fragment: [Section{slot: intro}, Tiles]      Include{ref, with: [{slot: intro, block: B}]}
//        └── expand ──▶ [B{slot: intro}, Tiles]

import { isPlain } from "./model.js";

export interface SlotOverride {
	slot: string;
	block: Record<string, unknown>;
}

export interface Expanded {
	blocks: unknown[];
	/** Slots of `with` that matched a block. */
	used: Set<string>;
	/** The substituted blocks (identity), e.g. to check them as page content. */
	replaced: Set<object>;
}

/** Replaces blocks carrying a `slot` id with the override of the same id. */
export function expandSlots(
	blocks: unknown[],
	overrides: SlotOverride[] = [],
): Expanded {
	const slots = new Map(overrides.map((w) => [w.slot, w.block]));
	const used = new Set<string>();
	const replaced = new Set<object>();

	const swap = (node: unknown): unknown => {
		if (Array.isArray(node)) {
			return node.map(swap);
		}
		if (!isPlain(node)) {
			return node;
		}

		const slot = typeof node.slot === "string" ? node.slot : undefined;
		const override = slot ? slots.get(slot) : undefined;
		if (slot && override) {
			used.add(slot);
			const block = { ...override, slot };
			replaced.add(block);
			return block;
		}
		return Object.fromEntries(
			Object.entries(node).map(([k, v]) => [k, swap(v)]),
		);
	};

	return { blocks: blocks.map(swap), used, replaced };
}
