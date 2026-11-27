// Registry: block type → component. Every block is project-owned; its
// component comes from the generated component map (generated/components.ts,
// one entry per blocks/<Name>/<Name>.tsx).
//
//   import { components } from "../generated/components";
//   const registry = createRegistry(components);            // or {...components, Card: MyCard}
//
// Components receive the block (defaults applied, urls resolved). By default
// a component renders only the inside; the runtime wraps it in the block's
// box (layout, place, background, appearance, before / after). A component
// marked with ownBox() renders the box itself with <BoxFrame> and its
// options (flat, as, outerClass, innerClass).

import type { PageConsent } from "@wunderweb/core/consent";
import type { ComponentType, ReactNode } from "react";

import { withBox } from "./box.js";
import type { Annotation } from "./render.js";

/** Context passed to every block component. */
export interface RenderContext {
	locale: string;
	/** Same page in other locales: locale → url. */
	alternates: Record<string, string>;
	/** Locale homes: locale → url. */
	homes: Record<string, string>;
	registry: Registry;
	/** Theme breakpoints, ascending, e.g. ["base", "md", "lg"]. */
	breakpoints: string[];
	/** Renders child blocks, e.g. the slots of a block (any generated block type). */
	render: (
		blocks: BlockRef | readonly BlockRef[] | undefined,
		key?: string,
	) => ReactNode;
	/** Annotate mode: block → rendered path, e.g. "blocks/2/start". */
	paths?: WeakMap<object, string>;
	/** Annotate mode: rendered path of the block being rendered. */
	path?: string | undefined;
	/** Annotate mode: revision, sources, findings, boundary. */
	annotation?: Annotation;
	/** Consent texts and config of the page (site config `consent`); unset = none. */
	consent?: PageConsent | undefined;
	/**
	 * The block being rendered is the page's first (`Blocks` with
	 * `priority`): its background image loads at once, with high priority
	 * (likely the largest contentful paint). Never set for child blocks:
	 * `render` renders them without it.
	 */
	priority?: boolean | undefined;
}

export type BlockLike = { type: string; [k: string]: unknown };

/** Any block value, e.g. a generated TextBlock or a role union like Content. */
export type BlockRef = { readonly type: string };

export interface BlockProps<B> {
	block: B;
	ctx: RenderContext;
}

export type BlockComponent<B = BlockLike> = ComponentType<BlockProps<B>>;

export type Components<M> = { [K in keyof M]: BlockComponent<M[K]> };

export interface Registry {
	components: Record<string, BlockComponent>;
}

/** Property marking a component that renders its own box (plain string: survives duplicate package copies). */
const OWN_BOX = "wcOwnBox";

/**
 * Marks a block component that renders its box itself:
 *
 *   export const Buttons = ownBox(function Buttons({ block, ctx }) {
 *     return <BoxFrame block={block} ctx={ctx} flat>…</BoxFrame>;
 *   });
 */
export function ownBox<C extends object>(component: C): C {
	Object.defineProperty(component, OWN_BOX, { value: true });
	return component;
}

export function hasOwnBox(component: object): boolean {
	return (component as Record<string, unknown>)[OWN_BOX] === true;
}

/** Registry from a component map (usually the generated one, possibly with overrides). */
export function createRegistry<M extends object>(
	components: Components<M>,
): Registry {
	const own = components as unknown as Record<string, BlockComponent>;
	return {
		components: Object.fromEntries(
			Object.entries(own).map(([type, c]) => [
				type,
				hasOwnBox(c) ? c : withBox(c),
			]),
		),
	};
}
