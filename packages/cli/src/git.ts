// Plain git as the registry transport: the developer's own credentials (SSH
// keys or a credential helper such as `gh auth setup-git`), any host.

import { execFileSync } from "node:child_process";

export class GitError extends Error {}

/** Runs git; returns stdout. Throws GitError with git's message. */
export function git(args: string[], cwd?: string): string {
	try {
		return execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
		});
	} catch (e) {
		const err = e as { stderr?: string; message: string };
		throw new GitError(
			`git ${args.join(" ")}: ${(err.stderr || err.message).trim()}`,
		);
	}
}

/** Like git(), but returns undefined instead of throwing. */
export function tryGit(args: string[], cwd?: string): string | undefined {
	try {
		return git(args, cwd);
	} catch {
		return undefined;
	}
}

/** Refs of a remote: ref name → commit (annotated tags peeled). */
export function lsRemote(
	url: string,
	args: string[] = [],
): Map<string, string> {
	const out = new Map<string, string>();
	for (const line of git(["ls-remote", ...args, url]).split("\n")) {
		const [sha, ref] = line.split("\t");
		// `--symref` adds "ref: refs/heads/main\tHEAD" before the commit line.
		if (!sha || !ref || sha.startsWith("ref: ")) {
			continue;
		}
		if (ref.endsWith("^{}")) {
			out.set(ref.slice(0, -3), sha);
		} else if (!out.has(ref)) {
			out.set(ref, sha);
		}
	}
	return out;
}

/**
 * Three-way merge of one file (git merge-file semantics): returns the merged
 * text and whether conflict markers were left.
 */
export function mergeFile(
	files: { ours: string; base: string; theirs: string },
	labels: { ours: string; base: string; theirs: string },
): { text: string; conflicts: boolean } {
	try {
		const text = execFileSync(
			"git",
			[
				"merge-file",
				"-p",
				"-L",
				labels.ours,
				"-L",
				labels.base,
				"-L",
				labels.theirs,
				files.ours,
				files.base,
				files.theirs,
			],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
		return { text, conflicts: false };
	} catch (e) {
		const err = e as { status?: number; stdout?: string; message: string };
		// Exit code = number of conflicts (> 0); negative / missing = failure.
		if (typeof err.status === "number" && err.status > 0 && err.stdout) {
			return { text: err.stdout, conflicts: true };
		}
		throw new GitError(`git merge-file: ${err.message}`);
	}
}
