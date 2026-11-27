// Applies schema defaults to a document, so renderers get complete values.
//
// Merge rule (same as the schema): objects merge key by key, Responsive
// maps and lists replace. E.g. Card default layout {padding, gap} +
// content layout {container} → {padding, gap, container}.

import { splitPath } from "./edit.js";
import { isPlain } from "./plain.js";
import { type JsonSchema, Walker } from "./walk.js";

/** Returns a copy of `value` (typed by $defs[root]) with all defaults filled in. */
export function withDefaults<T>(walker: Walker, value: T, root: string): T {
	return fill(walker, { $ref: `#/$defs/${root}` }, value) as T;
}

const walkers = new WeakMap<JsonSchema, Walker>();

/**
 * What a block renders at `path` (authored path inside the block, e.g.
 * "layout/padding/md") when the value is unset: the block default merged
 * with the type defaults, by the same rule as withDefaults. Parents along
 * the path count as set (Background.position applies once a background
 * is). Undefined without a default, and below slots (the child's type is
 * unknown from the path).
 */
export function effectiveDefault(
	schema: JsonSchema,
	blockType: string,
	path: string,
): unknown {
	let walker = walkers.get(schema);
	if (!walker) {
		walker = new Walker(schema);
		walkers.set(schema, walker);
	}
	let s: JsonSchema = { $ref: `#/$defs/${blockType}` };
	if (!walker.defs[blockType]) {
		return undefined;
	}
	let value: unknown = fill(walker, s, { type: blockType });
	for (const seg of splitPath(path)) {
		const { def } = walker.resolve(s);
		if (def.oneOf || def.anyOf) {
			return undefined;
		}
		const next = (
			def.items
				? def.items
				: (def.properties as Record<string, JsonSchema> | undefined)?.[seg]
		) as JsonSchema | undefined;
		if (!next) {
			return undefined;
		}
		const own =
			isPlain(value) || Array.isArray(value)
				? (value as Record<string, unknown>)[seg]
				: undefined;
		value = own === undefined ? fieldDefault(walker, next) : own;
		s = next;
	}
	return isPlain(value) && !Object.keys(value).length ? undefined : value;
}

/** Value of an unset field: its default with the nested type defaults filled in. */
function fieldDefault(walker: Walker, s: JsonSchema): unknown {
	const { def } = walker.resolve(s);
	const plainObject =
		def.properties && !def["x-responsive"] && !def.oneOf && !def["x-kind"];
	const start =
		merge(walker, s, s.default, undefined) ?? (plainObject ? {} : undefined);
	return start === undefined ? undefined : fill(walker, s, start);
}

function fill(walker: Walker, s: JsonSchema, value: unknown): unknown {
	const { def } = walker.resolve(s);

	if (Array.isArray(value)) {
		const items = (def.items ?? {}) as JsonSchema;
		return value.map((v) => fill(walker, items, v));
	}
	if (!isPlain(value)) {
		return value;
	}

	// Block union: pick the member by `type`.
	if (def.oneOf) {
		const member = walker.defs[String(value.type)];
		return member ? fill(walker, member, value) : value;
	}
	if (def["x-responsive"]) {
		const props = (def.properties ?? {}) as Record<string, JsonSchema>;
		return Object.fromEntries(
			Object.entries(value).map(([bp, v]) => [
				bp,
				fill(walker, props[bp] ?? {}, v),
			]),
		);
	}
	if (def.anyOf) {
		return value;
	}

	const props = (def.properties ?? {}) as Record<string, JsonSchema>;
	const out: Record<string, unknown> = {};
	for (const [k, ps] of Object.entries(props)) {
		const merged = merge(walker, ps, ps.default, value[k]);
		if (merged !== undefined) {
			out[k] = fill(walker, ps, merged);
		}
	}
	// Keep unknown keys (the validator reports them); `type` is not a property default.
	for (const [k, v] of Object.entries(value)) {
		if (!(k in out)) {
			out[k] = v;
		}
	}
	return out;
}

function merge(
	walker: Walker,
	s: JsonSchema,
	dflt: unknown,
	value: unknown,
): unknown {
	if (value === undefined) {
		return structuredClone(dflt);
	}
	const { def } = walker.resolve(s);
	if (!isPlain(dflt) || !isPlain(value) || def["x-responsive"] || def.oneOf) {
		return value;
	}

	const props = (def.properties ?? {}) as Record<string, JsonSchema>;
	const out: Record<string, unknown> = { ...structuredClone(dflt) };
	for (const [k, v] of Object.entries(value)) {
		out[k] = merge(walker, props[k] ?? {}, out[k], v);
	}
	return out;
}
