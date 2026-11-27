// Ajv is CommonJS with `export default`; under NodeNext its default import is
// the module object. The CJS module also exports the class as `Ajv2020`.

import ajvModule from "ajv/dist/2020.js";

export type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";

export const Ajv2020 = ajvModule.default;
