// `wunderweb init`: scaffolds a project in the current directory.
//
//   wunderweb.config.yaml     schema version, locales, asset base
//   theme.yaml                tokens (values), core type extensions, rich text
//   content/<locale>/…        a home page and header / footer fragments
//   blocks/                   starter blocks, installed from the registry (see STARTER)
//   app/…                     Next.js catch-all route, layout, sitemap (default)
//   src/…, astro.config.mjs   Astro content route, sitemap (--astro)
//   .vscode/settings.json     YAML schema mapping for autocomplete
//
// Existing files are never overwritten.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CONFIG_FILE, CORE_VERSIONS } from "@wunderweb/core";

export type Framework = "next" | "astro" | "none";

export interface InitOptions {
	locales: string[];
	assets?: string;
	/** App files to scaffold: a Next.js app, an Astro app or none. */
	framework: Framework;
	/** Git URL (or path) replacing the default wunderweb registry. */
	registry?: string;
}

/** Blocks every new project starts with; `wunderweb add` installs more. */
export const STARTER = [
	"Section",
	"SideBySide",
	"Tiles",
	"Stack",
	"Text",
	"Media",
	"Buttons",
	"Card",
];

const LATEST = Math.max(...CORE_VERSIONS);

export function init(root: string, opts: InitOptions): string[] {
	const [defaultLocale = "de"] = opts.locales;
	const files: Record<string, string> = {
		[CONFIG_FILE]: config(opts, defaultLocale),
		"theme.yaml": THEME,
		".vscode/settings.json": VSCODE,
		...Object.fromEntries(opts.locales.flatMap((l) => content(l))),
		...(opts.framework === "astro"
			? ASTRO_FILES
			: {
					"app/globals.css": GLOBALS_CSS,
					...(opts.framework === "next" ? NEXT_FILES : {}),
				}),
	};

	const written: string[] = [];
	for (const [file, text] of Object.entries(files)) {
		const path = join(root, file);
		if (existsSync(path)) {
			continue;
		}
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, text);
		written.push(file);
	}
	return written;
}

/** Scaffolds a project block written from scratch (no provenance): schema and component. */
export function addBlock(
	blocksDir: string,
	name: string,
	role: string,
): string[] {
	if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
		throw new Error(
			`block name must be PascalCase, e.g. Quote (got "${name}")`,
		);
	}
	const dir = join(blocksDir, name);
	if (existsSync(dir)) {
		throw new Error(`block ${name} already exists (${dir})`);
	}
	const spec = [
		`doc: TODO describe ${name}.`,
		`in: [${role}]`,
		"traits: [Box]",
		"fields:",
		"  title: string",
		"",
	].join("\n");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "block.yaml"), spec);
	writeFileSync(join(dir, `${name}.tsx`), blockComponent(name));
	return [`${name}/block.yaml`, `${name}/${name}.tsx`];
}

// ----------------------------------------------------------------- templates

function config(opts: InitOptions, defaultLocale: string): string {
	const registry = opts.registry
		? [
				"# Registry replacing the default (wunderweb repo, tag of the installed runtime).",
				`registries: [{name: wunderweb, url: ${JSON.stringify(opts.registry)}, path: registry/blocks}]`,
			]
		: [];
	return [
		`# wunderweb project. Docs: https://github.com/wunderwerkio/wunderweb`,
		`schema: ${LATEST}`,
		`locales: [${opts.locales.join(", ")}]`,
		`defaultLocale: ${defaultLocale}`,
		`# Base URL for root-relative asset urls (e.g. an S3 bucket).`,
		opts.assets
			? `assets: ${opts.assets}`
			: `# assets: https://my-bucket.s3.eu-central-1.amazonaws.com`,
		`# siteUrl: https://example.com`,
		`chrome: {header: header, footer: footer}`,
		...(opts.framework === "astro"
			? ["# Site stylesheets, checked by `generate`.", `css: [${ASTRO_CSS}]`]
			: []),
		...registry,
		"",
	].join("\n");
}

const THEME = `# Theme: token values, core type extensions and rich text additions.
# Blocks live in blocks/<Name>/ (\`wunderweb add <Item>\`, \`wunderweb add-block <Name>\`).

tokens:
  Color:
    white: "#ffffff"
    black: "#000000"
    ink: "#1b1b1b"
    paper: "#faf8f5"
    brand: "#c36e01"
  ButtonVariant: [primary, secondary]
  ContainerSize:
    default: {max: 1280px, gutter: {base: 16px, md: 24px}}
  Breakpoint: {sm: 640, md: 768, lg: 1024, xl: 1280}

# Optional fields added to core object types, e.g.
#   Button: {"subtitle?": {type: string, doc: Second label line.}}
extend: {}

richText:
  classes: []
`;

function content(locale: string): [string, string][] {
	const home = [
		"id: home",
		"title: Home",
		"path: /",
		"blocks:",
		"  - type: Text",
		"    layout: {container: default, padding: {base: {top: 16, bottom: 16}}}",
		`    body: <h1>Hello (${locale})</h1><p>Edit content/${locale}/pages/home.yaml</p>`,
		"",
	].join("\n");
	const header = [
		"fragment: header",
		"blocks:",
		"  - type: Text",
		"    layout: {container: default, padding: {base: {top: 4, bottom: 4}}}",
		'    body: <p><a href="page:home">Home</a></p>',
		"",
	].join("\n");
	const footer = [
		"fragment: footer",
		"blocks:",
		"  - type: Text",
		"    background: {color: ink}",
		"    appearance: {textColor: white}",
		"    layout: {container: default, padding: {base: {top: 8, bottom: 8}}}",
		"    body: <p>© Footer</p>",
		"",
	].join("\n");
	return [
		[`content/${locale}/pages/home.yaml`, home],
		[`content/${locale}/fragments/header.yaml`, header],
		[`content/${locale}/fragments/footer.yaml`, footer],
	];
}

const VSCODE = `${JSON.stringify(
	{
		"yaml.schemas": {
			"./generated/schema.json": [
				"content/*/pages/**/*.yaml",
				"content/*/fragments/*.yaml",
			],
		},
	},
	null,
	"\t",
)}\n`;

const GLOBALS_CSS = `@import "tailwindcss";
@import "../generated/wunderweb.css";
`;

const NEXT_FILES: Record<string, string> = {
	"app/[[...slug]]/page.tsx": `// Every content page. Pages, metadata and static params come from content/.

import { createPage } from "@wunderweb/next";
import { createRegistry } from "@wunderweb/react";

import { components } from "../../generated/components";

// Wrap or override entries here, e.g. createRegistry({ ...components, Card: MyCard }).
const page = createPage({ registry: createRegistry(components) });

export const dynamicParams = false;
export const generateStaticParams = page.generateStaticParams;
export const generateMetadata = page.generateMetadata;
export default page.Page;
`,
	"app/layout.tsx": `import "./globals.css";

import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
	return children;
}
`,
	"app/sitemap.ts": `import { createSitemap } from "@wunderweb/next/sitemap";

export default createSitemap();
`,
};

const ASTRO_CSS = "./src/styles/global.css";

const ASTRO_FILES: Record<string, string> = {
	"astro.config.mjs": `import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import wunderweb from "@wunderweb/astro";
import { defineConfig } from "astro/config";

export default defineConfig({
	server: { port: 3000 },
	integrations: [react(), wunderweb()],
	vite: { plugins: [tailwindcss()] },
});
`,
	"src/pages/[...slug].astro": `---
// Every content page. Pages, metadata and static paths come from content/.
import "../styles/global.css";

import {
	getStaticPaths as contentPaths,
	loadPage,
} from "@wunderweb/astro";
import Head from "@wunderweb/astro/Head.astro";
import Page from "@wunderweb/astro/Page.astro";
import { createRegistry } from "@wunderweb/react";

import { components } from "../../generated/components";

export const getStaticPaths = () => contentPaths();

const page = await loadPage(Astro.params.slug);
if (!page) {
	// Astro answers with the 404 page (src/pages/404.astro, else its own).
	return new Response(null, { status: 404 });
}
// Wrap or override entries here, e.g. createRegistry({ ...components, Card: MyCard }).
const registry = createRegistry(components);
---
<!doctype html>
<html lang={page.page.locale}>
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<Head page={page} />
	</head>
	<body>
		<Page page={page} registry={registry} />
	</body>
</html>
`,
	"src/pages/sitemap.xml.ts": `import { createSitemap } from "@wunderweb/astro";

export const GET = createSitemap();
`,
	"src/styles/global.css": `@import "tailwindcss";
@import "../../generated/wunderweb.css";
`,
	"tsconfig.json": `${JSON.stringify(
		{
			extends: "astro/tsconfigs/strict",
			include: [".astro/types.d.ts", "**/*"],
			exclude: ["dist"],
			compilerOptions: { jsx: "react-jsx", jsxImportSource: "react" },
		},
		null,
		"\t",
	)}\n`,
};

function blockComponent(name: string): string {
	return `import type { BlockProps } from "@wunderweb/react";

import type { ${name}Block } from "../../generated/types";

/** Renders the inside of a ${name} block; the runtime renders its box (layout, background, …). */
export function ${name}({ block }: BlockProps<${name}Block>) {
	return <h2>{block.title}</h2>;
}
`;
}
