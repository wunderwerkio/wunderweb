// The examples' content is valid against their compiled schema. (The
// negative cases, real sites bent out of the layout system, run in the
// hosted service's repository against the published core.)

import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	compileProject,
	loadProject,
	readContent,
	Validator,
} from "../src/index.js";
import type { Content, Project } from "../src/project.js";

const EXAMPLES = join(import.meta.dirname, "..", "..", "..", "examples");

interface Site {
	project: Project;
	content: Content;
	validator: Validator;
}

function site(name: string): Site {
	const project = loadProject(join(EXAMPLES, name));
	const { schema } = compileProject(project, name);
	return {
		project,
		content: readContent(project),
		validator: new Validator(schema),
	};
}

describe("example content is valid", () => {
	for (const name of ["astro", "astro-kit"]) {
		it(name, () => {
			const s = site(name);
			const errors = s.validator
				.validateSite(s.content, s.project.config)
				.filter((f) => f.level === "error");
			expect(errors).toEqual([]);
		});
	}
});
