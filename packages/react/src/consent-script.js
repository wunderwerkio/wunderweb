// Consent client script, in two parts inlined into the page. This is the
// readable source: scripts/consent-script.mjs serialises each function on
// its own (no imports, no outer references), minifies it and writes
// consent-script.min.ts, which consent.tsx inlines.
//
//   head  `(${consentHead})(config)`  first in <head>: data layer, gtag,
//         Consent Mode default (all denied) and the stored choice as an
//         update, then - on allowed hosts only - the Google tags (Advanced
//         Consent Mode: they always load, consent decides what they store).
//         With `load: idle` (default) gtag.js is added after the load event
//         when the browser is idle; every command queues in the data layer
//         until then. `eager` adds it at once.
//   body  `(${mountConsent})()`  after the banner and the settings dialog:
//         shows the banner when there is no valid choice, runs banner,
//         dialog and gates, stores the choice and applies every change.
//
// Choice: {<category>: boolean} for the configured categories (necessary
// is implicit), stored in localStorage as {v: version, t: time, c: choice};
// a choice of another version or older than maxAgeDays asks again.
//
//   window.wcConsent  get() · set(choice) · grant(category) · open() · onChange(fn)
//   document          "wc-consent" event on every change, detail {choice, previous}

export function consentHead(c) {
	const w = window;
	w.dataLayer = w.dataLayer || [];
	if (!w.gtag) {
		w.gtag = function gtag() {
			// biome-ignore lint/complexity/noArguments: gtag queues the arguments object
			w.dataLayer.push(arguments);
		};
	}
	const ids = Object.keys(c.categories);
	const signals = ids.flatMap((id) => c.categories[id]);
	const state = (choice) => {
		const s = {};
		for (const id of ids) {
			for (const g of c.categories[id]) {
				s[g] = choice?.[id] ? "granted" : "denied";
			}
		}
		return s;
	};

	let choice = null;
	try {
		const raw = JSON.parse(localStorage.getItem(c.key) || "null");
		const now = Date.now();
		// A time in the future (the clock changed) counts as expired.
		if (
			raw?.v === c.version &&
			raw.c &&
			typeof raw.t === "number" &&
			raw.t <= now &&
			now - raw.t < c.maxAgeDays * 86400000
		) {
			choice = {};
			for (const id of ids) {
				choice[id] = raw.c[id] === true;
			}
		}
	} catch {
		// no storage: ask on every page, everything stays denied
	}

	const google = c.google?.ids ?? [];
	// Before any Google command; the core signals are denied even when no
	// category maps them.
	if (signals.length || google.length) {
		w.gtag("consent", "default", {
			ad_storage: "denied",
			ad_user_data: "denied",
			ad_personalization: "denied",
			analytics_storage: "denied",
			...state(null),
			wait_for_update: 500,
		});
		w.gtag("set", "ads_data_redaction", true);
		w.gtag("set", "url_passthrough", true);
		if (choice) {
			w.gtag("consent", "update", state(choice));
		}
	}

	// Runs fn off the critical path: after the load event, when the main
	// thread is idle (at the latest 2 s later); at once with `load: eager`.
	const later = (fn) => {
		if (c.load === "eager") {
			fn();
			return;
		}
		const idle = () => {
			if (w.requestIdleCallback) {
				w.requestIdleCallback(fn, { timeout: 2000 });
			} else {
				setTimeout(fn, 1);
			}
		};
		if (document.readyState === "complete") {
			idle();
		} else {
			w.addEventListener("load", idle, { once: true });
		}
	};

	const allowed = c.hosts.includes(location.hostname);
	w.__wcConsent = { config: c, choice, allowed, later };
	if (allowed && google.length) {
		w.gtag("js", new Date());
		for (const id of google) {
			w.gtag("config", id);
		}
		later(() => {
			const s = document.createElement("script");
			s.async = true;
			s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(google[0])}`;
			document.head.appendChild(s);
		});
	}
}

export function mountConsent() {
	const w = window;
	const d = document;
	const st = w.__wcConsent;
	if (!st || w.wcConsent) {
		return;
	}
	const c = st.config;
	const ids = Object.keys(c.categories);
	const banner = d.getElementById("wc-consent-banner");
	const dialog = d.getElementById("wc-consent-settings");
	const listeners = new Set();
	let choice = st.choice;
	let opener = null;

	const copy = (x) => (x ? { ...x } : null);
	const normal = (x) =>
		Object.fromEntries(ids.map((id) => [id, x?.[id] === true]));
	const state = (x) =>
		Object.fromEntries(
			ids.flatMap((id) =>
				c.categories[id].map((g) => [g, x[id] ? "granted" : "denied"]),
			),
		);

	// First-party cookies of a vendor, by what its category grants.
	const cookiesOf = (id) => {
		const out = [];
		const signals = c.categories[id] || [];
		if (signals.includes("analytics_storage")) {
			out.push(/^_ga($|_)/);
		}
		if (signals.includes("ad_storage")) {
			out.push(/^_gcl_/);
		}
		if (c.meta?.category === id) {
			out.push(/^_fb[pc]$/);
		}
		return out;
	};
	// Deleted for the host and every parent domain (the registrable one
	// among them; the browser ignores public suffixes).
	const deleteCookies = (withdrawn) => {
		const patterns = withdrawn.flatMap(cookiesOf);
		const parts = location.hostname.split(".");
		const domains = [""];
		for (let i = 0; i < parts.length - 1; i++) {
			domains.push(`; domain=.${parts.slice(i).join(".")}`);
		}
		for (const pair of d.cookie.split(";")) {
			const name = pair.split("=")[0].trim();
			if (name && patterns.some((p) => p.test(name))) {
				for (const domain of domains) {
					// biome-ignore lint/suspicious/noDocumentCookie: expiring cookies on every domain they may be set on (no Cookie Store API in all browsers)
					d.cookie = `${name}=; Max-Age=0; path=/${domain}`;
				}
			}
		}
	};

	const loadMeta = () => {
		if (!c.meta || !st.allowed || w.fbq) {
			return;
		}
		const fbq = function fbq() {
			// biome-ignore lint/complexity/noArguments: the Pixel queues the arguments object
			const args = arguments;
			if (fbq.callMethod) {
				fbq.callMethod.apply(fbq, args);
			} else {
				fbq.queue.push(args);
			}
		};
		w.fbq = fbq;
		w._fbq = w._fbq || fbq;
		fbq.push = fbq;
		fbq.loaded = true;
		fbq.version = "2.0";
		fbq.queue = [];
		// The queue takes commands at once; the Pixel itself loads later.
		st.later(() => {
			const s = d.createElement("script");
			s.async = true;
			s.src = "https://connect.facebook.net/en_US/fbevents.js";
			d.head.appendChild(s);
		});
		fbq("init", c.meta.id);
		fbq("track", "PageView");
	};

	const reveal = (gate) => {
		const t = gate.querySelector("template[data-wc-consent-content]");
		if (t) {
			gate.replaceWith(t.content.cloneNode(true));
		}
	};
	const revealGranted = () => {
		for (const gate of d.querySelectorAll("[data-wc-consent-gate]")) {
			if (choice?.[gate.getAttribute("data-wc-consent-gate")]) {
				reveal(gate);
			}
		}
	};

	const apply = () => {
		if (ids.some((id) => c.categories[id].length)) {
			w.gtag("consent", "update", state(choice));
		}
		if (c.meta && choice[c.meta.category]) {
			loadMeta();
		}
		revealGranted();
	};

	const set = (input) => {
		const previous = choice;
		choice = normal(input);
		try {
			localStorage.setItem(
				c.key,
				JSON.stringify({ v: c.version, t: Date.now(), c: choice }),
			);
		} catch {
			// not stored: asked again on the next page
		}
		if (banner) {
			banner.hidden = true;
		}
		apply();
		const detail = { choice: copy(choice), previous: copy(previous) };
		d.dispatchEvent(new CustomEvent("wc-consent", { detail }));
		for (const fn of listeners) {
			// A failing site callback must not stop the withdrawal below.
			try {
				fn(copy(choice), copy(previous));
			} catch (error) {
				console.error(error);
			}
		}
		// A loaded vendor script cannot be unloaded: its cookies go, the page
		// reloads without it.
		const withdrawn = previous
			? ids.filter((id) => previous[id] && !choice[id])
			: [];
		if (withdrawn.length) {
			deleteCookies(withdrawn);
			location.reload();
		}
	};

	const open = () => {
		if (!dialog) {
			return;
		}
		for (const box of dialog.querySelectorAll(
			"input[data-wc-consent-category]",
		)) {
			box.checked =
				choice?.[box.getAttribute("data-wc-consent-category")] === true;
		}
		opener = d.activeElement;
		if (!dialog.open) {
			dialog.showModal();
		}
	};
	const close = () => {
		if (dialog?.open) {
			dialog.close();
		}
	};
	// Tab wraps inside the dialog instead of leaving for the browser's UI.
	dialog?.addEventListener("keydown", (e) => {
		if (e.key !== "Tab") {
			return;
		}
		const focusable = [
			...dialog.querySelectorAll("a[href], button, input:not([disabled])"),
		];
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (e.shiftKey && d.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && d.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	});
	dialog?.addEventListener("close", () => {
		// Back to the element that opened it, unless it is gone (banner).
		if (opener?.isConnected && opener.offsetParent !== null) {
			opener.focus();
		}
		opener = null;
	});

	const all = (value) => Object.fromEntries(ids.map((id) => [id, value]));
	const actions = {
		accept: () => set(all(true)),
		reject: () => set(all(false)),
		save: () => {
			const next = {};
			for (const box of dialog.querySelectorAll(
				"input[data-wc-consent-category]",
			)) {
				next[box.getAttribute("data-wc-consent-category")] = box.checked;
			}
			set(next);
		},
		settings: open,
		close: () => {},
	};

	d.addEventListener("click", (e) => {
		const el = e.target instanceof Element ? e.target : null;
		const action = el?.closest("[data-wc-consent-action]");
		if (action) {
			e.preventDefault();
			const run = actions[action.getAttribute("data-wc-consent-action")];
			if (action.closest("#wc-consent-settings")) {
				close();
			}
			run?.();
			return;
		}
		if (el?.closest('[data-wc-consent-open], a[href="#wc-consent-settings"]')) {
			e.preventDefault();
			open();
			return;
		}
		const gate = el?.closest("[data-wc-consent-gate]");
		if (gate && el.closest("[data-wc-consent-load]")) {
			reveal(gate);
		} else if (gate && el.closest("[data-wc-consent-allow]")) {
			w.wcConsent.grant(gate.getAttribute("data-wc-consent-gate"));
		}
	});

	w.wcConsent = {
		get: () => copy(choice),
		set,
		grant: (id) => set({ ...normal(choice), [id]: true }),
		open,
		onChange: (fn) => {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
	};

	if (!choice && banner) {
		banner.hidden = false;
	}
	const ready = () => {
		// Gate actions need this script; without it the gates offer their link.
		for (const el of d.querySelectorAll("[data-wc-consent-actions]")) {
			el.hidden = false;
		}
		if (choice) {
			if (c.meta && choice[c.meta.category]) {
				loadMeta();
			}
			revealGranted();
		}
	};
	if (d.readyState === "loading") {
		d.addEventListener("DOMContentLoaded", ready);
	} else {
		ready();
	}
}
