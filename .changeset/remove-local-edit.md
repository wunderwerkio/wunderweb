---
"@wunderweb/core": minor
"@wunderweb/cli": minor
"@wunderweb/astro": minor
"@wunderweb/next": minor
---

Visual editing happens only in the hosted editor (wunderweb). Removed: the CLI's `edit` command, the edit server, the coding agent bridge and the prompt bar; the runtimes' dev edit mode (`WUNDERCMS_EDIT_URL`, `editServiceSource`, Next's `edit-refresh` entry and `inspect` option). The canonical YAML formatter (`formatYaml`, `NOT_CANONICAL`, `YAML_OPTIONS`) and the frame protocol types (`ToBridge`, `FromBridge`, `Rect`, `Edges`, `BoxModel`) are in core now. `format`, `generate` and `lint` work as before.
