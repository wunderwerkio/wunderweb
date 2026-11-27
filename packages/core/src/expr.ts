// Type expressions of the schema notation, e.g. "Text | Media",
// "Content[]", "Responsive<Sides>".

export type Expr =
	| { name: string }
	| { list: Expr }
	| { union: Expr[] }
	| { generic: string; arg: Expr };

export const RESPONSIVE = "Responsive";

const TOKEN = /[A-Za-z_][\w]*|\[\]|[|<>()]/g;

/** Parses a type expression; reports syntax problems through `error`. */
export function parseExpr(text: string, error: (msg: string) => void): Expr {
	const tokens = text.match(TOKEN) ?? [];
	let i = 0;
	const peek = () => tokens[i];
	const next = () => tokens[i++] ?? "";

	const union = (): Expr => {
		const parts = [postfix()];
		while (peek() === "|") {
			next();
			parts.push(postfix());
		}
		return parts.length === 1 ? (parts[0] as Expr) : { union: parts };
	};

	const postfix = (): Expr => {
		let node = primary();
		while (peek() === "[]") {
			next();
			node = { list: node };
		}
		return node;
	};

	const primary = (): Expr => {
		const tok = next();
		if (tok === "(") {
			const inner = union();
			next();
			return inner;
		}
		if (peek() !== "<") {
			return { name: tok };
		}

		next();
		const arg = union();
		next();
		if (tok !== RESPONSIVE) {
			error(`unknown generic "${tok}"`);
		}
		return { generic: tok, arg };
	};

	const ast = union();
	if (i !== tokens.length) {
		error(`cannot parse "${text}"`);
	}
	return ast;
}

/** Names referenced by an expression, e.g. ["Leaf"] for "Leaf[]". */
export function exprNames(expr: Expr): string[] {
	if ("list" in expr) {
		return exprNames(expr.list);
	}
	if ("generic" in expr) {
		return exprNames(expr.arg);
	}
	if ("union" in expr) {
		return expr.union.flatMap(exprNames);
	}
	return [expr.name];
}
