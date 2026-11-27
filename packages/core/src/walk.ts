// Schema-guided traversal of a document: visits every block and every
// string value with the name of its schema type (RichText, Svg, Url, Ref …).
// Shared by the validator, the default merger and URL resolution.

import { isPlain } from "./plain.js";

export type JsonSchema = Record<string, unknown>;
export type Json = unknown;
export type BlockJson = { type: string; [k: string]: unknown };

export interface Parent {
	block: BlockJson | Record<string, unknown>;
	field: string;
}

export interface Visitor {
	/** A block; `parent` is the enclosing block (or document) and its field. */
	block?(b: BlockJson, path: string, parent: Parent): void;
	/** A string typed by a named schema type; `holder[key]` is the value. */
	string?(s: TypedString): void;
	/** A value object of a named type, e.g. "Button", "Icon", "Asset"; `key` is its field. */
	value?(
		type: string,
		value: Record<string, unknown>,
		path: string,
		key: string,
		block: BlockJson | undefined,
	): void;
	/** A block whose type is not allowed at this position (e.g. after slot substitution). */
	misplaced?(b: BlockJson, path: string, allowed: string[]): void;
	/** Return false to skip a field, e.g. Include.with. */
	enter?(b: BlockJson, field: string): boolean;
}

/** A string value with its schema type, e.g. {type: "Url", owner: "Asset", key: "url"}. */
export interface TypedString {
	type: string;
	value: string;
	path: string;
	holder: Record<string, unknown>;
	key: string;
	/** Named type of the object holding the value, e.g. "Asset", "Button" or a block name. */
	owner: string | undefined;
	block: BlockJson | undefined;
}

export class Walker {
	readonly defs: Record<string, JsonSchema>;

	constructor(readonly schema: JsonSchema) {
		this.defs = schema.$defs as Record<string, JsonSchema>;
	}

	/** Walks `value` typed by $defs[root], e.g. walk(page, "Page", …). */
	walk(value: Json, root: string, v: Visitor, path = ""): void {
		const doc = value as Record<string, unknown>;
		this.node(
			{ $ref: `#/$defs/${root}` },
			value,
			path,
			v,
			{ block: doc, field: "" },
			undefined,
			undefined,
			"",
		);
	}

	/** Walks a list of blocks typed by a union name, e.g. "PageBlock". */
	walkBlocks(
		list: Json[],
		union: string,
		v: Visitor,
		path: string,
		parent: Parent,
	): void {
		const ref = { $ref: `#/$defs/${union}` };
		for (const [i, b] of list.entries()) {
			this.node(ref, b, `${path}/${i}`, v, parent, undefined, undefined, "");
		}
	}

	isBlockDef(name: string | undefined): boolean {
		return Boolean(name && this.defs[name]?.["x-kind"]);
	}

	/** Resolves $ref chains; returns the def and the last named type. */
	resolve(
		s: JsonSchema,
		name?: string,
	): { def: JsonSchema; name: string | undefined } {
		let def = s;
		let n = name;
		while (typeof def.$ref === "string") {
			n = def.$ref.split("/").pop();
			def = this.defs[n ?? ""] ?? {};
		}
		return { def, name: n };
	}

	private node(
		s: JsonSchema,
		value: Json,
		path: string,
		v: Visitor,
		parent: Parent,
		block: BlockJson | undefined,
		typeName: string | undefined,
		key: string,
		holder?: Record<string, unknown>,
		owner?: string,
	): void {
		const { def, name } = this.resolve(s, typeName);

		if (typeof value === "string") {
			if (name && holder) {
				v.string?.({ type: name, value, path, holder, key, owner, block });
			}
			return;
		}
		if (Array.isArray(value)) {
			const items = (def.items ?? {}) as JsonSchema;
			const holder = value as unknown as Record<string, unknown>;
			for (const [i, item] of value.entries()) {
				this.node(
					items,
					item,
					`${path}/${i}`,
					v,
					parent,
					block,
					undefined,
					String(i),
					holder,
					owner,
				);
			}
			return;
		}
		if (!isPlain(value)) {
			return;
		}

		// Block union (a role may have no members) or direct block ref.
		const union = Boolean(def.oneOf) || def["x-role"] !== undefined;
		const blockName = union
			? (value.type as string)
			: def["x-kind"]
				? name
				: undefined;
		if (blockName) {
			const bdef = this.defs[blockName];
			if (!bdef?.["x-kind"]) {
				return;
			}
			const b = value as BlockJson;
			const allowed = union
				? ((def.oneOf ?? []) as JsonSchema[]).map(
						(m) => String(m.$ref).split("/").pop() ?? "",
					)
				: undefined;
			if (allowed && !allowed.includes(blockName)) {
				v.misplaced?.(b, path, allowed);
			}
			v.block?.(b, path, parent);
			this.fields(bdef, b, path, v, b, undefined, blockName);
			return;
		}

		if (def["x-responsive"]) {
			for (const [bp, item] of Object.entries(value)) {
				const bs = ((def.properties as Record<string, JsonSchema>)[bp] ??
					{}) as JsonSchema;
				this.node(
					bs,
					item,
					`${path}/${bp}`,
					v,
					parent,
					block,
					undefined,
					bp,
					value,
					owner,
				);
			}
			return;
		}
		if (def.anyOf) {
			return;
		}
		if (name) {
			v.value?.(name, value, path, key, block);
		}
		this.fields(def, value, path, v, block, parent, name);
	}

	private fields(
		def: JsonSchema,
		value: Record<string, unknown>,
		path: string,
		v: Visitor,
		block: BlockJson | undefined,
		parent: Parent | undefined,
		owner: string | undefined,
	): void {
		const props = (def.properties ?? {}) as Record<string, JsonSchema>;
		const isBlock = Boolean(def["x-kind"]);
		for (const [k, item] of Object.entries(value)) {
			const ps = props[k];
			if (!ps || k === "type") {
				continue;
			}
			if (isBlock && v.enter && !v.enter(value as BlockJson, k)) {
				continue;
			}
			const p = isBlock
				? { block: value, field: k }
				: (parent ?? { block: value, field: k });
			this.node(
				ps,
				item,
				path ? `${path}/${k}` : k,
				v,
				p,
				block,
				undefined,
				k,
				value,
				owner,
			);
		}
	}
}
