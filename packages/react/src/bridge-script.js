// Edit mode bridge: inlined into the page as `(${mountBridge})(opts)` when
// the page is annotated for an editor (serialised with Function#toString:
// no imports, no outer references). No network: it talks only to the
// parent window, with explicit origins (opts.origins), never "*".
//
//   editor → page   select, hover, scrollTo, mode, refresh, openDialog, closeDialog
//   page → editor   ready, rendered, select, hover, navigate, rects, box
//
// Draws hover / select rectangles in a shadow root inside a manual popover
// (re-shown on every dialog toggle so it stays above top-layer dialogs);
// labels, badges and actions are the editor's. Clicks select instead of
// following links or opening dialogs.

export function mountBridge(opts) {
	// Explicit origins only: never "*" or anything that is not an origin.
	const origins = (opts?.origins || []).filter((o) => {
		try {
			return o !== "*" && new URL(o).origin === o;
		} catch {
			return false;
		}
	});
	if (window.__wcBridge || window.parent === window || !origins.length) {
		return;
	}
	window.__wcBridge = true;

	const PATH = "data-wc-path";
	// The parent's origin when the browser tells it (Chrome), else learnt
	// from its first message; until then each allowed origin is tried.
	const ancestor = location.ancestorOrigins?.[0];
	let parentOrigin = ancestor && origins.includes(ancestor) ? ancestor : null;
	// Off until the editor switches it on: a page framed by something that
	// is not the editor keeps working normally.
	let mode = "off";
	let selected = null;
	let hovered = null;
	let lastRevision = null;
	let lastRects = "";
	let lastBox = "";
	let frame = 0;

	const post = (msg) => {
		for (const o of parentOrigin ? [parentOrigin] : origins) {
			try {
				window.parent.postMessage(msg, o);
			} catch {
				// not a valid origin
			}
		}
	};
	const revision = () => {
		const main = document.querySelector("main[data-wc-revision]");
		return main ? Number(main.getAttribute("data-wc-revision")) : -1;
	};
	const url = () => location.pathname + location.search;

	// ----------------------------------------------------------------- overlay
	const host = document.createElement("div");
	host.setAttribute("popover", "manual");
	host.setAttribute("data-wc-bridge", "");
	host.style.cssText =
		"position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;z-index:2147483647";
	const shadow = host.attachShadow({ mode: "open" });
	shadow.innerHTML =
		// wunderwerk CI copper; a light inner line keeps it visible on copper content.
		"<style>.r{position:fixed;box-sizing:border-box;pointer-events:none;display:none;border-radius:2px}.h{outline:1px dashed #c36e01;background:rgba(195,110,1,.07)}.s{outline:2px solid #c36e01;outline-offset:-2px;box-shadow:inset 0 0 0 3px rgba(255,255,255,.55)}</style><div class='r h'></div><div class='r s'></div>";
	const [hoverBox, selectBox] = shadow.querySelectorAll(".r");
	document.body.append(host);
	// In edit mode embeds (videos, maps) must not swallow the selecting click.
	const inert = document.createElement("style");
	inert.textContent = `[${PATH}] iframe, [${PATH}] video, [${PATH}] embed, [${PATH}] object { pointer-events: none !important; }`;
	inert.disabled = true;
	document.head.append(inert);
	const show = () => {
		if (mode !== "edit") {
			return;
		}
		try {
			if (host.matches(":popover-open")) {
				host.hidePopover();
			}
			host.showPopover();
		} catch {
			// popover unsupported
		}
	};

	// ----------------------------------------------------------------- geometry
	const visible = (el) => {
		const pop = el.closest("[popover]");
		return !pop || pop === host || pop.matches(":popover-open");
	};
	const elementsOf = (path) =>
		[...document.querySelectorAll(`[${PATH}="${CSS.escape(path)}"]`)].filter(
			visible,
		);
	const rectOf = (path) => {
		let r = null;
		for (const el of elementsOf(path)) {
			const b = el.getBoundingClientRect();
			if (!b.width && !b.height) {
				continue;
			}
			r = r
				? {
						x: Math.min(r.x, b.x),
						y: Math.min(r.y, b.y),
						right: Math.max(r.right, b.right),
						bottom: Math.max(r.bottom, b.bottom),
					}
				: { x: b.x, y: b.y, right: b.right, bottom: b.bottom };
		}
		return (
			r && { x: r.x, y: r.y, width: r.right - r.x, height: r.bottom - r.y }
		);
	};
	const place = (box, rect) => {
		if (!rect || mode !== "edit") {
			box.style.display = "none";
			return;
		}
		box.style.display = "block";
		box.style.left = `${rect.x}px`;
		box.style.top = `${rect.y}px`;
		box.style.width = `${rect.width}px`;
		box.style.height = `${rect.height}px`;
	};
	// The selected block's spacing as laid out: margin, the inner element's
	// padding and gap, and content the block lays out itself (a grid).
	const px = (v) => Number.parseFloat(v) || 0;
	const rectOfEl = (el) => {
		const b = el.getBoundingClientRect();
		return { x: b.x, y: b.y, width: b.width, height: b.height };
	};
	const laidOut = (el) => {
		const cs = getComputedStyle(el);
		const b = el.getBoundingClientRect();
		return (
			cs.display !== "none" &&
			cs.position !== "absolute" &&
			cs.position !== "fixed" &&
			(b.width > 0 || b.height > 0)
		);
	};
	const flowChildren = (el) => [...el.children].filter(laidOut);
	const boxOf = (path) => {
		const el = elementsOf(path)[0];
		if (!el) {
			return null;
		}
		const cs = getComputedStyle(el);
		const box = {
			outer: rectOfEl(el),
			margin: {
				top: px(cs.marginTop),
				right: px(cs.marginRight),
				bottom: px(cs.marginBottom),
				left: px(cs.marginLeft),
			},
			viewport: window.innerWidth,
			rem: px(getComputedStyle(document.documentElement).fontSize) || 16,
		};
		const inner = [...el.children].find((c) =>
			c.classList.contains("wc-inner"),
		);
		if (inner) {
			const ic = getComputedStyle(inner);
			const row = ic.flexDirection.startsWith("row");
			const children = flowChildren(inner);
			box.inner = {
				rect: rectOfEl(inner),
				padding: {
					top: px(ic.paddingTop),
					right: px(ic.paddingRight),
					bottom: px(ic.paddingBottom),
					left: px(ic.paddingLeft),
				},
				gap: px(row ? ic.columnGap : ic.rowGap),
				row,
				children: children.map(rectOfEl),
			};
			box.grids = children
				.filter((c) => !c.hasAttribute(PATH))
				.flatMap((c) => {
					const gc = getComputedStyle(c);
					const items = flowChildren(c);
					return /grid|flex/.test(gc.display) && items.length > 1
						? [
								{
									rect: rectOfEl(c),
									rowGap: px(gc.rowGap),
									columnGap: px(gc.columnGap),
									children: items.map(rectOfEl),
								},
							]
						: [];
				});
		}
		return box;
	};

	const draw = () => {
		frame = 0;
		const rects = {};
		for (const p of [hovered, selected]) {
			if (p) {
				const r = rectOf(p);
				if (r) {
					rects[p] = r;
				}
			}
		}
		place(hoverBox, hovered && hovered !== selected ? rects[hovered] : null);
		place(selectBox, selected ? rects[selected] : null);
		const key = JSON.stringify(rects);
		if (key !== lastRects) {
			lastRects = key;
			post({ wc: "rects", rects });
		}
		const box = selected && mode === "edit" ? boxOf(selected) : null;
		const boxKey = JSON.stringify([selected, box]);
		if (boxKey !== lastBox) {
			lastBox = boxKey;
			post({ wc: "box", path: selected, box });
		}
		const r = revision();
		if (r !== lastRevision) {
			lastRevision = r;
			post({ wc: "rendered", revision: r });
		}
	};
	const schedule = () => {
		if (!frame) {
			frame = requestAnimationFrame(draw);
		}
	};
	const blockAt = (target) =>
		target?.closest ? target.closest(`[${PATH}]`) : null;
	const pathOf = (el) => (el ? el.getAttribute(PATH) : null);

	// The sticky header's height, so scrolled-to blocks are not hidden below it.
	const stickyTop = () => {
		let bottom = 0;
		for (const el of document.querySelectorAll(
			".wc-header, .wc-header [data-block]",
		)) {
			const pos = getComputedStyle(el).position;
			if (pos === "sticky" || pos === "fixed") {
				bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
			}
		}
		return bottom;
	};

	// ----------------------------------------------------------------- input
	document.addEventListener(
		"mousemove",
		(e) => {
			if (mode !== "edit") {
				return;
			}
			const p = pathOf(blockAt(e.target));
			if (p !== hovered) {
				hovered = p;
				post({ wc: "hover", path: p });
				schedule();
			}
		},
		{ capture: true, passive: true },
	);
	document.addEventListener("mouseleave", () => {
		if (hovered) {
			hovered = null;
			post({ wc: "hover", path: null });
			schedule();
		}
	});
	const swallow = (e) => {
		if (mode !== "edit") {
			return false;
		}
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();
		return true;
	};
	document.addEventListener(
		"click",
		(e) => {
			if (!swallow(e)) {
				return;
			}
			selected = pathOf(blockAt(e.target));
			post({ wc: "select", path: selected });
			schedule();
		},
		true,
	);
	for (const type of ["auxclick", "submit", "dblclick"]) {
		document.addEventListener(type, swallow, true);
	}
	document.addEventListener(
		"keydown",
		(e) => {
			if (mode !== "edit" || e.key !== "Escape" || !selected) {
				return;
			}
			const el = elementsOf(selected)[0];
			const parent = el ? blockAt(el.parentElement) : null;
			e.preventDefault();
			selected = pathOf(parent);
			post({ wc: "select", path: selected });
			schedule();
		},
		true,
	);
	window.addEventListener("scroll", schedule, { capture: true, passive: true });
	window.addEventListener("resize", schedule, { passive: true });
	document.addEventListener(
		"toggle",
		(e) => {
			if (e.target !== host) {
				show();
			}
			schedule();
		},
		true,
	);
	if (typeof ResizeObserver === "function") {
		new ResizeObserver(schedule).observe(document.documentElement);
	}
	new MutationObserver(schedule).observe(document.body, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: [PATH, "data-wc-revision", "class", "style", "open"],
	});
	window.addEventListener("popstate", () =>
		post({ wc: "navigate", url: url() }),
	);

	// ----------------------------------------------------------------- editor
	window.addEventListener("message", (e) => {
		if (!origins.includes(e.origin) || e.source !== window.parent) {
			return;
		}
		const d = e.data;
		if (!d || typeof d.wc !== "string") {
			return;
		}
		parentOrigin = e.origin;
		switch (d.wc) {
			case "hello":
				post({ wc: "ready", url: url(), revision: revision() });
				break;
			case "select":
				selected = d.path;
				break;
			case "hover":
				hovered = d.path;
				break;
			case "scrollTo": {
				const el = elementsOf(d.path)[0];
				if (el) {
					const margin = typeof d.margin === "number" ? d.margin : 16;
					const top =
						el.getBoundingClientRect().top +
						window.scrollY -
						stickyTop() -
						margin;
					window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
				}
				break;
			}
			case "mode":
				mode = d.mode === "off" ? "off" : "edit";
				inert.disabled = mode === "off";
				if (mode === "off") {
					try {
						host.hidePopover();
					} catch {
						// not shown
					}
				} else {
					show();
				}
				break;
			case "refresh":
				if (revision() >= d.revision) {
					post({ wc: "rendered", revision: revision() });
				} else if (typeof window.__wunderwebRefresh === "function") {
					window.__wunderwebRefresh();
				} else {
					location.reload();
				}
				break;
			case "openDialog": {
				const dialog = document.getElementById(`wc-dialog-${d.ref}`);
				try {
					dialog?.showPopover();
				} catch {
					// already open
				}
				break;
			}
			case "closeDialog":
				for (const el of document.querySelectorAll('[id^="wc-dialog-"]')) {
					if (el.matches(":popover-open")) {
						el.hidePopover();
					}
				}
				break;
		}
		schedule();
	});

	lastRevision = revision();
	post({ wc: "ready", url: url(), revision: lastRevision });
	schedule();
}
