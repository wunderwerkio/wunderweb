// Model = core schema version (the contract) + project theme + project
// blocks, resolved into types, roles, traits and blocks. Input for the JSON
// Schema and TypeScript emitters.
//
//   core/<major>.yaml ─┐
//   theme.yaml ────────┼─ buildModel ─▶ Model ─┬─ toJsonSchema
//   blocks/*/block.yaml┘                        └─ toTypeScript
//
// buildModel is also where the contract checks block definitions: roles,
// slot nesting, types, style escape hatches, name clashes, rules and pins.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

import { type Expr, exprNames, parseExpr } from "./expr.js";
import { isPlain } from "./plain.js";

/**
 * Field spec in the schema notation: "Type" or {type, default, doc,
 * deprecated}. A deprecated field is still accepted; lint warns where
 * content sets it (a package keeps a removed field this way until its next
 * major version migrates the content).
 */
export type FieldSpec =
	| string
	| { type: string; default?: unknown; doc?: string; deprecated?: boolean };

export interface TypeSpec {
	doc?: string;
	enum?: (string | number)[] | Record<string, unknown>;
	fields?: Record<string, FieldSpec>;
	type?: string;
	pattern?: string;
	min?: number;
	max?: number;
}

export interface BlockSpec {
	doc?: string;
	traits?: string[];
	fields?: Record<string, FieldSpec>;
	defaults?: Record<string, unknown>;
}

/** Where an installed block came from (written by `wunderweb add`). */
export interface Provenance {
	/** Registry name, e.g. wunderweb. */
	registry: string;
	/** Item name in the registry, e.g. Card. */
	item: string;
	/** Ref it was installed from: tag, branch, sha or "working-tree". */
	ref: string;
	/** Commit of the registry the files came from (base of `update`). */
	commit: string;
	/** Contract major the item targets. */
	schema: number;
	/** Update merged with conflicts: provenance moves here once resolved. */
	pending?: { ref: string; commit: string };
}

/** Rule in a block definition (block.yaml `rules`), see RULE_KINDS. */
export type RuleSpec = Record<string, unknown>;

/** Project block: blocks/<Name>/block.yaml. */
export interface ProjectBlockSpec extends BlockSpec {
	/** Roles the block joins, e.g. [Leaf, Inline]. */
	in: string[];
	/** Types used by this block, e.g. TileGrid. Global names. */
	types?: Record<string, string | TypeSpec>;
	rules?: RuleSpec[];
	provenance?: Provenance;
}

export interface RoleSpec {
	doc?: string;
	/** Roles or blocks. */
	members: string[];
}

export interface RichTextVocab {
	elements: string[];
	attributes: string[];
	classes: string[];
	classPatterns: string[];
	buttonClasses: string[];
	dataAttributes: string[];
	svgElements: string[];
	svgAttributes: string[];
}

export interface CoreSchema {
	version: number;
	roots: string[];
	roles: Record<string, RoleSpec>;
	richText: RichTextVocab;
	types: Record<string, string | TypeSpec>;
	traits: Record<string, Record<string, FieldSpec>>;
	blocks: Record<string, BlockSpec>;
}

/**
 * Step map: keys are `base`, a breakpoint name or a min-width in px
 * ("1366"), e.g. {md: "750px", "1366": "1250px"}.
 */
export type Steps = Record<string, string>;

/**
 * Container token value.
 *   max      outer max width incl. gutter, e.g. "1280px" (fluid up to it)
 *   content  content width excl. gutter per step (stepped container);
 *            the box never exceeds 100% minus the gutters
 *   gutter   inline padding per step
 * A string is shorthand for {max}.
 */
export type ContainerValue =
	| string
	| { max?: string | Steps; content?: string | Steps; gutter?: string | Steps };

export interface Theme {
	tokens?: {
		Color?: Record<string, string>;
		ButtonVariant?: string[];
		ContainerSize?: Record<string, ContainerValue>;
		Breakpoint?: Record<string, number>;
	};
	types?: Record<string, string | TypeSpec>;
	/** Optional fields added to core object types, e.g. {Button: {"subtitle?": string}}. */
	extend?: Record<string, Record<string, FieldSpec>>;
	richText?: Partial<RichTextVocab>;
}

export interface Field {
	name: string;
	optional: boolean;
	expr: Expr;
	default?: unknown;
	doc?: string;
	/** Still accepted; lint warns where content sets it. */
	deprecated?: boolean;
}

/** Condition of a rule: the value at `path` is one of `values`. */
export interface Condition {
	path: string;
	values: unknown[];
	/** Schema default of the path, used when the value is unset. */
	default?: unknown;
}

/**
 * Declarative block rules, checked by the validator. Paths are dotted field
 * paths relative to the block; lists are traversed.
 *   oneOf           at least one of `fields` is set (on each object at `at`)
 *   only            `fields` may only be set when `when` holds
 *   childPlace      blocks in `slot` may use these Placement fields
 *   actionOptional  Button fields whose url / opens are not required
 *   ratioMax        "a:b" values at `field`: parts sum to at most `max`
 */
export type Rule =
	| {
			kind: "oneOf";
			fields: string[];
			at?: string;
			when?: Condition[];
			message?: string;
	  }
	| {
			kind: "only";
			fields: string[];
			at?: string;
			when: Condition[];
			message?: string;
	  }
	| { kind: "childPlace"; fields: string[]; slot: string; when?: Condition[] }
	| { kind: "actionOptional"; fields: string[] }
	| { kind: "ratioMax"; field: string; max: number };

export interface Block {
	name: string;
	kind: "core" | "project";
	doc?: string;
	/** Roles the block is a member of. */
	roles: string[];
	traits: string[];
	fields: Field[];
	rules: Rule[];
}

export interface Model {
	version: number;
	roots: string[];
	richText: RichTextVocab;
	types: Record<string, string | TypeSpec>;
	/** Roles, highest first; members are roles or blocks. */
	roles: Record<string, RoleSpec>;
	traits: Record<string, Field[]>;
	blocks: Record<string, Block>;
	tokens: Required<NonNullable<Theme["tokens"]>>;
}

export const BUILTINS: Record<string, string> = {
	string: "string",
	number: "number",
	integer: "integer",
	boolean: "boolean",
};

const BREAKPOINT = "Breakpoint";
const BASE_BREAKPOINT = "base";
const BUTTON = "Button";

/** Trait whose slots (before / after) hold Inline blocks on any block. */
export const SURROUND = "Surround";

/** Placement fields a parent block grants its slot items (rule childPlace). */
export const CHILD_PLACEMENT = ["colSpan", "rowSpan"];

/**
 * Free-text fields with these names would reintroduce styling escape hatches
 * (class names, inline CSS). Typed fields (e.g. style: LineStyle) are fine.
 */
const STYLE_FIELD =
	/^(class|classes|classname|classnames|style|styles|css|inlinestyle|sx|tw|tailwind)$/i;

function styleHatch(name: string, expr: Expr): boolean {
	return STYLE_FIELD.test(name) && exprNames(expr).includes("string");
}

// Token types a theme may set, and whether their values matter (map) or only names (list).
const TOKEN_TYPES = [
	"Color",
	"ButtonVariant",
	"ContainerSize",
	"Breakpoint",
] as const;

// Allowed keys per construct; catches typos and YAML flow-map comma splits.
const KEYS = {
	field: ["type", "default", "doc", "deprecated"],
	type: ["doc", "enum", "fields", "type", "pattern", "min", "max"],
	block: ["doc", "traits", "fields", "defaults"],
	projectBlock: [
		"doc",
		"in",
		"traits",
		"fields",
		"defaults",
		"types",
		"rules",
		"provenance",
	],
	provenance: ["registry", "item", "ref", "commit", "schema", "pending"],
	theme: ["tokens", "types", "extend", "richText"],
	richText: [
		"elements",
		"attributes",
		"classes",
		"classPatterns",
		"buttonClasses",
		"dataAttributes",
		"svgElements",
		"svgAttributes",
	],
	rule: {
		oneOf: ["oneOf", "at", "when", "message"],
		only: ["only", "at", "when", "message"],
		childPlace: ["childPlace", "slot", "when"],
		actionOptional: ["actionOptional"],
		ratioMax: ["ratioMax", "field"],
	},
} as const;

const RULE_KINDS = Object.keys(KEYS.rule) as Rule["kind"][];

// Theme keys of earlier versions, with where their content lives now.
const MOVED_THEME_KEYS: Record<string, string> = {
	blocks: "blocks are project files now: blocks/<Name>/block.yaml",
	defaults: "block defaults belong in the block's own block.yaml `defaults`",
};

export class SchemaError extends Error {
	constructor(readonly problems: string[]) {
		super(`schema errors:\n${problems.map((p) => `  ${p}`).join("\n")}`);
	}
}

/** Major versions shipped with this package. */
export const CORE_VERSIONS = [1];

/** Reads core/<major>.yaml. */
export function loadCore(version: number): CoreSchema {
	if (!CORE_VERSIONS.includes(version)) {
		throw new Error(
			`unknown core schema version ${version} (available: ${CORE_VERSIONS.join(", ")})`,
		);
	}
	const url = new URL(`../core/${version}.yaml`, import.meta.url);
	return YAML.parse(readFileSync(fileURLToPath(url), "utf8")) as CoreSchema;
}

/**
 * Core schema + theme + project blocks → model. Throws SchemaError listing
 * every problem, including block definitions that break the contract.
 */
export function buildModel(
	core: CoreSchema,
	theme: Theme = {},
	projectBlocks: Record<string, ProjectBlockSpec> = {},
): Model {
	const errors: string[] = [];
	const types: Record<string, string | TypeSpec> = { ...core.types };
	const richText = { ...core.richText };
	const roleOrder = Object.keys(core.roles);
	const roles: Record<string, RoleSpec> = Object.fromEntries(
		Object.entries(core.roles).map(([n, r]) => [
			n,
			{ ...r, members: [...r.members] },
		]),
	);
	const coreNames = new Set([
		...Object.keys(core.types),
		...roleOrder,
		...Object.keys(core.traits),
		...Object.keys(core.blocks),
		...Object.keys(BUILTINS),
	]);

	checkKeys(theme, KEYS.theme, "theme", errors, MOVED_THEME_KEYS);
	const typeOwner: Record<string, string> = {};
	const declareType = (
		name: string,
		spec: string | TypeSpec,
		owner: string,
	) => {
		if (coreNames.has(name)) {
			errors.push(`${owner}: type "${name}" clashes with a core name`);
			return;
		}
		const first = typeOwner[name];
		if (first && !sameValue(types[name], spec)) {
			errors.push(
				`${owner}: type "${name}" already declared differently by ${first}`,
			);
			return;
		}
		typeOwner[name] ??= owner;
		types[name] = spec;
	};
	for (const [name, spec] of Object.entries(theme.types ?? {})) {
		declareType(name, spec, "theme");
	}

	const tokens = applyTokens(types, theme, errors);
	extendTypes(types, core, theme.extend, errors);

	// Blocks: core first, then project blocks joining roles.
	const specs: Record<
		string,
		BlockSpec & { kind: Block["kind"]; roles: string[]; rules?: RuleSpec[] }
	> = {};
	for (const [name, b] of Object.entries(core.blocks)) {
		checkKeys(b, KEYS.block, name, errors);
		specs[name] = {
			...b,
			kind: "core",
			roles: roleOrder.filter((r) => core.roles[r]?.members.includes(name)),
		};
	}
	for (const [name, b] of Object.entries(projectBlocks)) {
		const where = `block ${name}`;
		if (!isPlain(b)) {
			errors.push(`${where}: block definition must be a map`);
			continue;
		}
		checkKeys(b, KEYS.projectBlock, where, errors);
		if (coreNames.has(name)) {
			errors.push(`${where}: clashes with a core name`);
			continue;
		}
		checkProvenance(b.provenance, core.version, where, errors);
		for (const [t, spec] of Object.entries(b.types ?? {})) {
			declareType(t, spec, where);
		}
		const { in: joined, types: _t, provenance: _p, ...spec } = b;
		const own = joinRoles(roles, roleOrder, name, joined, errors);
		specs[name] = { ...spec, kind: "project", roles: own };
	}
	for (const name of Object.keys(specs)) {
		if (types[name]) {
			errors.push(`block ${name}: clashes with type "${name}"`);
		}
	}

	checkKeys(theme.richText, KEYS.richText, "theme.richText", errors);
	for (const key of KEYS.richText) {
		richText[key] = [
			...(richText[key] ?? []),
			...(theme.richText?.[key] ?? []),
		];
	}

	for (const [name, spec] of Object.entries(types)) {
		if (typeof spec !== "string") {
			checkKeys(spec, KEYS.type, `type ${name}`, errors);
		}
	}

	const known = (n: string) =>
		Boolean(BUILTINS[n] || types[n] || specs[n] || roles[n]);
	const parse = (text: string, where: string) => {
		const expr = parseExpr(text, (m) => errors.push(`${where}: ${m}`));
		for (const n of exprNames(expr)) {
			if (!known(n)) {
				errors.push(`${where}: unknown type "${n}"`);
			}
		}
		return expr;
	};
	const fieldsOf = (
		fields: Record<string, FieldSpec> | undefined,
		owner: string,
	) => parseFields(fields, owner, parse, errors);

	const traits = Object.fromEntries(
		Object.entries(core.traits).map(([n, f]) => [n, fieldsOf(f, `trait ${n}`)]),
	);

	const blocks: Record<string, Block> = {};
	for (const [name, spec] of Object.entries(specs)) {
		blocks[name] = {
			name,
			kind: spec.kind,
			roles: spec.roles,
			traits: spec.traits ?? [],
			fields: blockFields(name, spec, traits, fieldsOf, types, errors),
			rules: [],
			...(spec.doc ? { doc: spec.doc } : {}),
		};
	}

	const model: Model = {
		version: core.version,
		roots: core.roots,
		richText,
		types,
		roles,
		traits,
		blocks,
		tokens,
	};

	// Type aliases and root names must resolve too.
	for (const [name, spec] of Object.entries(types)) {
		if (typeof spec === "string") {
			parse(spec, `type ${name}`);
		}
		if (typeof spec === "object" && spec.fields) {
			for (const f of fieldsOf(spec.fields, name)) {
				if (typeOwner[name] && styleHatch(f.name, f.expr)) {
					errors.push(
						`type ${name}.${f.name}: style escape hatches are not allowed (no class names, no inline CSS)`,
					);
				}
			}
		}
	}
	for (const r of core.roots) {
		if (!types[r]) {
			errors.push(`unknown root "${r}"`);
		}
	}

	// Contract checks of project block definitions (need the full model).
	const check = new DefinitionCheck(model, roleOrder, errors);
	for (const [name, spec] of Object.entries(specs)) {
		const block = blocks[name];
		if (!block) {
			continue;
		}
		block.rules = check.rules(block, spec.rules ?? []);
		if (spec.kind === "project") {
			check.block(block);
		}
	}
	check.cycles();

	if (errors.length) {
		throw new SchemaError([...new Set(errors)]);
	}
	return model;
}

/** Enum values of a type spec, e.g. Breakpoint → ["base", "sm", …]. */
export function enumValues(
	spec: string | TypeSpec | undefined,
): (string | number)[] {
	if (!spec || typeof spec === "string" || !spec.enum) {
		return [];
	}
	return Array.isArray(spec.enum) ? spec.enum : Object.keys(spec.enum);
}

/** Breakpoints in ascending order, e.g. ["base", "sm", "md"]. */
export function breakpoints(model: Pick<Model, "types">): string[] {
	return enumValues(model.types[BREAKPOINT]).map(String);
}

/** Block names a role stands for (member roles flattened), e.g. Content → [Stack, Text, …]. */
export function roleBlocks(
	model: Pick<Model, "roles">,
	role: string,
	seen = new Set<string>(),
): string[] {
	const spec = model.roles[role];
	if (!spec || seen.has(role)) {
		return [];
	}
	seen.add(role);
	return [
		...new Set(
			spec.members.flatMap((m) =>
				model.roles[m] ? roleBlocks(model, m, seen) : [m],
			),
		),
	];
}

/**
 * Default merge, per the schema: objects merge key by key,
 * Responsive maps and lists are replaced as a whole.
 */
export function mergeDefault(
	model: Pick<Model, "types">,
	expr: Expr,
	a: unknown,
	b: unknown,
	errors: string[] = [],
): unknown {
	if (!("name" in expr) || !isPlain(a) || !isPlain(b)) {
		return b === undefined ? a : b;
	}

	const fields = typeFields(model.types, expr.name, errors);
	const out: Record<string, unknown> = { ...a };
	for (const [k, v] of Object.entries(b)) {
		const f = fields.find((x) => x.name === k);
		out[k] = f ? mergeDefault(model, f.expr, a[k], v, errors) : v;
	}
	return out;
}

export { isPlain };

/** Fields of an object type (empty for other types). */
export function typeFields(
	types: Record<string, string | TypeSpec>,
	name: string,
	errors: string[] = [],
): Field[] {
	const spec = types[name];
	return typeof spec === "object" && spec.fields
		? parseFields(
				spec.fields,
				name,
				(t, w) => parseExpr(t, (m) => errors.push(`${w}: ${m}`)),
				errors,
			)
		: [];
}

// ----------------------------------------------------------------- definition checks

class DefinitionCheck {
	private readonly refs = new Map<string, string[]>();

	constructor(
		private readonly model: Model,
		private readonly roleOrder: string[],
		private readonly errors: string[],
	) {}

	/**
	 * Role nesting, direct block references and style escape hatches.
	 * Slots (fields whose type is or contains a role) accept only roles lower
	 * than every role of the block; Surround slots are the exception.
	 */
	block(b: Block) {
		const where = `block ${b.name}`;
		const own = Math.max(...b.roles.map((r) => this.rank(r)));
		const surround = new Set(
			(this.model.traits[SURROUND] ?? []).map((f) => f.name),
		);
		const refs: string[] = [];

		for (const f of b.fields) {
			if (styleHatch(f.name, f.expr)) {
				this.errors.push(
					`${where}.${f.name}: style escape hatches are not allowed (no class names, no inline CSS)`,
				);
			}
			if (b.traits.includes(SURROUND) && surround.has(f.name)) {
				continue;
			}
			const found = this.reach(f.expr, new Set());
			for (const role of found.roles) {
				if (this.rank(role) <= own) {
					this.errors.push(
						`${where}.${f.name}: slot accepts ${role}, which is not lower than the block's role (${b.roles.join(", ")}); nesting is fixed, write a dedicated block instead`,
					);
				}
			}
			for (const ref of found.blocks) {
				const target = this.model.blocks[ref];
				const top = Math.min(...(target?.roles ?? []).map((r) => this.rank(r)));
				if (top < Math.min(...b.roles.map((r) => this.rank(r)))) {
					this.errors.push(
						`${where}.${f.name}: block ${ref} has a higher role than ${b.name}`,
					);
				}
				refs.push(ref);
			}
		}
		this.refs.set(b.name, refs);
	}

	/** Direct block references must not form a cycle (no recursion). */
	cycles() {
		const state = new Map<string, "open" | "done">();
		const visit = (n: string, trail: string[]) => {
			if (state.get(n) === "done") {
				return;
			}
			if (state.get(n) === "open") {
				this.errors.push(
					`block ${n}: recursive block reference (${[...trail.slice(trail.indexOf(n)), n].join(" → ")})`,
				);
				return;
			}
			state.set(n, "open");
			for (const r of this.refs.get(n) ?? []) {
				visit(r, [...trail, n]);
			}
			state.set(n, "done");
		};
		for (const n of this.refs.keys()) {
			visit(n, []);
		}
	}

	/** Normalizes and checks declared rules against the block's fields. */
	rules(b: Block, specs: RuleSpec[]): Rule[] {
		const out: Rule[] = [];
		if (!Array.isArray(specs)) {
			this.errors.push(`block ${b.name}.rules: must be a list`);
			return out;
		}
		for (const [i, spec] of specs.entries()) {
			const where = `block ${b.name}.rules[${i}]`;
			const kind = isPlain(spec)
				? RULE_KINDS.find((k) => k in spec)
				: undefined;
			if (!isPlain(spec) || !kind) {
				this.errors.push(
					`${where}: unknown rule (one of ${RULE_KINDS.join(", ")})`,
				);
				continue;
			}
			checkKeys(spec, KEYS.rule[kind], where, this.errors);
			const rule = this.rule(b, kind, spec, where);
			if (rule) {
				out.push(rule);
			}
		}
		return out;
	}

	private rule(
		b: Block,
		kind: Rule["kind"],
		spec: RuleSpec,
		where: string,
	): Rule | undefined {
		const names = (v: unknown) =>
			Array.isArray(v) && v.length && v.every((x) => typeof x === "string")
				? (v as string[])
				: undefined;
		const list = names(spec[kind]);

		if (kind === "ratioMax") {
			const field = spec.field;
			if (typeof spec.ratioMax !== "number" || typeof field !== "string") {
				this.errors.push(`${where}: ratioMax needs a number and a field`);
				return undefined;
			}
			this.resolve(b.fields, field, where);
			return { kind, max: spec.ratioMax, field };
		}
		if (!list) {
			this.errors.push(`${where}: ${kind} needs a list of field names`);
			return undefined;
		}

		if (kind === "actionOptional") {
			for (const p of list) {
				const f = this.resolve(b.fields, p, where);
				if (f && !exprNames(f.expr).includes(BUTTON)) {
					this.errors.push(`${where}: ${p} is not a Button field`);
				}
			}
			return { kind, fields: list };
		}

		if (kind === "childPlace") {
			const slot = spec.slot;
			const bad = list.filter((x) => !CHILD_PLACEMENT.includes(x));
			if (bad.length) {
				this.errors.push(
					`${where}: childPlace allows ${CHILD_PLACEMENT.join(", ")} (got ${bad.join(", ")})`,
				);
			}
			if (typeof slot !== "string") {
				this.errors.push(`${where}: childPlace needs a slot field`);
				return undefined;
			}
			const f = this.resolve(b.fields, slot, where);
			if (f && !this.reach(f.expr, new Set()).roles.length) {
				this.errors.push(`${where}: ${slot} is not a slot (no role)`);
			}
			const when = this.conditions(b.fields, spec.when, where);
			return { kind, fields: list, slot, ...(when ? { when } : {}) };
		}

		// oneOf / only: fields relative to the objects at `at`.
		const at = spec.at;
		if (at !== undefined && typeof at !== "string") {
			this.errors.push(`${where}: at must be a field path`);
			return undefined;
		}
		const scope = at ? this.scope(b.fields, at, where) : b.fields;
		for (const p of list) {
			this.resolve(scope, p, where);
		}
		const when = this.conditions(scope, spec.when, where);
		const message =
			typeof spec.message === "string" ? { message: spec.message } : {};
		const base = { fields: list, ...(at ? { at } : {}), ...message };
		if (kind === "only") {
			if (!when) {
				this.errors.push(`${where}: only needs a when condition`);
				return undefined;
			}
			return { kind, ...base, when };
		}
		return { kind, ...base, ...(when ? { when } : {}) };
	}

	private conditions(
		scope: Field[],
		when: unknown,
		where: string,
	): Condition[] | undefined {
		if (when === undefined) {
			return undefined;
		}
		if (!isPlain(when)) {
			this.errors.push(`${where}: when must map field paths to values`);
			return undefined;
		}
		return Object.entries(when).map(([path, v]) => {
			this.resolve(scope, path, where);
			const dflt = this.defaultAt(scope, path.split("."));
			return {
				path,
				values: Array.isArray(v) ? v : [v],
				...(dflt === undefined ? {} : { default: dflt }),
			};
		});
	}

	/** Field at a dotted path; lists, Responsive and object types are traversed. */
	private resolve(
		scope: Field[],
		path: string,
		where: string,
	): Field | undefined {
		let fields = scope;
		let found: Field | undefined;
		for (const seg of path.split(".")) {
			found = fields.find((f) => f.name === seg);
			if (!found) {
				this.errors.push(`${where}: unknown field "${path}"`);
				return undefined;
			}
			fields = this.inner(found.expr);
		}
		return found;
	}

	/** Fields of the objects at a path (e.g. items → ListItem fields). */
	private scope(scope: Field[], path: string, where: string): Field[] {
		const f = this.resolve(scope, path, where);
		return f ? this.inner(f.expr) : [];
	}

	private inner(expr: Expr): Field[] {
		if ("list" in expr) {
			return this.inner(expr.list);
		}
		if ("generic" in expr) {
			return this.inner(expr.arg);
		}
		if ("union" in expr) {
			return [];
		}
		const block = this.model.blocks[expr.name];
		return block ? block.fields : typeFields(this.model.types, expr.name);
	}

	private defaultAt(scope: Field[], segs: string[]): unknown {
		const [head, ...rest] = segs;
		const f = scope.find((x) => x.name === head);
		if (!f) {
			return undefined;
		}
		if (!rest.length) {
			return f.default;
		}
		const fromParent = rest.reduce<unknown>(
			(v, k) => (isPlain(v) ? v[k] : undefined),
			f.default,
		);
		return fromParent !== undefined
			? fromParent
			: this.defaultAt(this.inner(f.expr), rest);
	}

	/** Roles and blocks an expression reaches, through object types (not blocks). */
	private reach(
		expr: Expr,
		seen: Set<string>,
	): { roles: string[]; blocks: string[] } {
		const out = { roles: [] as string[], blocks: [] as string[] };
		for (const n of exprNames(expr)) {
			if (this.model.roles[n]) {
				out.roles.push(n);
				continue;
			}
			if (this.model.blocks[n]) {
				out.blocks.push(n);
				continue;
			}
			if (seen.has(n)) {
				continue;
			}
			seen.add(n);
			const spec = this.model.types[n];
			const sub =
				typeof spec === "string"
					? [parseExpr(spec, () => {})]
					: typeFields(this.model.types, n).map((f) => f.expr);
			for (const e of sub) {
				const r = this.reach(e, seen);
				out.roles.push(...r.roles);
				out.blocks.push(...r.blocks);
			}
		}
		return out;
	}

	private rank(role: string): number {
		return this.roleOrder.indexOf(role);
	}
}

// ----------------------------------------------------------------- internals

function applyTokens(
	types: Record<string, string | TypeSpec>,
	theme: Theme,
	errors: string[],
): Model["tokens"] {
	const given = theme.tokens ?? {};
	checkKeys(given, TOKEN_TYPES, "theme.tokens", errors);

	const tokens: Model["tokens"] = {
		Color: given.Color ?? {},
		ButtonVariant:
			given.ButtonVariant ?? enumValues(types.ButtonVariant).map(String),
		ContainerSize: given.ContainerSize ?? {},
		Breakpoint: given.Breakpoint ?? {},
	};

	const set = (
		name: string,
		values: (string | number)[] | Record<string, unknown>,
	) => {
		const spec = types[name];
		if (typeof spec !== "object" || !spec.enum) {
			errors.push(`theme: token "${name}" is not an enum type`);
			return;
		}
		types[name] = { ...spec, enum: values };
	};

	if (given.Color) {
		set("Color", Object.keys(given.Color));
	}
	if (given.ButtonVariant) {
		set("ButtonVariant", given.ButtonVariant);
	}
	if (given.ContainerSize) {
		set("ContainerSize", Object.keys(given.ContainerSize));
	}
	if (given.Breakpoint) {
		// `base` (0) is implicit and always first.
		const sorted = Object.entries(given.Breakpoint)
			.filter(([k]) => k !== BASE_BREAKPOINT)
			.sort((a, b) => a[1] - b[1]);
		set(BREAKPOINT, Object.fromEntries([[BASE_BREAKPOINT, 0], ...sorted]));
	}
	return tokens;
}

/** theme.extend: optional fields added to core object types; nothing changed or removed. */
function extendTypes(
	types: Record<string, string | TypeSpec>,
	core: CoreSchema,
	extend: Theme["extend"],
	errors: string[],
) {
	for (const [name, fields] of Object.entries(extend ?? {})) {
		const where = `theme.extend.${name}`;
		const spec = core.types[name];
		if (typeof spec !== "object" || !spec.fields) {
			errors.push(`${where}: only core object types can be extended`);
			continue;
		}
		const have = new Set(Object.keys(spec.fields).map(fieldName));
		const added: Record<string, FieldSpec> = {};
		for (const [key, f] of Object.entries(fields ?? {})) {
			if (!key.endsWith("?")) {
				errors.push(`${where}.${key}: added fields must be optional (${key}?)`);
				continue;
			}
			if (have.has(fieldName(key))) {
				errors.push(
					`${where}.${key}: core fields cannot be changed or removed`,
				);
				continue;
			}
			const type = typeof f === "string" ? f : f?.type;
			if (
				styleHatch(
					fieldName(key),
					parseExpr(String(type), () => {}),
				)
			) {
				errors.push(
					`${where}.${key}: style escape hatches are not allowed (no class names, no inline CSS)`,
				);
				continue;
			}
			added[key] = f;
		}
		const current = types[name] as TypeSpec;
		types[name] = { ...current, fields: { ...current.fields, ...added } };
	}
}

function fieldName(key: string): string {
	return key.replace(/\?$/, "");
}

function joinRoles(
	roles: Record<string, RoleSpec>,
	order: string[],
	name: string,
	joined: string[] | undefined,
	errors: string[],
): string[] {
	if (!Array.isArray(joined) || !joined.length) {
		errors.push(
			`block ${name}: "in" must list its roles (${order.join(", ")})`,
		);
		return [];
	}
	const out: string[] = [];
	for (const r of joined) {
		const role = roles[r];
		if (!role) {
			errors.push(
				`block ${name}: unknown role "${r}" (one of ${order.join(", ")})`,
			);
			continue;
		}
		role.members.push(name);
		out.push(r);
	}
	return out;
}

function checkProvenance(
	p: Provenance | undefined,
	version: number,
	where: string,
	errors: string[],
) {
	if (p === undefined) {
		return;
	}
	if (!isPlain(p)) {
		errors.push(`${where}.provenance: must be a map`);
		return;
	}
	checkKeys(p, KEYS.provenance, `${where}.provenance`, errors);
	for (const key of ["registry", "item", "ref", "commit"] as const) {
		if (typeof p[key] !== "string" || !p[key]) {
			errors.push(`${where}.provenance.${key}: non-empty string required`);
		}
	}
	const pending = p.pending as unknown;
	if (
		pending !== undefined &&
		(!isPlain(pending) ||
			typeof pending.ref !== "string" ||
			typeof pending.commit !== "string")
	) {
		errors.push(`${where}.provenance.pending: ref and commit required`);
	}
	if (p.schema !== version) {
		errors.push(
			`${where}: pins contract major ${String(p.schema)}, the project uses ${version} (install a matching version)`,
		);
	}
}

function blockFields(
	name: string,
	spec: BlockSpec,
	traits: Record<string, Field[]>,
	fieldsOf: (
		f: Record<string, FieldSpec> | undefined,
		owner: string,
	) => Field[],
	types: Record<string, string | TypeSpec>,
	errors: string[],
): Field[] {
	const fields: Field[] = [];
	for (const t of spec.traits ?? []) {
		const tf = traits[t];
		if (!tf) {
			errors.push(`${name}: unknown trait "${t}"`);
			continue;
		}
		fields.push(...tf.map((f) => ({ ...f })));
	}
	fields.push(...fieldsOf(spec.fields, name));

	const seen = new Set<string>();
	for (const f of fields) {
		if (seen.has(f.name)) {
			errors.push(`${name}: duplicate field "${f.name}"`);
		}
		seen.add(f.name);
	}

	// Block defaults override / merge field defaults, e.g. Card.background.color.
	for (const [key, value] of Object.entries(spec.defaults ?? {})) {
		const f = fields.find((x) => x.name === key);
		if (!f) {
			errors.push(`${name}.defaults: unknown field "${key}"`);
			continue;
		}
		f.default = mergeDefault({ types }, f.expr, f.default, value, errors);
	}
	return fields;
}

function parseFields(
	fields: Record<string, FieldSpec> | undefined,
	owner: string,
	parse: (text: string, where: string) => Expr,
	errors: string[],
): Field[] {
	return Object.entries(fields ?? {}).map(([key, spec]) => {
		const optional = key.endsWith("?");
		const long = typeof spec === "object" && spec !== null;
		if (long) {
			checkKeys(spec, KEYS.field, `${owner}.${key}`, errors);
		}
		const typeSrc = long ? spec.type : spec;
		if (typeof typeSrc !== "string") {
			errors.push(`${owner}.${key}: missing type`);
		}
		const field: Field = {
			name: optional ? key.slice(0, -1) : key,
			optional,
			expr: parse(String(typeSrc), `${owner}.${key}`),
		};
		if (long && spec.default !== undefined) {
			field.default = spec.default;
		}
		if (long && spec.doc) {
			field.doc = spec.doc;
		}
		if (long && spec.deprecated !== undefined) {
			if (typeof spec.deprecated !== "boolean") {
				errors.push(`${owner}.${key}: deprecated must be true or false`);
			} else if (spec.deprecated && !optional) {
				errors.push(
					`${owner}.${key}: a deprecated field must be optional (${key}?)`,
				);
			} else if (spec.deprecated) {
				field.deprecated = true;
			}
		}
		return field;
	});
}

function checkKeys(
	obj: object | undefined,
	allowed: readonly string[],
	where: string,
	errors: string[],
	hints: Record<string, string> = {},
) {
	for (const k of Object.keys(obj ?? {})) {
		if (!allowed.includes(k)) {
			const hint = hints[k];
			errors.push(`${where}: unknown key "${k}"${hint ? ` (${hint})` : ""}`);
		}
	}
}

function sameValue(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
