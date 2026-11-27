// Render tree: blocks → components from the registry, each wrapped in its box.
//
//   <Blocks blocks={page.blocks} ctx={ctx} />
//     └─ <Block>  registry[type] inside BoxFrame (unless the component owns its box)
//
// Annotate mode (edit mode, opt-in): block elements carry their rendered
// path (data-wc-path: header/0, blocks/2/items/1, dialogs/<ref>/0), <main>
// the revision, the page embeds its JSON; block keys are source paths, so
// an insert does not remount later siblings; every block renders inside a
// boundary that shows a placeholder naming its type and finding instead of
// breaking the page. With the editor's origins the bridge is inlined.

import type { PageConsent } from "@wunderweb/core/consent";
import { type ComponentType, type ReactNode, Suspense } from "react";

import { mountBridge } from "./bridge-script.js";
import { Dialog } from "./elements.js";
import type {
	BlockLike,
	BlockRef,
	Registry,
	RenderContext,
} from "./registry.js";

export interface PageData {
	locale: string;
	alternates: Record<string, string>;
	homes: Record<string, string>;
	header: BlockLike[];
	blocks: BlockLike[];
	footer: BlockLike[];
	/**
	 * Dialogs the page opens (fragment ref → blocks), from the loader. Each is
	 * rendered once after the footer, however many buttons open it.
	 */
	dialogs?: Record<string, BlockLike[]>;
	/** Consent texts and config (site config `consent`), for gates. */
	consent?: PageConsent | undefined;
}

/** Where a rendered block is authored (the loader's source map entry). */
export interface BlockSource {
	file: string;
	path: string;
	via?: { file: string; path: string }[];
}

/** Props of an adapter's boundary around each block (e.g. a client error boundary). */
export interface BoundaryProps {
	type: string;
	path: string;
	revision: number | undefined;
	/** What to show when the block fails. */
	fallback: ReactNode;
	children: ReactNode;
}

/** Annotate mode: what the edit service knows about the rendered page. */
export interface Annotation {
	/** Revision the page shows (stamped on <main>). */
	revision?: number;
	/** Rendered path → authored location: block keys. */
	sources?: Record<string, BlockSource>;
	/** Rendered path → findings: blocks with errors render as placeholders. */
	findings?: Record<string, { level: string; message: string; at?: string }[]>;
	/** Editor origins the page's bridge talks to; without: no bridge. */
	editorOrigins?: string[];
	/** Adapter boundary around each block, e.g. a client error boundary. */
	boundary?: ComponentType<BoundaryProps>;
}

export interface RenderOptions {
	registry: Registry;
	breakpoints: string[];
	/** Edit mode annotation (rendered paths, revision, keys, boundaries, bridge). */
	annotate?: boolean | Annotation | undefined;
	/** @deprecated Alias of `annotate: true` (one release). */
	inspect?: boolean | undefined;
}

/** Script element with the page data in annotate mode. */
export const PAGE_DATA_ID = "wc-page";
/** @deprecated Use PAGE_DATA_ID. */
export const INSPECT_ID = PAGE_DATA_ID;

/** Context for a page: render() resolves blocks through the registry. */
export function createContext(
	page: Pick<PageData, "locale" | "alternates" | "homes" | "consent">,
	opts: RenderOptions,
): RenderContext {
	const ctx: RenderContext = {
		...(page.consent ? { consent: page.consent } : {}),
		locale: page.locale,
		alternates: page.alternates,
		homes: page.homes,
		registry: opts.registry,
		breakpoints: opts.breakpoints,
		render: (blocks, key) => (
			<Blocks blocks={blocks} ctx={ctx} keyPrefix={key} />
		),
	};
	return ctx;
}

export function Blocks({
	blocks,
	ctx,
	keyPrefix = "b",
	priority = false,
}: {
	blocks: BlockRef | readonly BlockRef[] | undefined;
	ctx: RenderContext;
	keyPrefix?: string | undefined;
	/**
	 * The first block gets `ctx.priority` (its background image loads at
	 * once, with high priority), unless it is hidden at some breakpoint: an
	 * eager image loads even where it is not shown. Page sets it for main.
	 */
	priority?: boolean | undefined;
}): ReactNode {
	if (!blocks) {
		return null;
	}
	const list = (Array.isArray(blocks) ? blocks : [blocks]) as BlockLike[];
	return list.map((b, i) => (
		<Block
			key={keyOf(ctx, b) ?? `${keyPrefix}-${i}-${b.type}`}
			block={b}
			ctx={
				priority && i === 0 && !hiddenSomewhere(b) ? { ...ctx, priority } : ctx
			}
		/>
	));
}

/** Whether a block's `visible` hides it at any breakpoint. */
function hiddenSomewhere(b: BlockLike): boolean {
	const v = b.visible;
	return (
		v !== null &&
		typeof v === "object" &&
		Object.values(v as Record<string, unknown>).some((x) => x === false)
	);
}

/** Annotate mode: the source path (with the Includes it came through), else the rendered path. */
function keyOf(ctx: RenderContext, b: BlockLike): string | undefined {
	const path = ctx.paths?.get(b);
	if (path === undefined) {
		return undefined;
	}
	const s = ctx.annotation?.sources?.[path];
	if (!s) {
		return `@${path}`;
	}
	return [...(s.via ?? []), s].map((x) => `${x.file}#${x.path}`).join(">");
}

export function Block({
	block,
	ctx,
}: {
	block: BlockLike;
	ctx: RenderContext;
}): ReactNode {
	const Component = ctx.registry.components[block.type];
	const path = ctx.paths?.get(block);
	if (path === undefined) {
		if (!Component) {
			throw new Error(
				`wunderweb: no component registered for block type "${block.type}"`,
			);
		}
		return <Component block={block} ctx={ctx} />;
	}

	// Annotate mode: the block's BoxFrame tags its element with this path.
	const a = ctx.annotation ?? {};
	const error = a.findings?.[path]?.find((f) => f.level === "error");
	if (error || !Component) {
		return (
			<Placeholder
				type={block.type}
				path={path}
				message={error?.message ?? "no component registered"}
			/>
		);
	}
	const fallback = (
		<Placeholder type={block.type} path={path} message="failed to render" />
	);
	const content = (
		<Suspense fallback={fallback}>
			<Component block={block} ctx={{ ...ctx, path }} />
		</Suspense>
	);
	const Boundary = a.boundary;
	return Boundary ? (
		<Boundary
			type={block.type}
			path={path}
			revision={a.revision}
			fallback={fallback}
		>
			{content}
		</Boundary>
	) : (
		content
	);
}

/** Stands in for a block that cannot render: its type and the finding. */
function Placeholder({
	type,
	path,
	message,
}: {
	type: string;
	path: string;
	message: string;
}) {
	return (
		<div
			data-wc-error=""
			data-block={type}
			data-wc-path={path}
			role="alert"
			style={{
				margin: "8px",
				padding: "12px 16px",
				border: "2px dashed #dc2626",
				borderRadius: "6px",
				background: "#fef2f2",
				color: "#991b1b",
				font: "13px/1.4 system-ui, sans-serif",
			}}
		>
			<strong>{type}</strong>: {message}
		</div>
	);
}

/**
 * Rendered path of every block in a tree, e.g.
 *   { blocks: [{ type: "SideBySide", start: { type: "Text" } }] }
 *   → SideBySide: "blocks/0", Text: "blocks/0/start"
 */
function blockPaths(
	node: unknown,
	path: string,
	out: WeakMap<object, string>,
): WeakMap<object, string> {
	if (!node || typeof node !== "object") {
		return out;
	}
	if (BLOCK_TYPE.test(String((node as BlockLike).type))) {
		out.set(node, path);
	}
	for (const [k, v] of Object.entries(node)) {
		blockPaths(v, path ? `${path}/${k}` : k, out);
	}
	return out;
}

/** Block types are PascalCase; lower-case `type` keys are values, e.g. inputs. */
const BLOCK_TYPE = /^[A-Z]/;

/** Language switch data: locale → url of the translation, else the locale home. */
export function languageLinks(
	ctx: Pick<RenderContext, "alternates" | "homes">,
): Record<string, { url: string; translated: boolean }> {
	return Object.fromEntries(
		Object.entries(ctx.homes).map(([l, home]) => [
			l,
			{ url: ctx.alternates[l] ?? home, translated: l in ctx.alternates },
		]),
	);
}

/** JSON for an inline script: `<` escaped so content cannot close it. */
function scriptJson(value: unknown): string {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Annotate options; `inspect` is the deprecated alias of `annotate: true`. */
function annotation(opts: RenderOptions): Annotation | undefined {
	if (opts.annotate === true || (!opts.annotate && opts.inspect)) {
		return {};
	}
	return opts.annotate || undefined;
}

/** A full page: header, main content, footer. */
export function Page({ page, ...opts }: { page: PageData } & RenderOptions) {
	const ctx = createContext(page, opts);
	const { dialogs = {}, ...rest } = page;
	const annotate = annotation(opts);
	if (annotate) {
		ctx.annotation = annotate;
		ctx.paths = blockPaths(
			{
				header: page.header,
				blocks: page.blocks,
				footer: page.footer,
				dialogs,
			},
			"",
			new WeakMap(),
		);
	}
	const origins = annotate?.editorOrigins ?? [];

	return (
		<>
			{page.header.length > 0 && (
				<header className="wc-header">
					<Blocks blocks={page.header} ctx={ctx} keyPrefix="h" />
				</header>
			)}
			<main className="wc-main" data-wc-revision={annotate?.revision}>
				<Blocks blocks={page.blocks} ctx={ctx} priority />
			</main>
			{page.footer.length > 0 && (
				<footer className="wc-footer">
					<Blocks blocks={page.footer} ctx={ctx} keyPrefix="f" />
				</footer>
			)}
			{Object.entries(dialogs).map(([ref, blocks]) => (
				<Dialog key={ref} fragment={ref} blocks={blocks} ctx={ctx} />
			))}
			{annotate && (
				<script
					id={PAGE_DATA_ID}
					type="application/json"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: JSON, `<` escaped so rich text cannot close the script
					dangerouslySetInnerHTML={{
						__html: scriptJson({
							revision: annotate.revision,
							page: rest,
							dialogs,
							breakpoints: opts.breakpoints,
						}),
					}}
				/>
			)}
			{origins.length > 0 && (
				<script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: own source and the editor origins, no content
					dangerouslySetInnerHTML={{
						__html: `(${mountBridge})(${scriptJson({ origins })})`,
					}}
				/>
			)}
		</>
	);
}
