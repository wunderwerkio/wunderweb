// Consent of a page for ConsentHead.astro and Consent.astro: nothing in
// edit mode (no banner and no vendor in the editor's frame) and nothing on
// a site without a consent config.
//
// WUNDERWEB_CONSENT_HOSTS (comma separated) adds hosts where tags may load,
// for browser tests on localhost. In a production build or server
// (NODE_ENV production) only loopback hosts are taken, so it can never
// extend tags to a real host.

import type { PageConsent, SourcePage } from "@wunderweb/core";
import { consentHeadScript } from "@wunderweb/react";

export const CONSENT_HOSTS_ENV = "WUNDERWEB_CONSENT_HOSTS";

/** The page's consent, undefined in edit mode or without a consent config. */
export function consentOf(page: SourcePage): PageConsent | undefined {
	return page.annotate ? undefined : page.page.consent;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Hosts of a WUNDERWEB_CONSENT_HOSTS value ("localhost, 127.0.0.1"); with
 * `production`, loopback hosts only.
 */
export function consentHosts(
	value: string | undefined,
	production = process.env.NODE_ENV === "production",
): string[] {
	return (value ?? "")
		.split(",")
		.map((h) => h.trim())
		.filter((h) => h && (!production || LOOPBACK.has(h)));
}

/** The inline head script of a page, undefined when it has no consent. */
export function consentHeadOf(
	page: SourcePage,
	extraHosts: string | undefined = process.env[CONSENT_HOSTS_ENV],
): string | undefined {
	const consent = consentOf(page);
	return consent && consentHeadScript(consent, consentHosts(extraHosts));
}
