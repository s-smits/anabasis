// An investigation refuses a campaign that may still write its log (operator, 3 November). A peer's
// copy is read by the observation its last fetch kept; this machine's by its own processes, never
// by a stale observation file beside its log.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { stillRunning } from "../tools/runs/diagnosis.ts";
import type { Run } from "../tools/runs/registry.ts";

let dir = "";

function copy(name: string, observation: { open: boolean; stderr: null } | null, archived?: string): Run {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "log.jsonl"), "");
  if (observation !== null) writeFileSync(join(dir, name, "observation.json"), JSON.stringify(observation));
  const run: Run = { name, tree: dir, path: join(dir, name, "log.jsonl"), end: "comparison.reported" };
  return archived === undefined ? run : { ...run, archived };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ana-run-stopped-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("whether a campaign may still write its log", () => {
  it("reads a peer's copy by the observation its last fetch kept", () => {
    expect(stillRunning(copy("wri-test-open", { open: true, stderr: null }, "peer"), [])).toBe(true);
    expect(stillRunning(copy("wri-test-closed", { open: false, stderr: null }, "peer"), [])).toBe(false);
  });

  it("reads this machine's own campaign by its processes, not a stale observation beside it", () => {
    expect(stillRunning(copy("wri-test-local", { open: true, stderr: null }), [])).toBe(false);
    expect(stillRunning(copy("wri-test-here", { open: true, stderr: null }, "here"), [])).toBe(false);
    const run = copy("wri-test-written", null);
    const writer = { pid: 1, cwd: dir, args: ["bun", "/x/tools/d2/harness-builder.ts", "--name", run.name] };
    expect(stillRunning({ ...run, tree: "/x" }, [writer])).toBe(true);
  });
});
