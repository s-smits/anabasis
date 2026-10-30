/**
 * Check route matching for Claude Code and Codex inputs, once-per-session delivery, silence
 * for unrelated calls and successful exit on unreadable input.
 */
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "../src/meta/json-runtime.ts";
import { isRecord, isString } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";

import { afterAll, describe, expect, it } from "bun:test";

import { momentsOf, type ToolInput } from "../tools/runtime/moments.ts";
import { spawnTextSync } from "./helpers/bun-spawn-sync.ts";

const script = join(import.meta.dir, "..", "tools", "runtime", "moments.ts");
const temp = mkdtempSync(join(tmpdir(), "ana-moments-test-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const ids = (input: ToolInput | string, seen: readonly string[] = []): string[] =>
  momentsOf(input, new Set(seen)).map((route) => route.id);

function hook(input: unknown): { status: number | null; said: string } {
  const run = spawnTextSync(capturedExecPath, [script], {
    stdin: isString(input) ? input : (capturedJsonStringify(input) ?? ""),
    env: { ...Bun.env, ANA_TEST_TMPDIR: temp },
  });
  const parsed = run.stdout.trim() === "" ? null : capturedJsonParse(run.stdout);
  const output = isRecord(parsed) ? parsed["hookSpecificOutput"] : null;
  const context = isRecord(output) ? output["additionalContext"] : null;
  const said = isString(context) ? context : "";
  return { status: run.status, said };
}

describe("the areas a call enters", () => {
  it("matches shell commands, edited paths and Codex patches", () => {
    expect(ids({ command: "git push --no-verify origin claude/x" })).toEqual(["stack"]);
    expect(ids({ command: "bun run runs fresh truss" })).toEqual(["run"]);
    expect(ids({ file_path: "/w/anabasis/src/builder/prompt.ts" })).toEqual(["seats", "code"]);
    expect(
      ids({ command: "*** Begin Patch\n*** Update File: src/kernel/compare.ts\n@@ x\n*** End Patch" }),
    ).toEqual(["measurement", "code"]);
    expect(ids({ command: ["bash", "-lc", "bun run test -- test/x.test.ts"] })).toEqual(["suite"]);
  });

  it("omits unrelated calls and routes already delivered", () => {
    expect(ids({ command: "ls -la" })).toEqual([]);
    expect(ids({ file_path: "/w/anabasis/README" })).toEqual([]);
    expect(ids({ command: "git commit -m x" }, ["stack"])).toEqual([]);
    expect(ids("not a call")).toEqual([]);
  });

  it("supplies credential guidance for commands and edits involving env files", () => {
    expect(ids({ command: "cat .env" })).toEqual(["credentials"]);
    expect(ids({ file_path: "/w/anabasis/.env.runs" })).toEqual(["credentials"]);
    expect(ids({ command: "grep environment notes.txt" })).toEqual([]);
  });
});

describe("the hook", () => {
  it("delivers each area once per session through PreToolUse context", () => {
    const call = { session_id: "s-1", tool_name: "Bash", tool_input: { command: "bun run land -- 530" } };
    const first = hook(call);
    expect(first.status).toBe(0);
    expect(first.said).toContain("stack-pr");
    expect(hook(call)).toEqual({ status: 0, said: "" });
    expect(hook({ ...call, session_id: "s-2" }).said).toContain("stack-pr");
  });

  it("exits successfully on unreadable input and stores no state for unsafe session ids", () => {
    expect(hook("{ torn")).toEqual({ status: 0, said: "" });
    // A session id that could name a path keeps no state: the area is said each time.
    const astray = { session_id: "../../etc", tool_input: { command: "git push" } };
    expect(hook(astray).said).toContain("stack-pr");
    expect(hook(astray).said).toContain("stack-pr");
  });
});
