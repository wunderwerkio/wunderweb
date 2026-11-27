#!/usr/bin/env node
// wunderweb CLI.
//
//   wunderweb init [--locales de,en] [--assets <url>] [--astro | --no-next] [--registry <git url>] [--ref <ref>]
//   wunderweb generate [--check]
//   wunderweb lint [--quiet]
//   wunderweb format [--check]
//   wunderweb add <Item>… [--registry <name>] [--ref <tag|branch|sha>]
//   wunderweb update <Block> [--ref <ref>] | --continue
//   wunderweb diff <Block> [--ref <ref>]
//   wunderweb add-block <Name> [--in Leaf]
//   wunderweb migrate [--check]
//
// Visual editing is the hosted editor's (wunderweb); this CLI works on the
// project's files.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { findProject, type Project } from "@wunderweb/core";
import { format } from "./format.js";
import {
	acceptResolved,
	generatedFiles,
	staleFiles,
	writeGenerated,
} from "./generate.js";
import { addBlock, init, STARTER } from "./init.js";
import {
	type AddResult,
	add,
	continueUpdate,
	diff,
	update,
} from "./install.js";
import { formatFindings, lint } from "./lint.js";
import { migrate } from "./migrate.js";

const USAGE = `usage: wunderweb <command>

  init [--locales de,en] [--assets <url>]                scaffold a project here with the starter blocks
       [--astro | --no-next]                             (a Next.js app; --astro: an Astro app)
       [--registry <git url>] [--ref <ref>]
  generate [--check]                                     write generated/ (--check: fail if stale)
  lint [--quiet]                                         validate content (--quiet: errors only)
  format [--check]                                       content YAML in the form the hosted editor edits, block ids filled in
                                                         (--check: fail if a file is not)
  add <Item>... [--registry <name>] [--ref <ref>]        install registry items into blocks/
  update <Block> [--ref <ref>] | <Block> --continue      merge a newer registry version into a block
  diff <Block> [--ref <ref>]                             local changes and upstream changes of a block
  add-block <Name> [--in Leaf]                           scaffold a block written from scratch
  migrate [--check]                                      rename a wundercms site to wunderweb in place
                                                         (--check: fail if there is something to rename)

Refs: a tag, branch or commit. Default: the wunderweb tag of the installed
runtime, other registries their default branch.
`;

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;

const REF = { ref: { type: "string" } } as const;

function run(argv: string[]): number {
	const [command, ...rest] = argv;
	switch (command) {
		case "init":
			return runInit(rest);
		case "generate":
			return runGenerate(rest);
		case "lint":
			return runLint(rest);
		case "add":
			return runAdd(rest);
		case "update":
			return runUpdate(rest);
		case "diff":
			return runDiff(rest);
		case "add-block":
			return runAddBlock(rest);
		case "format":
			return runFormat(rest);
		case "migrate":
			return runMigrate(rest);
		default:
			process.stderr.write(USAGE);
			return command ? EXIT_USAGE : EXIT_OK;
	}
}

function runInit(args: string[]): number {
	const { values } = parseArgs({
		args,
		options: {
			locales: { type: "string", default: "de" },
			assets: { type: "string" },
			"no-next": { type: "boolean", default: false },
			astro: { type: "boolean", default: false },
			registry: { type: "string" },
			...REF,
		},
	});
	const locales = String(values.locales)
		.split(",")
		.map((l) => l.trim())
		.filter(Boolean);
	const written = init(process.cwd(), {
		locales,
		framework: values.astro ? "astro" : values["no-next"] ? "none" : "next",
		...(values.assets ? { assets: values.assets } : {}),
		...(values.registry ? { registry: values.registry } : {}),
	});
	print(written.map((f) => `created ${f}`).join("\n"));

	// Starter blocks through the same path as `add`; present ones are kept.
	const project = findProject();
	const missing = STARTER.filter(
		(b) => !existsSync(join(project.blocksDir, b)),
	);
	if (missing.length) {
		printAdded(add(project, missing, { ref: values.ref }));
	}
	return generate(project);
}

function runGenerate(args: string[]): number {
	const { values } = parseArgs({
		args,
		options: { check: { type: "boolean", default: false } },
	});
	const project = findProject();

	if (values.check) {
		const stale = staleFiles(generatedFiles(project));
		if (stale.length) {
			process.stderr.write(
				`generated files are stale, run \`wunderweb generate\`:\n${stale.map((f) => `  ${f}`).join("\n")}\n`,
			);
			return EXIT_FAIL;
		}
		print("generated files are up to date");
		return EXIT_OK;
	}
	return generate(project);
}

/** Completes resolved updates, then writes generated/. */
function generate(project: Project): number {
	for (const b of acceptResolved(project)) {
		print(`update of ${b} completed (no conflict markers left)`);
	}
	const files = generatedFiles(project);
	writeGenerated(files);
	print(`wrote ${files.length} files to ${project.config.generated}`);
	return EXIT_OK;
}

function runLint(args: string[]): number {
	const { values } = parseArgs({
		args,
		options: { quiet: { type: "boolean", default: false } },
	});
	const project = findProject();

	// Content must be checked against the current theme and blocks, not a stale schema.
	const stale = staleFiles(generatedFiles(project));
	if (stale.length) {
		process.stderr.write(
			"generated files are stale, run `wunderweb generate` first\n",
		);
		return EXIT_FAIL;
	}

	const result = lint(project);
	print(formatFindings(result.findings, !values.quiet));
	print(`${result.errors} error(s), ${result.warnings} warning(s)`);
	return result.errors ? EXIT_FAIL : EXIT_OK;
}

function runFormat(args: string[]): number {
	const { values } = parseArgs({
		args,
		options: { check: { type: "boolean", default: false } },
	});
	const project = findProject();
	// Block ids follow the schema: a stale one would put them in the wrong places.
	const stale = staleFiles(generatedFiles(project));
	if (stale.length) {
		process.stderr.write(
			"generated files are stale, run `wunderweb generate` first\n",
		);
		return EXIT_FAIL;
	}
	const r = format(project, values.check);
	for (const f of r.changed) {
		print(values.check ? `not formatted: ${f}` : `formatted ${f}`);
	}
	for (const f of r.failed) {
		process.stderr.write(`${f.file}: ${f.error}, not formatted\n`);
	}
	if (r.ids) {
		print(
			values.check
				? `${r.ids} block id(s) missing or duplicate`
				: `assigned ${r.ids} block id(s)`,
		);
	}
	if (!r.changed.length && !r.failed.length) {
		print("content is in canonical form");
	}
	return r.failed.length || (values.check && r.changed.length)
		? EXIT_FAIL
		: EXIT_OK;
}

function runAdd(args: string[]): number {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: { registry: { type: "string" }, ...REF },
	});
	if (!positionals.length) {
		process.stderr.write(USAGE);
		return EXIT_USAGE;
	}
	const project = findProject();
	printAdded(
		add(project, positionals, { registry: values.registry, ref: values.ref }),
	);
	return generate(project);
}

function printAdded(r: AddResult) {
	for (const n of r.notes) {
		print(n);
	}
	for (const i of r.installed) {
		print(
			`added ${i.block} from ${i.source.registry.name} ${i.source.ref} (${i.source.commit.slice(0, 12)})${i.dependency ? " as a dependency" : ""}`,
		);
	}
}

function runUpdate(args: string[]): number {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: { continue: { type: "boolean", default: false }, ...REF },
	});
	const [name] = positionals;
	if (!name) {
		process.stderr.write(USAGE);
		return EXIT_USAGE;
	}
	const project = findProject();
	if (values.continue) {
		print(`${name}: update to ${continueUpdate(project, name)} completed`);
		return generate(project);
	}

	const r = update(project, name, { ref: values.ref });
	for (const d of r.added) {
		print(`added ${d} (new dependency)`);
	}
	switch (r.outcome) {
		case "unchanged":
			print(`${name} is already at ${r.to}`);
			return EXIT_OK;
		case "conflicts":
			process.stderr.write(
				`${name}: conflicts merging ${r.to} into local changes:\n${r.conflicts.map((c) => `  ${c}`).join("\n")}\nresolve the markers, then run \`wunderweb update ${name} --continue\`\n`,
			);
			return EXIT_FAIL;
		default:
			print(
				`${name}: ${r.outcome === "replaced" ? "updated" : "merged local changes with"} ${r.to} (was ${r.from})`,
			);
			return generate(project);
	}
}

function runDiff(args: string[]): number {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: { ...REF },
	});
	const [name] = positionals;
	if (!name) {
		process.stderr.write(USAGE);
		return EXIT_USAGE;
	}
	const d = diff(findProject(), name, { ref: values.ref });
	print(`# Local changes (base ${d.base} → local)`);
	print(d.local.trim() || "(none)");
	print("");
	print(`# Upstream changes (base ${d.base} → ${d.ref})`);
	print(d.upstream.trim() || "(none)");
	return EXIT_OK;
}

function runAddBlock(args: string[]): number {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: { in: { type: "string", default: "Leaf" } },
	});
	const [name] = positionals;
	if (!name) {
		process.stderr.write(USAGE);
		return EXIT_USAGE;
	}
	const project = findProject();
	const written = addBlock(project.blocksDir, name, String(values.in));
	print(written.map((f) => `created ${project.config.blocks}/${f}`).join("\n"));
	return generate(project);
}

function runMigrate(args: string[]): number {
	const { values } = parseArgs({
		args,
		options: { check: { type: "boolean", default: false } },
	});
	const r = migrate(process.cwd(), values.check);
	for (const c of r.changes) {
		print(c);
	}
	if (!r.changes.length) {
		print("nothing to migrate");
	}
	if (r.left.length) {
		print(`left to change by hand:\n${r.left.map((l) => `  ${l}`).join("\n")}`);
	}
	return values.check && r.changes.length ? EXIT_FAIL : EXIT_OK;
}

function print(text: string) {
	process.stdout.write(`${text}\n`);
}

try {
	process.exitCode = run(process.argv.slice(2));
} catch (e) {
	const msg = e instanceof Error ? e.message : String(e);
	process.stderr.write(`wunderweb: ${msg}\n`);
	process.exitCode = EXIT_FAIL;
}
