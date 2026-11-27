// @wunderweb/react/bridge: the edit mode bridge, for adapters
// that inline it themselves. Page inlines it in annotate mode when the
// editor's origins are known.
//
//   <script>{`(${mountBridge})(${JSON.stringify({ origins })})`}</script>

export { type BridgeOptions, mountBridge } from "./bridge-script.js";
