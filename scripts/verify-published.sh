#!/usr/bin/env bash
# Checks a published release from npmjs.com as a site gets it, outside this
# monorepo and without any token: the example Astro site installed at one
# version builds (static and preview), every CLI command works in it, and
# `npx @wunderweb/cli init` in an empty folder gives a project that builds.
#
#   scripts/verify-published.sh [version]
#
# Default version: packages/core/package.json. Needs node, npm and git. The
# CLI's registry commands fetch github.com/wunderwerkio/wunderweb (public)
# at the release's tag (@wunderweb/react@<version>).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-$(node -p "require('$ROOT/packages/core/package.json').version")}"
# Nothing of a maintainer's setup: the public registry (VERIFY_REGISTRY to
# try a local one), no token.
export npm_config_registry="${VERIFY_REGISTRY:-https://registry.npmjs.org/}"
unset NODE_AUTH_TOKEN

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# No user-level npm config either (e.g. the release job's ~/.npmrc, whose
# token line would be sent with every read).
: >"$WORK/npmrc"
export npm_config_userconfig="$WORK/npmrc"
SITE="$WORK/site"
step() { printf '\n== %s\n' "$*"; }

step "packages at $VERSION"
for p in core react cli astro next; do
	got=""
	# A version just published may take minutes to show (staged publishing:
	# until it is approved; the registry's CDN caches the 404 meanwhile).
	for _ in $(seq 1 60); do
		got="$(npm view "@wunderweb/$p@$VERSION" version 2>/dev/null || true)"
		[ "$got" = "$VERSION" ] && break
		sleep 10
	done
	[ "$got" = "$VERSION" ] || { echo "@wunderweb/$p@$VERSION is not published"; exit 1; }
	echo "@wunderweb/$p@$VERSION"
done

step "the example site, installed from npmjs.com"
mkdir -p "$SITE"
(cd "$ROOT/examples/astro" && tar -cf - --exclude=node_modules --exclude='dist*' \
	--exclude=.astro --exclude=test --exclude=scripts .) | tar -xf - -C "$SITE"
node - "$SITE" "$VERSION" <<'EOF'
// workspace:* → the release (private workspace packages, e.g. the preview
// mock's, are dropped); the registry from GitHub instead of the working tree.
const fs = require("node:fs");
const [site, version] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(`${site}/package.json`, "utf8"));
for (const deps of [pkg.dependencies, pkg.devDependencies]) {
	for (const [name, v] of Object.entries(deps ?? {})) {
		if (!v.startsWith("workspace:")) continue;
		if (name.startsWith("@wunderweb/")) deps[name] = version;
		else delete deps[name];
	}
}
fs.writeFileSync(`${site}/package.json`, JSON.stringify(pkg, null, "\t"));
const config = `${site}/wunderweb.config.yaml`;
const text = fs.readFileSync(config, "utf8");
const without = text.replace(/^registries:\n(  - .*\n)+/m, "");
if (without === text || /^registries:/m.test(without)) {
	throw new Error("could not drop the working-tree registry from wunderweb.config.yaml");
}
fs.writeFileSync(config, without);
EOF
(cd "$SITE" && npm install --no-audit --no-fund --loglevel=error)
cli() { (cd "$SITE" && npx --no-install wunderweb "$@"); }

step "generate, lint, format"
cli generate --check
cli lint --quiet
cli format --check

step "add, diff, update, add-block"
cli add Accordion
test -f "$SITE/blocks/Accordion/block.yaml"
cli diff Accordion
cli update Accordion
cli add-block Quote --in Leaf
test -f "$SITE/blocks/Quote/Quote.tsx"
cli generate
cli lint --quiet

step "npx @wunderweb/cli init (a new project in an empty folder)"
mkdir "$WORK/new"
(cd "$WORK/new" && npx --yes "@wunderweb/cli@$VERSION" init --astro --locales de,en)
# The site's dependencies (init writes no package.json): the example's.
cp "$SITE/package.json" "$WORK/new/"
ln -s "$SITE/node_modules" "$WORK/new/node_modules"
(cd "$WORK/new" && npx --no-install wunderweb generate --check && npx --no-install wunderweb lint --quiet)
(cd "$WORK/new" && npx --no-install astro build)
test -f "$WORK/new/dist/index.html"

step "builds: static, and preview"
(cd "$SITE" && npx --no-install astro build)
test -f "$SITE/dist/index.html"
(cd "$SITE" && WUNDERWEB_PREVIEW=1 EXAMPLE_OUT_DIR="$WORK/preview" npx --no-install astro build)
test -f "$WORK/preview/server/entry.mjs"

step "ok: $VERSION installs, builds and runs every CLI command"
