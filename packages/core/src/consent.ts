// Consent: the optional `consent` section of the site config, its checks,
// the built-in texts and what a page needs to ask for consent.
//
//   wunderweb.config.yaml  consent: {version, privacy, hosts, categories, vendors, …}
//          │
//          ├─ checkConsent ─▶ findings (lint: unknown signal, category, token …)
//          └─ pageConsent ──▶ SitePage.consent (texts of the page's locale,
//                             privacy url resolved), read by the adapter's
//                             banner, the head script and the gates
//
// The category `necessary` is implicit: always granted, never stored.
// `media` is the category of remote videos and embeds (consent gates).
// Browser-safe: no Node imports (`@wunderweb/core/consent`).

/** Google Consent Mode v2 signals a category may grant. */
export const GOOGLE_SIGNALS = [
	"ad_storage",
	"ad_user_data",
	"ad_personalization",
	"analytics_storage",
	"functionality_storage",
	"personalization_storage",
	"security_storage",
] as const;

/**
 * When the vendor scripts (gtag.js, fbevents.js) are added to the page:
 * `idle` after the page's load event, when the main thread is idle (they
 * stay off the critical path; commands queue until then), `eager` at once.
 */
export const LOAD_STRATEGIES = ["idle", "eager"] as const;
export type LoadStrategy = (typeof LOAD_STRATEGIES)[number];
const DEFAULT_LOAD: LoadStrategy = "idle";

/** Category of remote videos and embeds. */
export const MEDIA = "media";
/** Url opening the consent settings (Buttons render a button). */
export const SETTINGS_URL = "consent:settings";
/** Element id of the settings dialog; in-page links to it open it. */
export const SETTINGS_ID = "wc-consent-settings";
/** Marks an element that opens the settings (rich text links). */
export const OPEN_ATTR = "data-wc-consent-open";
/** localStorage key of the stored choice. */
export const STORAGE_KEY = "wc-consent";

const NECESSARY = "necessary";
const DEFAULT_MAX_AGE = 365;
const CATEGORY_ID = /^[a-z][a-z0-9-]*$/;
const HOST =
	/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const GOOGLE_ID = /^[A-Z]{1,3}-[A-Z0-9]+$/;
const META_ID = /^[0-9]+$/;
/** page:<id> or a root-relative path (not //host); https URLs: see privacyUrl. */
const PRIVACY = /^(page:[a-z][a-z0-9-]*$|\/(?!\/))/;

/** page:<id>, a root-relative path or an absolute https URL with a host. */
function privacyUrl(value: string): boolean {
	if (PRIVACY.test(value)) {
		return true;
	}
	try {
		const u = new URL(value);
		return (
			u.protocol === "https:" &&
			HOST.test(u.hostname) &&
			value.startsWith("https://")
		);
	} catch {
		return false;
	}
}

/** The `consent` section of wunderweb.config.yaml. */
export interface ConsentConfig {
	/** Raise to ask every visitor again (e.g. a new vendor). */
	version: number;
	/** A stored choice older than this asks again. Default 365. */
	maxAgeDays?: number;
	/** Privacy page, usually page:<id> (resolved per locale). */
	privacy?: string;
	/** Hostnames where vendors may load (never previews or localhost). */
	hosts: string[];
	/**
	 * When the vendor scripts are added: `idle` (default) after the load
	 * event when the browser is idle, `eager` at once.
	 */
	load?: LoadStrategy;
	/** Category id → the Google consent signals it grants. */
	categories: Record<string, string[]>;
	vendors?: {
		/** Google tags (GA4 G-…, Google Ads AW-…): always loaded, Advanced Consent Mode. */
		google?: { ids: string[] };
		/** Meta Pixel: loaded only once its category is granted. */
		meta?: { id: string; category: string };
	};
	/** Self-hosted tools without cookies that need no consent (named in the dialog). */
	cookieless?: string[];
	/** Theme tokens of banner, dialog and gates. */
	style?: Partial<ConsentStyle>;
	/** Per locale overrides of the built-in texts. */
	text?: Record<string, ConsentTextOverride>;
}

export interface ConsentStyle {
	/** Color token of the banner, dialog and gate background. */
	surface: string;
	/** Color token of their text. */
	text: string;
	/** ButtonVariant of "accept all", and of "only necessary" unless `reject` is set. */
	choice: string;
	/** Quieter ButtonVariant ("save selection" in the dialog, "always allow" in gates). */
	quiet: string;
	/**
	 * ButtonVariant of "only necessary", when it should differ from `choice`.
	 * Default: `choice`. Legal risk: Austrian and German authorities and
	 * courts (DSB, BVwG ORF 2026, DSK, VG Hannover 2025) hold a rejection
	 * that is less prominent than the consent to make the consent invalid.
	 */
	reject?: string;
}

export interface CategoryText {
	label: string;
	description: string;
	/** Vendors named under the category, besides the configured ones (e.g. YouTube). */
	vendors?: string[];
}

/** Every text of banner, dialog and gates in one locale. `{vendor}`, `{tools}` are filled in. */
export interface ConsentText {
	banner: {
		title: string;
		body: string;
		acceptAll: string;
		reject: string;
		settings: string;
	};
	dialog: {
		title: string;
		body: string;
		save: string;
		acceptAll: string;
		reject: string;
		close: string;
		always: string;
		vendors: string;
		cookieless: string;
	};
	privacy: string;
	necessary: CategoryText;
	categories: Record<string, CategoryText>;
	gate: { notice: string; loadOnce: string; allow: string; open: string };
}

export interface ConsentTextOverride {
	banner?: Partial<ConsentText["banner"]>;
	dialog?: Partial<ConsentText["dialog"]>;
	privacy?: string;
	necessary?: Partial<CategoryText>;
	categories?: Record<string, Partial<CategoryText>>;
	gate?: Partial<ConsentText["gate"]>;
}

/** A category as the page shows it. */
export interface PageCategory {
	id: string;
	signals: string[];
	label: string;
	description: string;
	vendors: string[];
}

/** What a page needs to ask for consent: config and texts of its locale. */
export interface PageConsent {
	version: number;
	maxAgeDays: number;
	hosts: string[];
	/** When the vendor scripts are added; missing: idle. */
	load?: LoadStrategy;
	categories: PageCategory[];
	google?: { ids: string[] };
	meta?: { id: string; category: string };
	/** Resolved privacy page url. */
	privacy?: string;
	cookieless: string[];
	style: ConsentStyle;
	text: ConsentText;
}

/** What a consent gate shows: vendor, texts with the vendor filled in. */
export interface GateData {
	category: string;
	vendor: string;
	privacy?: string;
	/** Preview image: only from the site itself (it shows before consent). */
	poster?: string;
	style: ConsentStyle;
	text: {
		notice: string;
		loadOnce: string;
		allow: string;
		open: string;
		privacy: string;
	};
}

/** Config of the client script (head and body part). */
export interface ClientConsent {
	key: string;
	version: number;
	maxAgeDays: number;
	hosts: string[];
	/** When the vendor scripts are added. */
	load: LoadStrategy;
	/** Category id → Google signals. */
	categories: Record<string, string[]>;
	google?: { ids: string[] };
	meta?: { id: string; category: string };
}

const DEFAULT_STYLE: ConsentStyle = {
	surface: "white",
	text: "black",
	choice: "primary",
	quiet: "secondary",
};

// ----------------------------------------------------------------- texts

const DE: ConsentText = {
	banner: {
		title: "Cookies und externe Dienste",
		body: "Dürfen wir Dienste für Statistik und Marketing nutzen und externe Medien laden? Das hilft uns, Website und Werbung zu verbessern. Jederzeit widerrufbar.",
		acceptAll: "Alle akzeptieren",
		reject: "Nur notwendige",
		settings: "Einstellungen",
	},
	dialog: {
		title: "Cookie-Einstellungen",
		body: "Wählen Sie, welche Dienste wir nutzen dürfen. Ihre Auswahl gilt für diese Website und lässt sich jederzeit ändern.",
		save: "Auswahl speichern",
		acceptAll: "Alle akzeptieren",
		reject: "Nur notwendige",
		close: "Schließen",
		always: "Immer aktiv",
		vendors: "Anbieter",
		cookieless:
			"Ohne Einwilligung laufen nur selbst gehostete Dienste ohne Cookies: {tools}.",
	},
	privacy: "Datenschutzerklärung",
	necessary: {
		label: "Notwendig",
		description:
			"Für den Betrieb der Website erforderlich, z. B. um Ihre Auswahl zu speichern.",
	},
	categories: {
		statistics: {
			label: "Statistik",
			description:
				"Hilft uns zu verstehen, wie Besucher die Website nutzen, damit wir sie verbessern können.",
		},
		marketing: {
			label: "Marketing",
			description:
				"Misst den Erfolg unserer Werbekampagnen und ermöglicht Werbung, die zu Ihren Interessen passt.",
		},
		media: {
			label: "Externe Medien",
			description:
				"Lädt Inhalte externer Plattformen, etwa Videos. Dabei werden Daten wie Ihre IP-Adresse an den Anbieter übertragen.",
		},
	},
	gate: {
		notice:
			"Dieser Inhalt wird von {vendor} bereitgestellt. Beim Laden werden Daten wie Ihre IP-Adresse an {vendor} übertragen.",
		loadOnce: "{vendor} einmal laden",
		allow: "Externe Medien immer erlauben",
		open: "Bei {vendor} öffnen",
	},
};

const EN: ConsentText = {
	banner: {
		title: "Cookies and external services",
		body: "May we use services for statistics and marketing and load external media? It helps us improve our website and ads. You can withdraw at any time.",
		acceptAll: "Accept all",
		reject: "Only necessary",
		settings: "Settings",
	},
	dialog: {
		title: "Cookie settings",
		body: "Choose which services we may use. Your choice applies to this website and can be changed at any time.",
		save: "Save selection",
		acceptAll: "Accept all",
		reject: "Only necessary",
		close: "Close",
		always: "Always active",
		vendors: "Providers",
		cookieless:
			"Without consent only self-hosted services without cookies run: {tools}.",
	},
	privacy: "Privacy policy",
	necessary: {
		label: "Necessary",
		description: "Required to run the website, e.g. to store your choice.",
	},
	categories: {
		statistics: {
			label: "Statistics",
			description:
				"Helps us understand how visitors use the website so we can improve it.",
		},
		marketing: {
			label: "Marketing",
			description:
				"Measures the success of our ad campaigns and allows ads that match your interests.",
		},
		media: {
			label: "External media",
			description:
				"Loads content from external platforms, such as videos. This transfers data such as your IP address to the provider.",
		},
	},
	gate: {
		notice:
			"This content is provided by {vendor}. Loading it transfers data such as your IP address to {vendor}.",
		loadOnce: "Load {vendor} once",
		allow: "Always allow external media",
		open: "Open on {vendor}",
	},
};

/** Built-in texts: German and English; other locales get English. */
export const BUILTIN_TEXT: Record<string, ConsentText> = { de: DE, en: EN };

// ----------------------------------------------------------------- checks

export interface ConsentProblem {
	level: "error" | "warning";
	/** Dotted path in the config, e.g. consent.vendors.meta.category */
	at: string;
	message: string;
}

/** What the checks compare the config against: tokens and pages of the site. */
export interface ConsentContext {
	locales: string[];
	colors: string[];
	variants: string[];
	/** Page ids of the default locale (privacy page; other locales fall back to it). */
	pages: Set<string>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] =>
	Array.isArray(v) && v.every((x) => typeof x === "string");
const positiveInt = (v: unknown) => Number.isInteger(v) && (v as number) > 0;

const KEYS = [
	"version",
	"maxAgeDays",
	"privacy",
	"hosts",
	"load",
	"categories",
	"vendors",
	"cookieless",
	"style",
	"text",
];

/** Problems of a `consent` section (undefined: none configured). */
export function checkConsent(
	consent: unknown,
	ctx: ConsentContext,
): ConsentProblem[] {
	if (consent === undefined) {
		return [];
	}
	const out: ConsentProblem[] = [];
	const error = (at: string, message: string) =>
		out.push({ level: "error", at: at ? `consent.${at}` : "consent", message });
	if (!isRecord(consent)) {
		error("", "must be a map (version, hosts, categories, …)");
		return out;
	}
	for (const k of Object.keys(consent)) {
		if (!KEYS.includes(k)) {
			error(k, `unknown field "${k}"`);
		}
	}
	if (!positiveInt(consent.version)) {
		error("version", "positive integer required; raise it to ask again");
	}
	if (consent.maxAgeDays !== undefined && !positiveInt(consent.maxAgeDays)) {
		error("maxAgeDays", "positive integer (days)");
	}
	if (consent.privacy !== undefined) {
		const m = String(consent.privacy).match(/^page:([a-z][a-z0-9-]*)$/);
		if (typeof consent.privacy !== "string" || !privacyUrl(consent.privacy)) {
			error("privacy", "page:<id>, a root-relative path or an https URL");
		} else if (m && !ctx.pages.has(m[1] ?? "")) {
			error("privacy", `no page with id "${m[1]}" in the default locale`);
		}
	}
	if (
		!isStrings(consent.hosts) ||
		!consent.hosts.length ||
		consent.hosts.some((h) => !HOST.test(h))
	) {
		error(
			"hosts",
			"list of hostnames where vendors may load, e.g. [example.com, www.example.com]",
		);
	} else if (consent.hosts.some((h) => !publicHost(h))) {
		error(
			"hosts",
			"production hostnames only: no localhost or IP addresses (tests: WUNDERWEB_CONSENT_HOSTS)",
		);
	}

	if (
		consent.load !== undefined &&
		!(LOAD_STRATEGIES as readonly unknown[]).includes(consent.load)
	) {
		error(
			"load",
			`when vendor scripts load: ${LOAD_STRATEGIES.join(" or ")} (default ${DEFAULT_LOAD})`,
		);
	}

	const categories = isRecord(consent.categories) ? consent.categories : {};
	if (!isRecord(consent.categories) || !Object.keys(categories).length) {
		error("categories", "map of category id to Google consent signals");
	}
	const owner = new Map<string, string>();
	for (const [id, signals] of Object.entries(categories)) {
		const at = `categories.${id}`;
		if (id === NECESSARY) {
			error(at, `"${NECESSARY}" is implicit (always granted)`);
			continue;
		}
		if (!CATEGORY_ID.test(id)) {
			error(at, "category ids are lower-case words, e.g. statistics");
		}
		if (!isStrings(signals)) {
			error(at, "list of Google consent signals ([] for none)");
			continue;
		}
		for (const s of signals) {
			if (!(GOOGLE_SIGNALS as readonly string[]).includes(s)) {
				error(
					at,
					`unknown Google consent signal "${s}" (${GOOGLE_SIGNALS.join(", ")})`,
				);
				continue;
			}
			const first = owner.get(s);
			if (first) {
				error(
					at,
					`signal "${s}" is already granted by "${first}"; a signal belongs to one category`,
				);
			}
			owner.set(s, id);
		}
	}

	const vendors = consent.vendors;
	if (vendors !== undefined) {
		if (!isRecord(vendors)) {
			error("vendors", "map of vendors (google, meta)");
		} else {
			for (const k of Object.keys(vendors)) {
				if (k !== "google" && k !== "meta") {
					error(`vendors.${k}`, `unknown vendor "${k}" (google, meta)`);
				}
			}
			const g = vendors.google;
			if (
				g !== undefined &&
				(!isRecord(g) ||
					!isStrings(g.ids) ||
					!g.ids.length ||
					g.ids.some((id) => !GOOGLE_ID.test(id)))
			) {
				error(
					"vendors.google.ids",
					"list of Google tag ids, e.g. G-ABC123, AW-123456789",
				);
			}
			if (g !== undefined && !owner.size) {
				error(
					"vendors.google",
					"no category grants a Google consent signal (e.g. statistics: [analytics_storage])",
				);
			}
			const meta = vendors.meta;
			if (meta !== undefined) {
				if (
					!isRecord(meta) ||
					typeof meta.id !== "string" ||
					!META_ID.test(meta.id)
				) {
					error("vendors.meta.id", "Meta Pixel id (digits, quoted)");
				}
				const cat = isRecord(meta) ? meta.category : undefined;
				if (typeof cat !== "string" || !Object.hasOwn(categories, cat)) {
					error("vendors.meta.category", `unknown category "${String(cat)}"`);
				}
			}
		}
	}

	if (consent.cookieless !== undefined && !isStrings(consent.cookieless)) {
		error("cookieless", "list of tool names");
	}

	const style = consent.style;
	if (style !== undefined && !isRecord(style)) {
		error("style", "map of surface, text, choice, quiet, reject");
	}
	const s: Record<string, unknown> = {
		...DEFAULT_STYLE,
		...(isRecord(style) ? style : {}),
	};
	for (const k of Object.keys(isRecord(style) ? style : {})) {
		if (!Object.hasOwn(DEFAULT_STYLE, k) && k !== "reject") {
			error(`style.${k}`, `unknown field "${k}"`);
		}
	}
	if (s.reject !== undefined && !ctx.variants.includes(String(s.reject))) {
		error(
			"style.reject",
			`"${String(s.reject)}" is not a ButtonVariant (${ctx.variants.join(", ")})`,
		);
	}
	for (const k of ["surface", "text"] as const) {
		if (!ctx.colors.includes(String(s[k]))) {
			error(
				`style.${k}`,
				`"${String(s[k])}" is not a Color token (${ctx.colors.join(", ")})`,
			);
		}
	}
	for (const k of ["choice", "quiet"] as const) {
		if (!ctx.variants.includes(String(s[k]))) {
			error(
				`style.${k}`,
				`"${String(s[k])}" is not a ButtonVariant (${ctx.variants.join(", ")})`,
			);
		}
	}

	const text = isRecord(consent.text) ? consent.text : {};
	if (consent.text !== undefined && !isRecord(consent.text)) {
		error("text", "map of locale to text overrides");
	}
	for (const [locale, t] of Object.entries(text)) {
		if (!ctx.locales.includes(locale)) {
			error(`text.${locale}`, `"${locale}" is not a site locale`);
		}
		for (const [at, message] of textProblems(t, categories)) {
			error(`text.${locale}${at}`, message);
		}
	}
	for (const locale of ctx.locales) {
		const builtin = BUILTIN_TEXT[locale] ?? EN;
		for (const id of Object.keys(categories)) {
			const own = (
				isRecord(text[locale]) ? (text[locale] as ConsentTextOverride) : {}
			).categories?.[id];
			const known = Object.hasOwn(builtin.categories, id);
			if (!known && (!own?.label || !own?.description)) {
				error(
					`text.${locale}.categories.${id}`,
					`category "${id}" has no built-in text; set label and description`,
				);
			}
		}
	}
	return out;
}

/** Text sections and their string fields (categories and necessary: CategoryText). */
const TEXT_FIELDS: Record<string, string[] | undefined> = {
	banner: Object.keys(EN.banner),
	dialog: Object.keys(EN.dialog),
	gate: Object.keys(EN.gate),
};
const CATEGORY_TEXT = ["label", "description", "vendors"];

/** Problems of one locale's text overrides: known fields, strings only. */
function textProblems(
	t: unknown,
	categories: Record<string, unknown>,
): [string, string][] {
	if (!isRecord(t)) {
		return [["", "map of text overrides (banner, dialog, gate, …)"]];
	}
	const out: [string, string][] = [];
	const categoryText = (v: unknown, at: string) => {
		if (!isRecord(v)) {
			out.push([at, "map of label, description, vendors"]);
			return;
		}
		for (const [k, x] of Object.entries(v)) {
			if (!CATEGORY_TEXT.includes(k)) {
				out.push([`${at}.${k}`, `unknown field "${k}"`]);
			} else if (k === "vendors" ? !isStrings(x) : typeof x !== "string") {
				out.push([`${at}.${k}`, k === "vendors" ? "list of names" : "text"]);
			}
		}
	};
	for (const [section, v] of Object.entries(t)) {
		const at = `.${section}`;
		if (section === "privacy") {
			if (typeof v !== "string") {
				out.push([at, "text"]);
			}
		} else if (section === "necessary") {
			categoryText(v, at);
		} else if (section === "categories" && !isRecord(v)) {
			out.push([at, "map of category id to label, description, vendors"]);
		} else if (section === "categories" && isRecord(v)) {
			for (const [id, c] of Object.entries(v)) {
				if (!Object.hasOwn(categories, id)) {
					out.push([`${at}.${id}`, `unknown category "${id}"`]);
				} else {
					categoryText(c, `${at}.${id}`);
				}
			}
		} else if (TEXT_FIELDS[section] && isRecord(v)) {
			for (const [k, x] of Object.entries(v)) {
				if (!TEXT_FIELDS[section]?.includes(k)) {
					out.push([`${at}.${k}`, `unknown field "${k}"`]);
				} else if (typeof x !== "string") {
					out.push([`${at}.${k}`, "text"]);
				}
			}
		} else {
			out.push([at, `unknown text section "${section}"`]);
		}
	}
	return out;
}

/** A hostname of the public web: not localhost, not an IP address. */
function publicHost(host: string): boolean {
	return (
		host !== "localhost" &&
		!host.endsWith(".localhost") &&
		!/^[0-9.]+$/.test(host) &&
		host.includes(".")
	);
}

// ----------------------------------------------------------------- page

/** Vendor names a category stands for, from the configured vendors. */
function vendorNames(consent: ConsentConfig, id: string): string[] {
	const signals = consent.categories[id] ?? [];
	const ids = consent.vendors?.google?.ids ?? [];
	const out: string[] = [];
	if (
		signals.includes("analytics_storage") &&
		ids.some((x) => x.startsWith("G-"))
	) {
		out.push("Google Analytics");
	}
	if (
		signals.some((s) => s.startsWith("ad_")) &&
		ids.some((x) => x.startsWith("AW-") || x.startsWith("DC-"))
	) {
		out.push("Google Ads");
	}
	if (consent.vendors?.meta?.category === id) {
		out.push("Meta");
	}
	return out;
}

/** Built-in texts of a locale with the site's overrides. */
export function consentText(
	consent: Pick<ConsentConfig, "text">,
	locale: string,
): ConsentText {
	const base = BUILTIN_TEXT[locale] ?? EN;
	const own = consent.text?.[locale] ?? {};
	const categories: Record<string, CategoryText> = { ...base.categories };
	for (const [id, t] of Object.entries(own.categories ?? {})) {
		categories[id] = {
			...(categories[id] ?? { label: id, description: "" }),
			...t,
		};
	}
	return {
		banner: { ...base.banner, ...own.banner },
		dialog: { ...base.dialog, ...own.dialog },
		privacy: own.privacy ?? base.privacy,
		necessary: { ...base.necessary, ...own.necessary },
		categories,
		gate: { ...base.gate, ...own.gate },
	};
}

/** The consent of a page in `locale`; `url` resolves the privacy link. */
export function pageConsent(
	consent: ConsentConfig,
	locale: string,
	url: (u: string) => string,
): PageConsent {
	const text = consentText(consent, locale);
	const out: PageConsent = {
		version: consent.version,
		maxAgeDays: consent.maxAgeDays ?? DEFAULT_MAX_AGE,
		hosts: consent.hosts,
		load: consent.load ?? DEFAULT_LOAD,
		categories: Object.entries(consent.categories).map(([id, signals]) => {
			const t = text.categories[id] ?? { label: id, description: "" };
			return {
				id,
				signals,
				label: t.label,
				description: t.description,
				vendors: [...vendorNames(consent, id), ...(t.vendors ?? [])],
			};
		}),
		cookieless: consent.cookieless ?? [],
		style: { ...DEFAULT_STYLE, ...consent.style },
		text,
	};
	if (consent.vendors?.google) {
		out.google = { ids: consent.vendors.google.ids };
	}
	if (consent.vendors?.meta) {
		out.meta = { ...consent.vendors.meta };
	}
	if (consent.privacy) {
		out.privacy = url(consent.privacy);
	}
	return out;
}

const fill = (s: string, vendor: string) => s.replaceAll("{vendor}", vendor);

/** What a consent gate for `vendor` in `category` shows. */
export function gateOf(
	consent: PageConsent,
	category: string,
	vendor: string,
	labels: Partial<GateData["text"]> = {},
): GateData {
	const t = consent.text.gate;
	const gate: GateData = {
		category,
		vendor,
		style: consent.style,
		text: {
			notice: fill(labels.notice ?? t.notice, vendor),
			loadOnce: fill(labels.loadOnce ?? t.loadOnce, vendor),
			allow: fill(labels.allow ?? t.allow, vendor),
			open: fill(labels.open ?? t.open, vendor),
			privacy: labels.privacy ?? consent.text.privacy,
		},
	};
	if (consent.privacy) {
		gate.privacy = consent.privacy;
	}
	return gate;
}

/** Vendor of a remote video url: YouTube, Vimeo, else its host. */
export function videoVendor(url: string): string {
	if (
		/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(hostOf(url))
	) {
		return "YouTube";
	}
	if (/(^|\.)vimeo\.com$/.test(hostOf(url))) {
		return "Vimeo";
	}
	return hostOf(url) || "external";
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return "";
	}
}

/** Config of the client script; `extraHosts` (tests: localhost) extend the allowed hosts. */
export function clientConsent(
	consent: PageConsent,
	extraHosts: string[] = [],
): ClientConsent {
	const out: ClientConsent = {
		key: STORAGE_KEY,
		version: consent.version,
		maxAgeDays: consent.maxAgeDays,
		hosts: [...new Set([...consent.hosts, ...extraHosts])],
		load: consent.load ?? DEFAULT_LOAD,
		categories: Object.fromEntries(
			consent.categories.map((c) => [c.id, c.signals]),
		),
	};
	if (consent.google) {
		out.google = consent.google;
	}
	if (consent.meta) {
		out.meta = consent.meta;
	}
	return out;
}
