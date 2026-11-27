// Consent in the runtime: gates for third-party content and the client
// script. Shared by the adapters; the banner and settings dialog are the
// adapter's (rendered with the page's texts, `page.consent`).
//
//   <ConsentGate ctx={ctx} category="media" vendor="Google Kalender"
//     fallback={url}><iframe … /></ConsentGate>
//
// A gate holds its content in a <template> (nothing loads), names the
// vendor, links the original (works without JavaScript) and offers "load
// once" and "always allow". The client script swaps in the content once
// the category is granted. Without a consent config gates render their
// content directly.
//
//   <script>{consentHeadScript(page.consent)}</script>   first in <head>
//   <script>{consentScript}</script>                      after banner and dialog
//
// Both are minified from consent-script.js (the readable source) into
// consent-script.min.ts by scripts/consent-script.mjs (build, typecheck
// checks it is current).

import {
	clientConsent,
	type GateData,
	gateOf,
	type PageConsent,
} from "@wunderweb/core/consent";
import type { ReactNode } from "react";

import { consentHeadSource, mountConsentSource } from "./consent-script.min.js";
import type { RenderContext } from "./registry.js";

/** The stored choice: category id → granted. */
export type ConsentChoice = Record<string, boolean>;

/** window.wcConsent, set by the consent script. */
export interface ConsentApi {
	/** The stored choice, null while the visitor has not decided. */
	get(): ConsentChoice | null;
	/** Stores the full choice (missing categories: refused) and applies it. */
	set(choice: ConsentChoice): void;
	/** Grants one category, merged into the stored choice. */
	grant(category: string): void;
	/** Opens the settings dialog with the stored choice. */
	open(): void;
	/** Called on every change; returns the unsubscribe function. */
	onChange(
		fn: (choice: ConsentChoice, previous: ConsentChoice | null) => void,
	): () => void;
}

/** Detail of the `wc-consent` event on document. */
export interface ConsentEventDetail {
	choice: ConsentChoice;
	previous: ConsentChoice | null;
}

/** DOM event fired on document on every consent change. */
export const CONSENT_EVENT = "wc-consent";

/** Labels of a gate; `{vendor}` is filled in. */
export type GateLabels = Partial<GateData["text"]>;

/** The gate's markup (see the header). */
export function Gate({
	gate,
	fallback,
	className,
	children,
}: {
	/** Vendor, texts and the (site-owned) poster. */
	gate: GateData;
	/** The original, opened in a new tab (no JavaScript, or instead of loading). */
	fallback: string;
	className?: string | undefined;
	children: ReactNode;
}) {
	const image = gate.poster;
	const t = gate.text;
	return (
		<div
			className={`wc-consent-gate ${className ?? ""}`}
			data-wc-consent-gate={gate.category}
			data-vendor={gate.vendor}
			style={{
				background: `var(--color-${gate.style.surface})`,
				color: `var(--color-${gate.style.text})`,
			}}
		>
			<template data-wc-consent-content="">{children}</template>
			<div className="relative flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden p-6 text-center">
				{image && (
					<img
						src={image}
						alt=""
						loading="lazy"
						className="absolute inset-0 h-full w-full object-cover opacity-25"
					/>
				)}
				<p className="relative m-0 max-w-prose text-sm">
					{t.notice}
					{gate.privacy && (
						<>
							{" "}
							<a href={gate.privacy} className="underline">
								{t.privacy}
							</a>
						</>
					)}
				</p>
				<div
					className="relative flex flex-wrap items-center justify-center gap-2"
					data-wc-consent-actions=""
					hidden
				>
					<button
						type="button"
						className="wc-button inline-flex items-center justify-center gap-2"
						data-variant={gate.style.choice}
						data-size="sm"
						data-wc-consent-load=""
					>
						<span className="wc-button-label">{t.loadOnce}</span>
					</button>
					<button
						type="button"
						className="wc-button inline-flex items-center justify-center gap-2"
						data-variant={gate.style.quiet}
						data-size="sm"
						data-wc-consent-allow=""
					>
						<span className="wc-button-label">{t.allow}</span>
					</button>
				</div>
				<a
					href={fallback}
					target="_blank"
					rel="noopener noreferrer"
					className="relative text-sm underline"
				>
					{t.open}
				</a>
			</div>
		</div>
	);
}

/**
 * Third-party content behind consent, for project blocks (e.g. an iframe
 * Embed). Without a consent config the content renders directly.
 */
export function ConsentGate({
	ctx,
	category,
	vendor,
	fallback,
	labels,
	poster,
	className,
	children,
}: {
	ctx: Pick<RenderContext, "consent">;
	/** Consent category the content needs, e.g. "media". */
	category: string;
	/** Who receives data when it loads, e.g. "Google Kalender". */
	vendor: string;
	/** Link to the original, opened in a new tab. */
	fallback: string;
	labels?: GateLabels;
	/**
	 * Preview image, shown before consent: only a root-relative url (the
	 * site itself); others are ignored, so no vendor sees the visit.
	 */
	poster?: string | undefined;
	/** Classes of the gate's box (size it like the content). */
	className?: string | undefined;
	/** What loads after consent. */
	children: ReactNode;
}) {
	if (!ctx.consent) {
		return <>{children}</>;
	}
	const gate = gateOf(ctx.consent, category, vendor, labels);
	if (poster && /^\/(?!\/)/.test(poster)) {
		gate.poster = poster;
	}
	return (
		<Gate gate={gate} fallback={fallback} className={className}>
			{children}
		</Gate>
	);
}

/** JSON for an inline script: `<` escaped so content cannot close it. */
function scriptJson(value: unknown): string {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Head part of the consent script for a page: first in <head>, before any
 * other script. `extraHosts` extend the hosts where tags load (tests:
 * localhost; never production).
 */
export function consentHeadScript(
	consent: PageConsent,
	extraHosts: string[] = [],
): string {
	return `(${consentHeadSource})(${scriptJson(clientConsent(consent, extraHosts))})`;
}

/** Body part of the consent script, after the banner and the settings dialog. */
export const consentScript = `(${mountConsentSource})()`;
