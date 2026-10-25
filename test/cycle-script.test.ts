// The release cycle's reader of the runs, through its command line. On a host (`--here`) it prints
// the rows of the runs it finds as JSON, which it can only do once its host imports have loaded.
import { describe, expect, it } from "bun:test";
import { capturedExecPath } from "../src/meta/process.ts";
import { runSync } from "../src/meta/subprocess.ts";

const SCRIPT = ".claude/skills/run-improvement-campaign/scripts/cycle.ts";

describe("cycle.ts", () => {
  it("prints no rows on a host that holds none of the named runs", () => {
    const result = runSync([capturedExecPath, SCRIPT, "--here", "no-such-run-for-the-cycle-test"]);
    expect(new TextDecoder().decode(result.stdout).trim()).toBe("[]");
    expect(result.exitCode).toBe(0);
  }, 30_000);
});
