// Schema values → Tailwind v4 classes. Shared by the runtime (emit) and the
// CLI (safelist), so every class the runtime can emit is generated from the
// same functions and is guaranteed to exist in the compiled CSS.
//
//   Responsive {base: 4, md: 8} + (v) => `pt-${v}`  →  "pt-4 md:pt-8"
//
// Unbounded values (px widths, split ratios) use a CSS variable class per
// breakpoint, e.g. "md:max-w-(--wc-mw-md)" + style {"--wc-mw-md": "320px"}.

export const BASE = "base";

export type Resp<T> = { [bp: string]: T | undefined };

// No imports: usable from any runtime (server components, browsers).

// Tailwind v4 renamed the smallest steps (v3 `shadow-sm` = v4 `shadow-xs`);
// schema tokens follow the v3 names, e.g. Radius sm = 2px.
export const RADIUS: Record<string, string> = {
	none: "rounded-none",
	sm: "rounded-xs",
	md: "rounded-md",
	lg: "rounded-lg",
	xl: "rounded-xl",
	"2xl": "rounded-2xl",
	"3xl": "rounded-3xl",
	full: "rounded-full",
};
export const SHADOW: Record<string, string> = {
	none: "shadow-none",
	sm: "shadow-xs",
	md: "shadow-md",
	lg: "shadow-lg",
	xl: "shadow-xl",
	"2xl": "shadow-2xl",
};
export const ALIGN_ITEMS: Record<string, string> = {
	start: "items-start",
	center: "items-center",
	end: "items-end",
	stretch: "items-stretch",
};
export const JUSTIFY: Record<string, string> = {
	start: "justify-start",
	center: "justify-center",
	end: "justify-end",
	between: "justify-between",
};
export const SELF: Record<string, string> = {
	start: "self-start",
	center: "self-center",
	end: "self-end",
	stretch: "self-stretch",
};
export const TEXT_ALIGN: Record<string, string> = {
	start: "text-start",
	center: "text-center",
	end: "text-end",
	justify: "text-justify",
};
export const PLACE_X: Record<string, string[]> = {
	start: ["mr-auto", "ml-0"],
	center: ["mx-auto"],
	end: ["ml-auto", "mr-0"],
	stretch: ["w-full"],
};
const NAMED_HEIGHT: Record<string, string> = {
	"25vh": "min-h-[25vh]",
	"50vh": "min-h-[50vh]",
	"75vh": "min-h-[75vh]",
	"100vh": "min-h-svh",
};
const SIDES = { top: "t", right: "r", bottom: "b", left: "l" } as const;
export const LINE: Record<string, string> = {
	solid: "border-solid",
	dashed: "border-dashed",
	dotted: "border-dotted",
};
export const MAX_SPAN = 24;

/** Collects classes and inline CSS variables for one element. */
export class Classes {
	readonly list: string[] = [];
	readonly style: Record<string, string> = {};

	constructor(private readonly bps: string[]) {}

	add(...cls: (string | false | undefined | null)[]): this {
		for (const c of cls) {
			if (c) {
				this.list.push(c);
			}
		}
		return this;
	}

	/** Mobile-first responsive classes: `fn(value)` prefixed with the breakpoint. */
	resp<T>(
		values: { [bp: string]: T | undefined } | undefined,
		fn: (v: T, bp: string) => string | undefined | (string | undefined)[],
	): this {
		for (const bp of this.bps) {
			const v = values?.[bp];
			if (v === undefined) {
				continue;
			}
			const out = fn(v, bp);
			for (const c of Array.isArray(out) ? out : [out]) {
				if (c) {
					this.list.push(at(bp, c));
				}
			}
		}
		return this;
	}

	/** Sets a CSS variable used by a var-class, e.g. --wc-mw-md. */
	var(name: string, value: string): this {
		this.style[name] = value;
		return this;
	}

	get className(): string {
		return [...new Set(this.list)].join(" ");
	}
}

/** Breakpoint prefix: base → "pt-4", md → "md:pt-4". Negative values keep Tailwind's "-mt-4" form. */
export function at(bp: string, cls: string): string {
	return bp === BASE ? cls : `${bp}:${cls}`;
}

// ----------------------------------------------------------------- value → class

export const tw = {
	padding: (side: keyof typeof SIDES, v: number) => `p${SIDES[side]}-${v}`,
	margin: (side: keyof typeof SIDES, v: number) =>
		v < 0 ? `-m${SIDES[side]}-${-v}` : `m${SIDES[side]}-${v}`,
	gap: (v: number) => `gap-${v}`,
	gapX: (v: number) => `gap-x-${v}`,
	childMb: (v: number) => `*:mb-${v}`,
	alignItems: (v: string) => ALIGN_ITEMS[v],
	justify: (v: string) => JUSTIFY[v],
	self: (v: string) => SELF[v],
	textAlign: (v: string) => TEXT_ALIGN[v],
	placeX: (v: string) => PLACE_X[v],
	visible: (v: boolean, shown = "flex") => (v ? shown : "hidden"),
	cols: (n: number) => `grid-cols-${n}`,
	colsVar: (bp: string) => `grid-cols-(--wc-cols-${bp})`,
	colSpan: (n: number) => `col-span-${n}`,
	rowSpan: (n: number) => `row-span-${n}`,
	columns: (n: number) => `columns-${n}`,
	order: (n: 1 | 2 | "none") => `order-${n}`,
	maxWidth: (v: string | number, bp: string) =>
		typeof v === "number" ? `max-w-(--wc-mw-${bp})` : `max-w-${v}`,
	minHeight: (v: string | number, bp: string) =>
		typeof v === "number" ? `min-h-(--wc-mh-${bp})` : NAMED_HEIGHT[v],
	direction: (v: string) => (v === "column" ? "flex-col" : "flex-row"),
	fullWidth: (v: boolean) => (v ? "w-full" : "w-auto"),
	bg: (color: string) => `bg-${color}`,
	text: (color: string) => `text-${color}`,
	borderColor: (color: string) => `border-${color}`,
	borderWidth: (w: number) => (w === 1 ? "border" : `border-${w}`),
	borderStyle: (s: string) => LINE[s],
	rounded: (r: string) => RADIUS[r],
	shadow: (s: string) => SHADOW[s],
};
