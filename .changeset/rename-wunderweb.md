---
"@wunderweb/core": minor
"@wunderweb/cli": minor
"@wunderweb/react": minor
"@wunderweb/astro": minor
"@wunderweb/next": minor
---

wundercms is now wunderweb: the packages are `@wunderweb/{core,cli,react,astro,next}` (MIT), the CLI is `wunderweb`, the site config `wunderweb.config.yaml`, the generated stylesheet `generated/wunderweb.css`, the schema `urn:wunderweb:…`, the default registry `wunderweb` at `https://github.com/wunderwerkio/wunderweb.git`, the package blocks key `"wunderweb"`, the Astro integration `wunderweb()`, the env vars `WUNDERWEB_*`. The old config file name, package blocks key and registry name are still read, with a deprecation warning. `wunderweb migrate` renames a site in place (`--check`: dry run).
