/** A plain object (not null, not a list). */
export function isPlain(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}
