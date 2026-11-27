// @wunderweb/core/edit: the browser-safe part of the core,
// for the editor: path edits, effective defaults and the frame protocol
// (no file system).

export {
	BLOCK_ID_PATTERN,
	type BlockAt,
	type BlockIds,
	blockIds,
	idsToAssign,
	newBlockId,
	takenIds,
	withNewIds,
} from "./block-ids.js";
export { effectiveDefault, withDefaults } from "./defaults.js";
export {
	anchorEdit,
	anchorPath,
	applyEdit,
	applyEdits,
	EditError,
	findBlock,
	joinPath,
	type PathEdit,
	resolveEdit,
	shiftPath,
	splitPath,
	valueAtPath,
} from "./edit.js";
export type {
	BoxModel,
	Edges,
	FromBridge,
	Rect,
	ToBridge,
} from "./frame.js";
export { isPlain } from "./plain.js";
export { type JsonSchema, Walker } from "./walk.js";
