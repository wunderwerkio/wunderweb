import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import wunderweb, { previewBuild } from "@wunderweb/astro";
import { defineConfig } from "astro/config";

// Two outputs per commit: `astro build` is the static site (dist/);
// WUNDERWEB_PREVIEW=1 builds the preview server (dist-preview/), whose
// content comes from the content service per request. EXAMPLE_OUT_DIR
// overrides the output directory (tests build into a temporary one).
const preview = previewBuild();

export default defineConfig({
	server: { port: 3000 },
	outDir: process.env.EXAMPLE_OUT_DIR ?? (preview ? "dist-preview" : "dist"),
	...(preview ? { adapter: node({ mode: "standalone" }) } : {}),
	integrations: [
		react(),
		// Routes besides the content route that read content: on demand in a preview build.
		wunderweb({
			previewRoutes: ["src/pages/site-index.astro", "src/pages/sitemap.xml.ts"],
		}),
	],
	vite: { plugins: [tailwindcss()] },
});
