// Content sources of the Next adapter: the shared one from core. No React
// imports (the sitemap route must not pull in client router modules).
//
//   fileSource()   the project's files (build, `next dev`)

import { type ContentSource, fileSource } from "@wunderweb/core";

export {
	type ContentSource,
	fileSource,
	type PageEntry,
	type SiteIndex,
	type SourcePage,
} from "@wunderweb/core";

let fallback: ContentSource | undefined;

/** The project's files (fileSource()). */
export function defaultSource(): ContentSource {
	fallback ??= fileSource();
	return fallback;
}
