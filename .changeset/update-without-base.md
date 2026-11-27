---
"@wunderweb/cli": patch
---

`update` and `diff` work for blocks whose base commit is not in the registry, e.g. installed from wunderweb's repository before its public one: the base is the item at the block's recorded release tag if the registry has it, else `update` merges two ways (every difference is a conflict to resolve, nothing is dropped) and `diff` compares local against upstream directly.
