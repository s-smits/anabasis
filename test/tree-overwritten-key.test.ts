/**
 * `tree/overwritten-key` (`tools/oxlint/tree-overwritten-key.ts`): a key a caller hands a function
 * that spreads it and then sets the same key. The recorded case is `tool()` and the
 * `executionMode: "sequential"` its callers kept passing until 5 November 2026; the hostile cases
 * are the keys that stay the caller's.
 */
import { describe, expect, it } from "bun:test";
import { overwrittenKeys } from "../tools/oxlint/tree-overwritten-key.ts";

const ANSWER = `export function tool(definition: Definition): SeatTool {
  return defineTool({
    kind: "seat",
    ...definition,
    executionMode: "sequential",
    execute: async (args) => definition.execute(args),
  });
}

export function maybe(options: Options, flag: boolean): Options {
  return { ...options, ...(flag ? { mode: "fixed" } : {}) };
}

export function branch(options: Options, flag: boolean): Options {
  if (flag) return { ...options, mode: "fixed" };
  return { ...options };
}

export function passOn(options: Options): Options {
  log(options);
  return { ...options, mode: "fixed" };
}
`;

const reported = (files: Record<string, string>): string[] =>
  overwrittenKeys(new Map(Object.entries(files))).map((row) => `${row.path}:${row.line}`);

describe("an overwritten key", () => {
  it("is reported where a caller in another file passes the key tool() sets after its spread", () => {
    const caller = `import { tool } from "./answer.ts";
export const listTool = tool({
  name: "list",
  executionMode: "sequential",
  execute: async () => text("listed"),
});
`;
    expect(reported({ "src/tools/answer.ts": ANSWER, "src/tools/list.ts": caller })).toEqual([
      "src/tools/list.ts:4",
    ]);
  });

  it("is reported within one file and through an aliased import", () => {
    const own = `${ANSWER}export const own = tool({ name: "own", executionMode: "parallel" });\n`;
    const aliased = `import { tool as seatTool } from "#src/tools/answer.ts";\nseatTool({ executionMode: "parallel" });\n`;
    expect(reported({ "src/tools/answer.ts": own, "tools/d2/aliased.ts": aliased })).toEqual([
      "src/tools/answer.ts:23",
      "tools/d2/aliased.ts:2",
    ]);
  });

  it("is not reported for a key set before the spread, read from the parameter or not set at all", () => {
    const caller = `import { tool } from "./answer.ts";
tool({ kind: "harness", name: "list", execute: async () => text("listed") });
`;
    expect(reported({ "src/tools/answer.ts": ANSWER, "src/tools/list.ts": caller })).toEqual([]);
  });

  it("is not reported for a conditional key, a key set on one path or a parameter passed on whole", () => {
    const caller = `import { branch, maybe, passOn } from "./answer.ts";
maybe({ mode: "mine" }, true);
branch({ mode: "mine" }, true);
passOn({ mode: "mine" });
`;
    expect(reported({ "src/tools/answer.ts": ANSWER, "src/tools/use.ts": caller })).toEqual([]);
  });

  it("is not reported for a function of the same name that another module owns", () => {
    const other = `export function tool(definition: Definition): Definition {\n  return definition;\n}\n`;
    const caller = `import { tool } from "./other.ts";\ntool({ executionMode: "parallel" });\n`;
    expect(
      reported({ "src/tools/answer.ts": ANSWER, "src/tools/other.ts": other, "src/tools/use.ts": caller }),
    ).toEqual([]);
  });
});
