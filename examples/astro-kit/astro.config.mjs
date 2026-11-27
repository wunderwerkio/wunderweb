import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import wunderweb from "@wunderweb/astro";
import { defineConfig } from "astro/config";

export default defineConfig({
	integrations: [react(), wunderweb()],
	vite: {
		plugins: [tailwindcss()],
		// The kit ships TypeScript source: Vite compiles it.
		ssr: { noExternal: ["@example/kit"] },
	},
});
