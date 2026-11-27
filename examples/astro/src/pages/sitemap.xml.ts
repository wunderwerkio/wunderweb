import { createSitemap } from "@wunderweb/astro";
import type { APIRoute } from "astro";

// The request's source: a preview build lists the changeset's pages.
export const GET: APIRoute = createSitemap();
