import type { ClientConsent } from "@wunderweb/core/consent";

/** Head part: data layer, gtag, Consent Mode default and stored choice, Google tags. */
export declare function consentHead(config: ClientConsent): void;
/** Body part: banner, settings dialog, gates and window.wcConsent. */
export declare function mountConsent(): void;
