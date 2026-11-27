// Edit mode refresh of the Astro adapter: inlined into the page as
// `(${mountRefresh})()` next to the bridge (serialised with
// Function#toString: no imports, no outer references).
//
// Registers window.__wunderwebRefresh, which the bridge calls on
// `refresh{revision}` (without it the bridge reloads the page). The page is
// rendered on the server again (the server's own render path, annotated:
// the fetch sends X-Wunderweb-Frame so a preview server answers with the
// framed render) and swapped in place: body elements that changed are replaced, unchanged ones keep their
// DOM (scroll position, open dialogs, playing videos). One refresh at a
// time; a refresh asked for while one runs runs once more afterwards.

export function mountRefresh() {
	if (window.__wunderwebRefresh) {
		return;
	}
	// Tooling the page does not render: the bridge's overlay, dev overlays,
	// inline scripts (the bridge itself, this one), except the page data.
	const SKIP =
		"[data-wc-bridge], script:not(#wc-page), astro-dev-toolbar, vite-error-overlay";
	const content = (body) =>
		[...body.children].filter((el) => !el.matches(SKIP));

	let running = false;
	let again = false;

	const swap = async () => {
		const res = await fetch(location.href, {
			cache: "no-store",
			// A fetch is no frame navigation (Sec-Fetch-Dest: empty): the
			// header asks a preview server for the framed, annotated render.
			headers: { accept: "text/html", "x-wunderweb-frame": "1" },
		});
		if (!res.ok) {
			// e.g. the page was removed or renamed: show what the server shows.
			location.reload();
			return;
		}
		const doc = new DOMParser().parseFromString(await res.text(), "text/html");
		document.title = doc.title;
		if (doc.documentElement.lang) {
			document.documentElement.lang = doc.documentElement.lang;
		}
		const before = content(document.body);
		const after = content(doc.body);
		if (before.length === after.length) {
			before.forEach((el, i) => {
				const next = after[i];
				if (!el.isEqualNode(next)) {
					el.replaceWith(document.importNode(next, true));
				}
			});
			return;
		}
		const anchor = before[0] ?? null;
		for (const el of after) {
			document.body.insertBefore(document.importNode(el, true), anchor);
		}
		for (const el of before) {
			el.remove();
		}
	};

	window.__wunderwebRefresh = () => {
		if (running) {
			again = true;
			return;
		}
		running = true;
		swap()
			.catch(() => location.reload())
			.finally(() => {
				running = false;
				if (again) {
					again = false;
					window.__wunderwebRefresh();
				}
			});
	};
}
