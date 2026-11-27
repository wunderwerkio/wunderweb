// @wunderweb/react: framework-agnostic renderer and the helpers
// project block components build on (box traits, rich text, SVG, media,
// button, icon and dialog elements, class helpers).
//
//   <Page page={sitePage} registry={createRegistry(components)} breakpoints={bps} />
//
// Dialogs (Button.opens) are page-level: the loader lists the ones a page
// opens (sitePage.dialogs) and Page renders each once. Block components
// render buttons (ButtonEl), never dialogs.

export {
	at,
	BASE,
	Classes,
	type Resp,
	tw,
} from "@wunderweb/core/tailwind";
export {
	BoxFrame,
	cssColor,
	type FrameProps,
	gradientCss,
	paint,
	withBox,
} from "./box.js";
export {
	CONSENT_EVENT,
	type ConsentApi,
	type ConsentChoice,
	type ConsentEventDetail,
	ConsentGate,
	consentHeadScript,
	consentScript,
	type GateLabels,
} from "./consent.js";
export type * from "./core-types.js";
export {
	ButtonEl,
	dialogId,
	IconEl,
	MediaElement,
	type MediaOptions,
	RemoteVideo,
} from "./elements.js";
export { RichText, Svg } from "./html.js";
export {
	coverScale,
	fullSrcSet,
	type ImageAsset,
	type ImageBox,
	imageSize,
	imageSrcSet,
	PORTRAIT_MEDIA,
	posterOf,
	ratioOf,
} from "./images.js";
export {
	type BlockComponent,
	type BlockLike,
	type BlockProps,
	type BlockRef,
	type Components,
	createRegistry,
	hasOwnBox,
	ownBox,
	type Registry,
	type RenderContext,
} from "./registry.js";
export {
	type Annotation,
	Block,
	type BlockSource,
	Blocks,
	type BoundaryProps,
	createContext,
	INSPECT_ID,
	languageLinks,
	PAGE_DATA_ID,
	Page,
	type PageData,
	type RenderOptions,
} from "./render.js";
