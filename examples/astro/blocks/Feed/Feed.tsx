import type { BlockProps } from "@wunderweb/react";
import { use } from "react";

import type { FeedBlock } from "../../generated/types";
import sample from "./feed.json";

/** One entry of the feed. */
export interface FeedEntry {
	title: string;
	url: string;
}

/** How long a loaded feed is reused (one render suspends and resumes on the same promise). */
const TTL = 1000;
const cache = new Map<string, { at: number; entries: Promise<FeedEntry[]> }>();
/** One promise: `use` resumes a render only on the promise it suspended on. */
const SAMPLE = Promise.resolve(sample);

/**
 * The feed: JSON from EXAMPLE_FEED_URL (read when the page renders, so at
 * build time in a static build and per request in a preview), else the
 * sample next to this file. A failed load shows as an empty feed.
 */
export function loadFeed(): Promise<FeedEntry[]> {
	const url = process.env.EXAMPLE_FEED_URL;
	if (!url) {
		return SAMPLE;
	}
	const hit = cache.get(url);
	// `at` is Infinity while the load runs: a pending load is never replaced.
	if (hit && Date.now() - hit.at < TTL) {
		return hit.entries;
	}
	const entry = { at: Number.POSITIVE_INFINITY, entries: SAMPLE };
	entry.entries = fetch(url, { signal: AbortSignal.timeout(5000) })
		.then((r) => (r.ok ? r.json() : []))
		.then(entriesOf)
		.catch(() => [])
		.finally(() => {
			entry.at = Date.now();
		});
	cache.set(url, entry);
	return entry.entries;
}

/** The well-formed entries of a feed response; anything else is no entry. */
function entriesOf(data: unknown): FeedEntry[] {
	if (!Array.isArray(data)) {
		return [];
	}
	return data.filter(
		(e): e is FeedEntry =>
			typeof e?.title === "string" && typeof e?.url === "string",
	);
}

export function Feed({ block }: BlockProps<FeedBlock>) {
	const entries = use(loadFeed()).slice(0, block.limit ?? 3);
	return (
		<div>
			<h2 className="text-xl font-semibold">{block.heading}</h2>
			{entries.length === 0 ? (
				<p data-feed-empty="">No entries.</p>
			) : (
				<ul className="mt-2 list-disc pl-5">
					{entries.map((e) => (
						<li key={e.url}>
							<a href={e.url}>{e.title}</a>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
