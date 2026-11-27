// @wunderweb/core: schema model, compiler, validator, content access.

import { existsSync, readFileSync } from "node:fs";

import YAML from "yaml";

import { blockSpecs, projectBlocks } from "./blocks.js";
import { toJsonSchema } from "./json-schema.js";
import {
	buildModel,
	loadCore,
	type Model,
	type ProjectBlockSpec,
	type Theme,
} from "./model.js";
import type { Project } from "./project.js";
import { toTypeScript } from "./typescript.js";

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
export {
	BLOCK_FILE,
	type BlockDir,
	blockSpecs,
	CONFLICT_MARKER,
	projectBlocks,
	readBlocks,
} from "./blocks.js";
export {
	BUILTIN_TEXT,
	type CategoryText,
	type ClientConsent,
	type ConsentConfig,
	type ConsentProblem,
	type ConsentStyle,
	type ConsentText,
	type ConsentTextOverride,
	checkConsent,
	clientConsent,
	consentText,
	type GateData,
	GOOGLE_SIGNALS,
	gateOf,
	LOAD_STRATEGIES,
	type LoadStrategy,
	MEDIA,
	OPEN_ATTR,
	type PageCategory,
	type PageConsent,
	pageConsent,
	SETTINGS_ID,
	SETTINGS_URL,
	STORAGE_KEY,
	videoVendor,
} from "./consent.js";
export {
	type BlockCss,
	CSS_FILE,
	expandBreakpoints,
	toThemeCss,
} from "./css.js";
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
export {
	type FormatIds,
	type Formatted,
	formatYaml,
	NOT_CANONICAL,
	YAML_OPTIONS,
} from "./format.js";
export type {
	BoxModel,
	Edges,
	FromBridge,
	Rect,
	ToBridge,
} from "./frame.js";
export {
	COMPONENTS_FILE,
	conflicted,
	type GeneratedFile,
	generatedFiles,
	readDir,
	staleFiles,
	staleGenerated,
	TYPES_FILE,
} from "./generated.js";
export {
	IMAGE_WIDTHS,
	type ImageCandidate,
	type ImageOptions,
	type ImageSize,
	type ImageTransformer,
	isRasterImage,
	PORTRAIT_RATIO,
	resolveImages,
	variantWidths,
} from "./images.js";
export { type Expanded, expandSlots, type SlotOverride } from "./include.js";
export type { JsonSchema } from "./json-schema.js";
export {
	type BasePlace,
	type Change,
	type Conflict,
	type ConflictReason,
	type ListRef,
	netChanges,
	type Rebased,
	type RebaseOptions,
	rebase,
} from "./merge.js";
export {
	type Block,
	breakpoints,
	buildModel,
	CHILD_PLACEMENT,
	CORE_VERSIONS,
	type Condition,
	type ContainerValue,
	type CoreSchema,
	enumValues,
	type Field,
	isPlain,
	loadCore,
	type Model,
	type ProjectBlockSpec,
	type Provenance,
	type RichTextVocab,
	type RoleSpec,
	type Rule,
	type RuleSpec,
	roleBlocks,
	SchemaError,
	type Steps,
	type Theme,
} from "./model.js";
export {
	CONFIG_FILE,
	type Config,
	type Content,
	type ContentFile,
	configFileOf,
	contentFile,
	contentFiles,
	FRAGMENTS_DIR,
	findProject,
	index,
	LEGACY_CONFIG_FILE,
	loadProject,
	PAGES_DIR,
	type PackageBlocks,
	type Project,
	parseConfig,
	parseSource,
	type RegistryConfig,
	readContent,
	type SourceDoc,
	sourceDoc,
} from "./project.js";
export { safelist } from "./safelist.js";
export {
	buildSite,
	CORE_PAGE_FIELDS,
	ContentError,
	findingPath,
	loadSite,
	localeUrl,
	type Origin,
	type PageSources,
	pageFindings,
	readSchema,
	SCHEMA_FILE,
	type Site,
	type SiteOptions,
	type SitePage,
} from "./site.js";
export {
	checkSiteCss,
	componentClasses,
	type SiteCssContext,
	selectors,
} from "./site-css.js";
export {
	CONTENT_URL_ENV,
	type ContentSource,
	FRAME_HEADER,
	fileSource,
	isFramed,
	type LoadedSite,
	loadProjectSite,
	type PageEntry,
	PREVIEW_ENV,
	type PreviewOptions,
	previewSource,
	type SiteIndex,
	type SourcePage,
	setPreviewHeaders,
	TOKEN_HEADER,
} from "./source.js";
export { at, BASE, Classes, type Resp, tw } from "./tailwind.js";
export type { TsOptions } from "./typescript.js";
export { type Finding, type Level, Validator } from "./validate.js";
export {
	type BlockJson,
	type TypedString,
	type Visitor,
	Walker,
} from "./walk.js";
export { toJsonSchema, toTypeScript };

export interface Compiled {
	model: Model;
	schema: Record<string, unknown>;
	types: string;
}

/** Core version + theme + project blocks → JSON Schema and TypeScript types. */
export function compile(
	version: number,
	theme: Theme,
	blocks: Record<string, ProjectBlockSpec> = {},
	name = "site",
): Compiled {
	const model = buildModel(loadCore(version), theme, blocks);
	return {
		model,
		schema: toJsonSchema(model, name),
		types: toTypeScript(model),
	};
}

/** Compiles a project: its core version, theme.yaml, blocks directory and package blocks. */
export function compileProject(project: Project, name = "site"): Compiled {
	return compile(
		project.config.schema,
		readTheme(project.themeFile),
		blockSpecs(projectBlocks(project)),
		name,
	);
}

/** Reads a theme YAML file; a missing file is an empty theme. */
export function readTheme(file: string): Theme {
	if (!existsSync(file)) {
		return {};
	}
	return (YAML.parse(readFileSync(file, "utf8")) ?? {}) as Theme;
}
