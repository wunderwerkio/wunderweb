// Content validation: JSON Schema plus the rules it cannot express.
//
// Per document:
//   1. JSON Schema (structure, tokens, nesting)
//   2. rich text: only vocabulary elements, attributes and classes
//   3. SVG: one <svg> root, shapes only, no root style
//   4. block rules: core type rules and the block's declared rules
//      (oneOf, only, childPlace, actionOptional, ratioMax), surround depth,
//      responsive values that drop a default's base
// Per page, with includes and chrome expanded:
//   5. includes / dialogs resolve, slots exist and fit where they land
//   6. anchors unique, #anchor and page:<id>#anchor links hit an anchor
//      (or the value names a fragment in a Ref field, e.g. a dialog fallback);
//      dialogs the page renders do not repeat its anchors
// Across the site:
//   7. page ids and paths unique per locale, translations present

import { type HTMLElement, parse as parseHtml } from "node-html-parser";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "./ajv.js";
import { blockIds } from "./block-ids.js";
import { checkConsent, MEDIA, SETTINGS_URL } from "./consent.js";
import { expandSlots, type SlotOverride } from "./include.js";
import {
	CHILD_PLACEMENT,
	type Condition,
	isPlain,
	type RichTextVocab,
	type Rule,
} from "./model.js";
import type { Config, Content, SourceDoc } from "./project.js";
import {
	type BlockJson,
	type JsonSchema,
	type TypedString,
	type Visitor,
	Walker,
} from "./walk.js";

export type Level = "error" | "warning";

export interface Finding {
	level: Level;
	/** Content file, e.g. de/pages/home.yaml */
	file: string;
	/** JSON path with block type, e.g. blocks/2/items/0 (Card) */
	at: string;
	message: string;
}

// Elements a measure-* class may sit on.
const MEASURE_ELEMENTS = [
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"li",
	"blockquote",
];
const PROSE = "p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote";
const PAGE_LINK = /^page:([a-z][a-z0-9-]*)(?:#(.+))?$/;
const MAX_ENUM_LISTED = 12;
const INCLUDE = "Include";
const BUTTON = "Button";
const BASE = "base";
const REF = "#/$defs/Ref";
/** Surround trait slots: blocks placed there may not carry surround content. */
const SURROUND_FIELDS = ["before", "after"];
/** A rich text link to consent:settings, either quote style. */
const SETTINGS_HREF = /\shref=(["'])\s*consent:settings\s*\1/i;
/** Rich text link targets, either quote style. */
const RICH_HREF = /\shref=(["'])(.*?)\1/gi;
/** The site config file, where consent findings point. */
const CONFIG_FILE = "wunderweb.config.yaml";

type Report = (at: string, message: string) => void;

/** Page ids a page: link may target from one locale. */
interface PageLinks {
	local: Map<string, SourceDoc>;
	fallback: Map<string, SourceDoc> | undefined;
	fallbackLocale: string;
	warn: Report;
}

/** Rules on core types and traits, for every block. Each returns a message or nothing. */
const CORE_RULES: ((b: BlockJson) => string | undefined)[] = [
	(b) => {
		const bg = b.background as Record<string, unknown> | undefined;
		return bg?.parallax && !bg.asset
			? "background.parallax needs background.asset"
			: undefined;
	},
	(b) => {
		const bg = b.background as Record<string, unknown> | undefined;
		return bg?.base && !bg.asset
			? "background.base only shows behind an asset; use background.color"
			: undefined;
	},
];

export class Validator {
	readonly walker: Walker;
	private readonly vocab: RichTextVocab;
	private readonly classPatterns: RegExp[];
	private readonly urlPattern: RegExp;
	private readonly validators: Record<string, ValidateFunction>;
	/** Deprecated values the running validation passed: pointer → field doc. */
	private deprecatedSeen: Map<string, string | undefined> | undefined;

	constructor(readonly schema: JsonSchema) {
		this.walker = new Walker(schema);
		this.vocab = schema["x-richText"] as RichTextVocab;
		this.classPatterns = this.vocab.classPatterns.map((p) => new RegExp(p));
		this.urlPattern = new RegExp(String(this.walker.defs.Url?.pattern));

		const ajv = new Ajv2020({
			allErrors: true,
			strict: false,
			discriminator: true,
			verbose: true,
		});
		// `deprecated` is an annotation in JSON Schema; here it also records
		// the values that use such a field, for a lint warning.
		ajv.removeKeyword("deprecated");
		ajv.addKeyword({
			keyword: "deprecated",
			schemaType: "boolean",
			errors: false,
			validate: (
				on: boolean,
				_data: unknown,
				parent?: { description?: string },
				cxt?: { instancePath: string },
			) => {
				if (on && cxt && this.deprecatedSeen) {
					this.deprecatedSeen.set(cxt.instancePath, parent?.description);
				}
				return true;
			},
		});
		ajv.addSchema(schema, "doc");
		this.validators = {
			Page: ajv.getSchema("doc#/$defs/Page") as ValidateFunction,
			Fragment: ajv.getSchema("doc#/$defs/Fragment") as ValidateFunction,
		};
	}

	/** Validates every document of a site, and its consent config. */
	validateSite(content: Content, config: Config): Finding[] {
		const findings: Finding[] = [];
		for (const src of content.docs) {
			findings.push(...this.validateDoc(src, content, config));
		}
		findings.push(...this.siteRules(content, config));
		findings.push(...this.consentRules(content, config));
		return applyAllow(findings, config);
	}

	/** The config's `consent` section against the theme tokens and pages. */
	private consentRules(content: Content, config: Config): Finding[] {
		const enumOf = (name: string) =>
			((this.walker.defs[name]?.enum as unknown[] | undefined) ?? []).map(
				String,
			);
		// page:<id> resolves per locale, falling back to the default locale.
		const pages = new Set(
			content.pages.get(config.defaultLocale)?.keys() ?? [],
		);
		return checkConsent(config.consent, {
			locales: config.locales,
			colors: enumOf("Color"),
			variants: enumOf("ButtonVariant"),
			pages,
		}).map((p) => ({ ...p, file: CONFIG_FILE }));
	}

	/** Schema, block and page-level findings of one document. */
	validateDoc(src: SourceDoc, content: Content, config: Config): Finding[] {
		const out: Finding[] = [];
		const report = (level: Level) => (at: string, message: string) =>
			out.push({ level, file: src.file, at: at || "(root)", message });

		if (src.parseError) {
			report("error")("", `YAML: ${src.parseError}`);
			return out;
		}
		const root = src.kind === "page" ? "Page" : "Fragment";
		const deprecated = new Map<string, string | undefined>();
		this.deprecatedSeen = deprecated;
		let schemaProblems: [string, string][];
		try {
			schemaProblems = this.schemaErrors(src.doc, root);
		} finally {
			this.deprecatedSeen = undefined;
		}
		for (const [at, message] of schemaProblems) {
			report("error")(at, message);
		}
		for (const [pointer, doc] of deprecated) {
			const parent = pointer.slice(0, pointer.lastIndexOf("/"));
			const field = decodePointer(pointer.slice(parent.length + 1));
			report("warning")(
				where(parent.slice(1), blockAt(src.doc, parent)),
				`field "${field}" is deprecated${doc ? ` (${doc})` : ""}; remove it or run the migration of the block's package`,
			);
		}
		// Content rules assume a structurally valid document.
		if (schemaProblems.length) {
			return out;
		}

		this.checkBlockIds(src.doc, root, report("error"));
		this.checkContent(src, content, config, report("error"), report("warning"));
		return out;
	}

	// ----------------------------------------------------------------- 1. schema

	private schemaErrors(doc: unknown, root: string): [string, string][] {
		const validate = this.validators[root];
		if (!validate || validate(doc)) {
			return [];
		}

		// An anyOf failure (e.g. Color | Hex) replaces its branch errors at the same path.
		const errors = validate.errors ?? [];
		const anyOfPaths = new Set(
			errors.filter((e) => e.keyword === "anyOf").map((e) => e.instancePath),
		);
		const errs = errors.filter(
			(e) => e.keyword === "anyOf" || !anyOfPaths.has(e.instancePath),
		);
		return errs.map((e) => [
			where(e.instancePath.slice(1), blockAt(doc, e.instancePath)),
			describe(e),
		]);
	}

	/**
	 * A block id is unique within its file. (Blocks without one are fine
	 * here; the CLI's lint warns about them, `format` fills them in.)
	 */
	private checkBlockIds(doc: unknown, root: string, report: Report) {
		for (const d of blockIds(this.walker, doc, root).duplicates) {
			report(
				where(d.path, d.block.type),
				`block id "${d.id}" already used at ${d.first}; ids must be unique within a file (\`wunderweb format\` assigns a new one)`,
			);
		}
	}

	// ----------------------------------------------------------------- 2-6. content

	private checkContent(
		src: SourceDoc,
		content: Content,
		config: Config,
		report: Report,
		warn: Report,
	) {
		const fragments =
			content.fragments.get(src.locale) ?? new Map<string, SourceDoc>();
		const pages: PageLinks = {
			local: content.pages.get(src.locale) ?? new Map<string, SourceDoc>(),
			fallback:
				src.locale === config.defaultLocale
					? undefined
					: content.pages.get(config.defaultLocale),
			fallbackLocale: config.defaultLocale,
			warn,
		};
		const anchors = new Map<string, string>();
		const hashLinks: { at: string; url: string; fallbacks: string[] }[] = [];
		const opened: { at: string; opens: string; url: unknown }[] = [];
		const blockPaths = new WeakMap<object, string>();
		const isPage = src.kind === "page";

		// `quiet` = chrome fragments: they only contribute anchors; their own
		// problems are reported where the fragment itself is validated.
		const makeVisitor = (r: Report, links: PageLinks): Visitor => {
			const v: Visitor = {
				enter: (b, field) => !(b.type === INCLUDE && field === "with"),
				misplaced: (b, path, allowed) =>
					r(
						where(path, b.type),
						`block type ${b.type} not allowed here (${allowed.join(", ")})`,
					),
				block: (b, path, parent) => {
					const at = where(path, b.type);
					blockPaths.set(b, path);
					for (const msg of this.blockRules(b, parent.block, parent.field)) {
						r(at, msg);
					}
					// Own blocks only: included fragments report in their own file.
					if (r === report && !path.includes("{")) {
						for (const msg of this.againstDefaults(b).restated) {
							warn(at, msg);
						}
					}
					this.collectAnchor(b.anchor, at, anchors, report);
					if (b.type === INCLUDE) {
						this.expandInclude(b, path, fragments, v, r);
					}
				},
				value: (type, value, path, _key, block) => {
					if (type === BUTTON && typeof value.opens === "string") {
						opened.push({
							at: where(path, block?.type),
							opens: value.opens,
							url: value.url,
						});
					}
					this.checkValue(
						type,
						value,
						where(path, block?.type),
						block,
						relPath(path, block ? blockPaths.get(block) : undefined),
						fragments,
						r,
					);
					// Own values only: included fragments report in their own file.
					if (
						type === "Asset" &&
						value.kind === "remote-video" &&
						r === report &&
						!path.includes("{")
					) {
						this.checkRemoteVideo(config, where(path, block?.type), r, warn);
					}
				},
				string: (s) => {
					this.checkString(s, anchors, hashLinks, links, r, report);
					this.checkConsentLink(s, config, r);
				},
			};
			return v;
		};

		this.walker.walk(
			src.doc,
			isPage ? "Page" : "Fragment",
			makeVisitor(report, pages),
		);

		// Site chrome is part of the rendered page: its anchors count.
		if (isPage && src.doc.chrome !== false) {
			const silent = () => {};
			const quiet = makeVisitor(silent, { ...pages, warn: silent });
			for (const ref of [
				src.doc.header ?? config.chrome?.header,
				src.doc.footer ?? config.chrome?.footer,
			]) {
				if (typeof ref !== "string") {
					continue;
				}
				const f = fragments.get(ref);
				if (!f) {
					report(
						"(root)",
						`chrome fragment "${ref}" not found in locale ${src.locale}`,
					);
					continue;
				}
				this.walker.walkBlocks(
					(f.doc.blocks as unknown[]) ?? [],
					"PageBlock",
					quiet,
					`{${ref}}`,
					{ block: f.doc, field: "blocks" },
				);
			}
		}

		// #anchor links must hit an anchor on the page (fragments are checked where included).
		if (!isPage) {
			return;
		}
		for (const { at, url, fallbacks } of hashLinks) {
			if (
				!anchors.has(url.slice(1)) &&
				!fallbacks.some((f) => fragments.has(f))
			) {
				report(at, `link "${url}" has no matching anchor on the page`);
			}
		}

		// Dialogs the page renders (once each): an #anchor url with opens is a
		// fallback, only rendered when the anchor is missing. Their anchors
		// share the page's id space.
		const dialogs = new Map<string, string>();
		for (const { at, opens, url } of opened) {
			const hash = typeof url === "string" && url.startsWith("#") ? url : "";
			if ((url && !hash) || (hash && anchors.has(hash.slice(1)))) {
				continue;
			}
			if (fragments.has(opens) && !dialogs.has(opens)) {
				dialogs.set(opens, at);
			}
		}
		for (const [ref, at] of dialogs) {
			for (const id of this.fragmentAnchors(ref, fragments)) {
				const first = anchors.get(id);
				if (first) {
					report(
						at,
						`dialog "${ref}" repeats anchor "${id}" of the page (${first}); ids must be unique on the rendered page`,
					);
				}
			}
		}
	}

	/** Anchors of a fragment with its includes (block anchors, rich text ids). */
	private fragmentAnchors(
		ref: string,
		fragments: Map<string, SourceDoc>,
		seen: string[] = [],
	): string[] {
		const f = fragments.get(ref);
		if (!f || seen.includes(ref)) {
			return [];
		}
		const out: string[] = [];
		this.walker.walkBlocks(
			(f.doc.blocks as unknown[]) ?? [],
			"PageBlock",
			{
				block: (b) => {
					if (typeof b.anchor === "string") {
						out.push(b.anchor);
					}
					if (b.type === INCLUDE) {
						out.push(
							...this.fragmentAnchors(String(b.ref), fragments, [...seen, ref]),
						);
					}
				},
				string: (s) => {
					if (s.type === "RichText") {
						for (const m of s.value.matchAll(/\sid="([^"]+)"/g)) {
							out.push(m[1] ?? "");
						}
					}
				},
			},
			"",
			{ block: f.doc, field: "blocks" },
		);
		return out;
	}

	/**
	 * Core type rules. `field` is the dotted path of the value in its block,
	 * e.g. "items.action" (list indices dropped).
	 */
	private checkValue(
		type: string,
		value: Record<string, unknown>,
		at: string,
		block: BlockJson | undefined,
		field: string,
		fragments: Map<string, SourceDoc>,
		report: Report,
	) {
		if (
			type === "Button" &&
			!value.url &&
			!value.opens &&
			!this.rulesOf(block).some(
				(r) => r.kind === "actionOptional" && r.fields.includes(field),
			)
		) {
			report(at, "button needs url or opens");
		}
		if (type === "Icon" && !value.svg && !value.text) {
			report(at, "icon needs svg or text");
		}
		if (
			type === "Button" &&
			typeof value.opens === "string" &&
			!fragments.has(value.opens)
		) {
			report(at, `dialog fragment "${value.opens}" not found`);
		}
	}

	/** A remote video is a third party: gated by the `media` consent category. */
	private checkRemoteVideo(
		config: Config,
		at: string,
		report: Report,
		warn: Report,
	) {
		if (!config.consent) {
			warn(
				at,
				"remote-video loads a third party without consent; add a consent section to wunderweb.config.yaml",
			);
		} else if (!Object.hasOwn(config.consent.categories ?? {}, MEDIA)) {
			report(
				at,
				`remote-video is gated by the consent category "${MEDIA}"; add it to consent.categories`,
			);
		}
	}

	/** consent:settings (Url or rich text link) opens settings only a consent config provides. */
	private checkConsentLink(s: TypedString, config: Config, report: Report) {
		if (config.consent) {
			return;
		}
		const hit =
			s.type === "Url"
				? s.value === SETTINGS_URL
				: s.type === "RichText" && SETTINGS_HREF.test(s.value);
		if (hit) {
			report(
				where(s.path, s.block?.type),
				`"${SETTINGS_URL}" needs a consent section in wunderweb.config.yaml`,
			);
		}
	}

	private checkString(
		s: TypedString,
		anchors: Map<string, string>,
		links: { at: string; url: string; fallbacks: string[] }[],
		pages: PageLinks,
		report: Report,
		anchorReport: Report,
	) {
		const at = where(s.path, s.block?.type);
		if (s.type === "RichText") {
			this.checkRichText(
				s.value,
				(m) => report(at, m),
				s.owner !== s.block?.type,
			);
			for (const m of s.value.matchAll(/\sid="([^"]+)"/g)) {
				this.collectAnchor(m[1], at, anchors, anchorReport);
			}
			for (const m of s.value.matchAll(RICH_HREF)) {
				this.checkPageLink(m[2] ?? "", at, pages, report);
			}
			return;
		}
		if (s.type === "Svg") {
			this.checkSvg(s.value, (m) => report(at, `${s.key}: ${m}`));
			return;
		}
		if (s.type !== "Url") {
			return;
		}

		this.checkPageLink(s.value, at, pages, report);
		if (s.value.startsWith("#") && s.value.length > 1) {
			links.push({ at, url: s.value, fallbacks: this.refsOf(s) });
		}
	}

	/**
	 * Fragments named next to a url: set Ref fields of the value holding it
	 * (e.g. a dialog fallback added by a theme). An #anchor link with such a
	 * fragment may miss its anchor on the page.
	 */
	private refsOf(s: TypedString): string[] {
		const def = s.owner ? this.walker.defs[s.owner] : undefined;
		const props = (def?.properties ?? {}) as Record<string, JsonSchema>;
		return Object.entries(props)
			.filter(([k, p]) => k !== s.key && p.$ref === REF)
			.map(([k]) => s.holder[k])
			.filter((v): v is string => typeof v === "string");
	}

	// ----------------------------------------------------------------- 4. block rules

	/** Declared rules of a block type (JSON Schema x-rules). */
	private rulesOf(block: BlockJson | undefined): Rule[] {
		const def = block ? this.walker.defs[block.type] : undefined;
		return (def?.["x-rules"] as Rule[] | undefined) ?? [];
	}

	/**
	 * Content against the block defaults:
	 *
	 *   dropped    Responsive values replace a default as a whole:
	 *              `padding: {md: …}` over a default `{base: …, md: …}` drops
	 *              the base value, so the block loses it on mobile. Content
	 *              must restate base (`base: {}` keeps nothing on purpose).
	 *   restated   A scalar set to the value the default already has
	 *              (`appearance.shadow: none` on a Card without shadow).
	 */
	private againstDefaults(b: BlockJson): {
		dropped: string[];
		restated: string[];
	} {
		const dropped: string[] = [];
		const restated: string[] = [];
		const visit = (
			s: JsonSchema,
			dflt: unknown,
			value: unknown,
			at: string,
		) => {
			if (dflt === undefined) {
				return;
			}
			if (!isPlain(dflt) || !isPlain(value)) {
				if (
					!isPlain(value) &&
					!Array.isArray(value) &&
					value !== undefined &&
					value === dflt
				) {
					restated.push(
						`${at}: ${JSON.stringify(value)} is the block default; leave it unset`,
					);
				}
				return;
			}
			const { def } = this.walker.resolve(s);
			if (def["x-responsive"]) {
				if (BASE in dflt && !(BASE in value)) {
					dropped.push(
						`${at}: sets ${Object.keys(value).join(" / ")} but not base, which drops the block default base ${JSON.stringify(dflt[BASE])} (responsive values replace defaults as a whole); set base, e.g. base: {} for none`,
					);
				}
				return;
			}
			const props = (def.properties ?? {}) as Record<string, JsonSchema>;
			for (const [k, v] of Object.entries(value)) {
				const ps = props[k];
				if (ps) {
					visit(ps, dflt[k], v, at ? `${at}.${k}` : k);
				}
			}
		};
		const def = this.walker.defs[b.type] ?? {};
		const props = (def.properties ?? {}) as Record<string, JsonSchema>;
		for (const [k, ps] of Object.entries(props)) {
			if (b[k] !== undefined && ps.default !== undefined) {
				visit(ps, ps.default, b[k], k);
			}
		}
		return { dropped, restated };
	}

	/** Messages for a block: core rules, its declared rules, placement and surround depth. */
	private blockRules(
		b: BlockJson,
		parent: BlockJson | Record<string, unknown>,
		field: string,
	): string[] {
		const out: string[] = [];
		for (const rule of CORE_RULES) {
			const msg = rule(b);
			if (msg) {
				out.push(msg);
			}
		}
		for (const rule of this.rulesOf(b)) {
			out.push(...checkRule(rule, b));
		}
		out.push(...this.againstDefaults(b).dropped);

		const parentBlock =
			typeof parent.type === "string" && this.walker.isBlockDef(parent.type)
				? (parent as BlockJson)
				: undefined;

		// Placement fields a slot must grant (childPlace on the parent block).
		const place = isPlain(b.place) ? b.place : {};
		const used = CHILD_PLACEMENT.filter((k) => place[k] !== undefined);
		if (used.length) {
			const granted = new Set(
				this.rulesOf(parentBlock)
					.filter(
						(r) =>
							r.kind === "childPlace" &&
							r.slot === field &&
							holds(parentBlock ?? {}, r.when),
					)
					.flatMap((r) => (r.kind === "childPlace" ? r.fields : [])),
			);
			const missing = used.filter((k) => !granted.has(k));
			if (missing.length) {
				out.push(
					`place.${missing.join(" / ")} only apply in slots whose block grants them (rule childPlace)`,
				);
			}
		}

		// A block in a surround slot may not carry surround content itself.
		if (
			parentBlock &&
			SURROUND_FIELDS.includes(field) &&
			SURROUND_FIELDS.some((k) => Array.isArray(b[k]) && b[k].length)
		) {
			out.push(
				`block in ${field} may not have before / after itself; move them into the parent's ${field}`,
			);
		}
		return out;
	}

	/**
	 * page:<id>[#anchor] must name a page of the same locale, or of the
	 * default locale (untranslated page; the link leaves the locale).
	 */
	private checkPageLink(
		url: string,
		at: string,
		links: PageLinks,
		report: Report,
	) {
		const m = url.match(PAGE_LINK);
		if (url.startsWith("page:") && !m) {
			report(at, `invalid page link "${url}"`);
			return;
		}
		const id = m?.[1] ?? "";
		if (!m || links.local.has(id)) {
			return;
		}
		if (links.fallback?.has(id)) {
			links.warn(
				at,
				`page link "${url}": no translation, links to the ${links.fallbackLocale} page`,
			);
			return;
		}
		report(at, `page link "${url}": no page with id "${id}"`);
	}

	private collectAnchor(
		id: unknown,
		at: string,
		anchors: Map<string, string>,
		report: Report,
	) {
		if (typeof id !== "string" || !id) {
			return;
		}
		const first = anchors.get(id);
		if (first) {
			report(at, `anchor "${id}" already used at ${first}`);
			return;
		}
		anchors.set(id, at);
	}

	private expandInclude(
		b: BlockJson,
		path: string,
		fragments: Map<string, SourceDoc>,
		visitor: Visitor,
		report: Report,
	) {
		const at = where(path, "Include");
		const ref = String(b.ref);
		const f = fragments.get(ref);
		if (!f) {
			report(at, `fragment "${ref}" not found`);
			return;
		}

		const overrides = (b.with as SlotOverride[] | undefined) ?? [];
		const { blocks, used } = expandSlots(
			(f.doc.blocks as unknown[]) ?? [],
			overrides,
		);
		for (const o of overrides) {
			if (!used.has(o.slot)) {
				report(at, `fragment "${ref}" has no slot "${o.slot}"`);
			}
			if (o.block?.type === INCLUDE) {
				report(at, `slot "${o.slot}": an Include cannot replace a slot`);
			}
		}

		// The resolved fragment is checked as part of the page: placement of
		// substituted blocks, anchors, links.
		this.walker.walkBlocks(blocks, "PageBlock", visitor, `${path}{${ref}}`, {
			block: f.doc,
			field: "blocks",
		});
	}

	// ----------------------------------------------------------------- rich text / svg

	private checkRichText(
		html: string,
		report: (m: string) => void,
		inValue: boolean,
	) {
		const root = parseHtml(html);
		const bad = new Set<string>();
		for (const el of root.querySelectorAll("*")) {
			this.checkElement(el, bad);
		}
		for (const b of bad) {
			report(`${b} not in rich text vocabulary`);
		}
		this.checkInlineButtons(root, report, inValue);

		// Empty paragraphs and <br> runs used as spacers (spacing belongs to layout).
		const spacers = root
			.querySelectorAll("p")
			.filter(
				(p) =>
					!p.text.replace(/\u00a0/g, "").trim() &&
					!p.querySelector("a, img, video, iframe, svg"),
			);
		if (
			spacers.length ||
			/<br\s*\/?>\s*(&nbsp;|\u00a0|\s)*<br\s*\/?>\s*(&nbsp;|\u00a0|\s)*<br/i.test(
				html,
			)
		) {
			report(
				"empty paragraphs / <br> runs as spacers: use layout.gap or padding",
			);
		}
	}

	private checkElement(el: HTMLElement, bad: Set<string>) {
		const tag = el.rawTagName?.toLowerCase() ?? "";
		if (!this.vocab.elements.includes(tag)) {
			bad.add(`element <${tag}>`);
			return;
		}
		for (const attr of Object.keys(el.attributes).map((a) => a.toLowerCase())) {
			if (
				!this.vocab.attributes.includes(attr) &&
				!this.vocab.dataAttributes.includes(attr)
			) {
				bad.add(`attribute ${attr} on <${tag}>`);
			}
		}
		if (tag === "table" && el.closest("td, th")) {
			bad.add("nested <table> (layout table)");
		}
		// Data tables have a header row; a table without <th> is a layout grid.
		if (tag === "table" && !el.querySelector("th")) {
			bad.add("<table> without header cells (layout table)");
		}
		const href = el.getAttribute("href");
		if (href !== undefined && !this.urlPattern.test(href.trim())) {
			bad.add(
				`href "${href.slice(0, 40)}" (not http(s), root-relative, mailto:, tel:, #anchor or page:)`,
			);
		}
		const classes = (el.getAttribute("class") ?? "")
			.split(/\s+/)
			.filter(Boolean);
		const measure = classes.find((c) => c.startsWith("measure-"));
		if (measure && !MEASURE_ELEMENTS.includes(tag)) {
			bad.add(`${measure} on <${tag}> (only on p, h1-h6, li, blockquote)`);
		}
		for (const c of classes) {
			const known =
				this.vocab.classes.includes(c) ||
				this.vocab.buttonClasses.includes(c) ||
				this.classPatterns.some((p) => p.test(c));
			if (!known) {
				bad.add(`class "${c}"`);
			}
		}
	}

	/**
	 * Buttons in rich text: one per element, inline in prose only. A block whose
	 * visible text is only buttons is a Buttons block written as markup (except
	 * in values without surround slots, e.g. AccordionItem.body).
	 */
	private checkInlineButtons(
		root: HTMLElement,
		report: (m: string) => void,
		inValue: boolean,
	) {
		if (!this.vocab.buttonClasses.length) {
			return;
		}
		const isButton = (a: HTMLElement) =>
			(a.getAttribute("class") ?? "")
				.split(/\s+/)
				.some((c) => this.vocab.buttonClasses.includes(c));

		for (const blk of root.querySelectorAll(PROSE)) {
			const buttons = blk.querySelectorAll("a").filter(isButton);
			if (!buttons.length || blk.parentNode?.closest?.(PROSE)) {
				continue;
			}
			if (/^h[1-6]$/.test(blk.rawTagName)) {
				report(`button inside <${blk.rawTagName}>: use a Buttons block`);
				continue;
			}
			if (buttons.length > 1) {
				report("several buttons in one element: use a Buttons block");
				continue;
			}
			const rest = buttons
				.reduce((t, a) => t.replace(a.text, ""), blk.text)
				.replace(/\u00a0/g, " ")
				.trim();
			if (!rest && !inValue) {
				report("button alone in a paragraph: use a Buttons block");
			}
		}
	}

	private checkSvg(svg: string, report: (m: string) => void) {
		const root = parseHtml(svg.trim());
		const top = root.childNodes.filter(
			(n) => n.nodeType === 1,
		) as HTMLElement[];
		const svgRoot = top[0];
		if (
			top.length !== 1 ||
			!svgRoot ||
			svgRoot.rawTagName?.toLowerCase() !== "svg"
		) {
			report("must have exactly one <svg> root");
			return;
		}
		if (svgRoot.getAttribute("style")) {
			report(
				"<svg> root must not carry style (size and position come from the block)",
			);
		}

		// Shapes and paint servers only: no text, images, links, styles, scripts.
		const bad = new Set<string>();
		for (const el of [svgRoot, ...svgRoot.querySelectorAll("*")]) {
			const tag = el.rawTagName;
			if (!this.vocab.svgElements.includes(tag)) {
				bad.add(`<${tag}> not allowed in SVG`);
				continue;
			}
			for (const attr of Object.keys(el.attributes)) {
				if (!this.vocab.svgAttributes.includes(attr)) {
					bad.add(`attribute ${attr} on <${tag}> not allowed in SVG`);
				}
			}
			// <use> may only reference shapes in the same SVG.
			if (tag === "use" && !(el.getAttribute("href") ?? "").startsWith("#")) {
				bad.add("<use> must reference a local #id");
			}
		}
		bad.forEach(report);
	}

	// ----------------------------------------------------------------- 7. site

	private siteRules(content: Content, config: Config): Finding[] {
		const out: Finding[] = [];
		const ids = new Map<string, Set<string>>();

		for (const locale of config.locales) {
			const byPath = new Map<string, string>();
			const byId = new Map<string, string>();
			for (const d of content.docs.filter(
				(x) => x.locale === locale && x.kind === "page" && !x.parseError,
			)) {
				const path = String(d.doc.path);
				// Locale prefixes are added by the router; /en/x would be /en/en/x.
				const prefix = config.locales.find(
					(l) => path === `/${l}` || path.startsWith(`/${l}/`),
				);
				if (prefix) {
					out.push({
						level: "error",
						file: d.file,
						at: "path",
						message: `path "${path}" starts with locale "${prefix}"; paths exclude the locale`,
					});
				}
				const first = byPath.get(path);
				if (first) {
					out.push({
						level: "error",
						file: d.file,
						at: "path",
						message: `path "${path}" already used by ${first}`,
					});
				}
				byPath.set(path, d.file);

				const firstId = byId.get(d.key);
				if (firstId) {
					out.push({
						level: "error",
						file: d.file,
						at: "id",
						message: `page id "${d.key}" already used by ${firstId}`,
					});
				}
				byId.set(d.key, d.file);
				ids.set(d.key, (ids.get(d.key) ?? new Set()).add(locale));
			}

			const refs = new Map<string, string>();
			for (const d of content.docs.filter(
				(x) => x.locale === locale && x.kind === "fragment" && !x.parseError,
			)) {
				const first = refs.get(d.key);
				if (first) {
					out.push({
						level: "error",
						file: d.file,
						at: "fragment",
						message: `fragment "${d.key}" already defined in ${first}`,
					});
				}
				refs.set(d.key, d.file);
			}
		}

		// Missing translations are allowed, but reported.
		for (const d of content.docs.filter((x) => x.kind === "page")) {
			const have = ids.get(d.key) ?? new Set();
			const missing = config.locales.filter((l) => !have.has(l));
			if (missing.length && d.locale === config.defaultLocale) {
				out.push({
					level: "warning",
					file: d.file,
					at: "id",
					message: `no translation in ${missing.join(", ")}`,
				});
			}
		}
		return out;
	}
}

// ----------------------------------------------------------------- helpers

/** Configured `lint.allow` entries downgrade matching errors to warnings. */
function applyAllow(findings: Finding[], config: Config): Finding[] {
	const allow = config.lint?.allow ?? [];
	return findings.map((f) =>
		allow.some((a) => a.file === f.file && f.message.includes(a.match))
			? { ...f, level: "warning" }
			: f,
	);
}

/** Dotted field path of a value in its block: "blocks/2/items/0/action" in "blocks/2" → "items.action". */
function relPath(path: string, blockPath: string | undefined): string {
	const rest =
		blockPath !== undefined && path.startsWith(blockPath)
			? path.slice(blockPath.length)
			: path;
	return rest
		.split("/")
		.filter((p) => p && !/^\d+$/.test(p))
		.join(".");
}

/** Values at a dotted path; lists along the way are flattened. */
function valuesAt(node: unknown, path: string | undefined): unknown[] {
	let nodes = [node];
	for (const seg of path ? path.split(".") : []) {
		nodes = nodes
			.flatMap((n) => (Array.isArray(n) ? n : [n]))
			.map((n) => (isPlain(n) ? n[seg] : undefined))
			.filter((n) => n !== undefined);
	}
	return nodes.flatMap((n) => (Array.isArray(n) && path ? n : [n]));
}

function valueAt(node: unknown, path: string): unknown {
	return path
		.split(".")
		.reduce<unknown>((v, k) => (isPlain(v) ? v[k] : undefined), node);
}

/** All conditions hold; an unset value counts as its schema default. */
function holds(node: unknown, when: Condition[] | undefined): boolean {
	return (when ?? []).every((c) => {
		const v = valueAt(node, c.path) ?? c.default;
		return v !== undefined && c.values.includes(v);
	});
}

function describeWhen(when: Condition[]): string {
	return when
		.map((c) => `${c.path} is ${c.values.map(String).join(" or ")}`)
		.join(" and ");
}

/** Findings of one declared rule (childPlace and actionOptional are checked elsewhere). */
function checkRule(rule: Rule, b: BlockJson): string[] {
	const prefix = (at: string | undefined) => (at ? `${at}: ` : "");
	switch (rule.kind) {
		case "oneOf": {
			const missing = valuesAt(b, rule.at).filter(
				(o) =>
					holds(o, rule.when) &&
					!rule.fields.some((f) => valueAt(o, f) !== undefined),
			);
			return missing.length
				? [
						rule.message ??
							`${prefix(rule.at)}needs ${rule.fields.join(" or ")}${rule.when ? ` when ${describeWhen(rule.when)}` : ""}`,
					]
				: [];
		}
		case "only": {
			const out: string[] = [];
			for (const o of valuesAt(b, rule.at)) {
				const set = rule.fields.filter((f) => valueAt(o, f) !== undefined);
				if (set.length && !holds(o, rule.when)) {
					out.push(
						rule.message ??
							`${prefix(rule.at)}${set.join(", ")} only apply when ${describeWhen(rule.when)}`,
					);
				}
			}
			return out;
		}
		case "ratioMax": {
			const v = valueAt(b, rule.field);
			const ratios = isPlain(v) ? Object.values(v) : v === undefined ? [] : [v];
			for (const r of ratios) {
				const sum = String(r)
					.split(":")
					.map(Number)
					.reduce((x, y) => x + y, 0);
				if (sum > rule.max) {
					return [`${rule.field} ${String(r)} exceeds ${rule.max} columns`];
				}
			}
			return [];
		}
		default:
			return [];
	}
}

function describe(e: ErrorObject): string {
	const p = e.params as Record<string, unknown>;
	switch (e.keyword) {
		case "required":
			return `missing required "${p.missingProperty}"`;
		case "additionalProperties":
			return `unknown field "${p.additionalProperty}"`;
		case "minLength":
		case "minItems":
			return "must not be empty";
		case "enum": {
			const values = p.allowedValues as unknown[];
			return `must be one of ${values.slice(0, MAX_ENUM_LISTED).join(", ")}${values.length > MAX_ENUM_LISTED ? ", …" : ""}`;
		}
		case "discriminator":
			return `block type not allowed here (${JSON.stringify(p.tagValue ?? null)})`;
		case "anyOf": {
			const branches = (
				(e.parentSchema as JsonSchema).anyOf as JsonSchema[]
			).map((s) =>
				String(s.$ref ?? s.type)
					.split("/")
					.pop(),
			);
			return `must be ${branches.join(" | ")}`;
		}
		default:
			return e.message ?? e.keyword;
	}
}

/** Type of the nearest enclosing block, or "". */
function blockAt(doc: unknown, pointer: string): string {
	let node = doc as Record<string, unknown> | undefined;
	let found = "";
	for (const part of pointer.split("/").slice(1)) {
		if (typeof node?.type === "string") {
			found = node.type;
		}
		node = node?.[
			decodeURIComponent(part.replace(/~1/g, "/").replace(/~0/g, "~"))
		] as Record<string, unknown> | undefined;
	}
	if (typeof node?.type === "string") {
		found = node.type;
	}
	return found;
}

function decodePointer(part: string): string {
	return part.replace(/~1/g, "/").replace(/~0/g, "~");
}

function where(path: string, type: string | undefined): string {
	return `${path || "(root)"}${type ? ` (${type})` : ""}`;
}
