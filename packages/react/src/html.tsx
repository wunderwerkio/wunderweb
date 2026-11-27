// Rich text and SVG. Content is validated against a closed vocabulary before
// it reaches the renderer (no scripts, handlers, styles or javascript: urls),
// so the markup is inserted as is.

import type { CSSProperties } from "react";

export const RICH = "wc-rich";

export function RichText({
	html,
	className,
}: {
	html: string | undefined;
	className?: string;
}) {
	if (!html) {
		return null;
	}
	return (
		<div
			className={`${RICH} ${className ?? ""}`}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: validated closed vocabulary (see header)
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}

export function Svg({
	svg,
	className,
	style,
}: {
	svg: string | undefined;
	className?: string;
	style?: CSSProperties;
}) {
	if (!svg) {
		return null;
	}
	return (
		<span
			className={className}
			style={style}
			aria-hidden="true"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: validated shapes-only SVG (see header)
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	);
}
