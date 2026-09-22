import { afterEach, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { tmpdir } from "../src/meta/os.ts";
import { closeControllerRun } from "../src/run/full-run-close.ts";
import type { ControllerRunState } from "../src/run/controller-evidence.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import { double } from "./helpers/doubles.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each(["success", "failure", "unsettled"] as const)(
  "records verifier cleanup without replacing %s closure",
  (mode) => {
    const repoRoot = mkdtempSync(join(tmpdir(), "full-run-close-"));
    roots.push(repoRoot);
    mkdirSync(join(repoRoot, "campaigns", "project", "controller", "test"), { recursive: true });
    const lifetime = createVerifierLifetime({ root: join(repoRoot, "receipts") });
    const receipt = mode === "unsettled" ? null : lifetime.begin({ role: "tool" }).id;
    let released = false;
    const state: ControllerRunState = {
      opening: { digest: "opening", epoch: double({ key: "epoch-aaaaaaaaaaaa" }), runId: "test" },
      iterations: [],
      absentSteps: [],
      verifierLifetime: lifetime,
    };
    closeControllerRun(
      repoRoot,
      double({
        project: { id: "project" },
        campaignLockToken: "lock",
        ownsLock: () => true,
        release() {
          released = true;
        },
      }),
      state,
      mode === "failure" ? new Error("primary failure") : null,
    );
    const terminal = JSON.parse(
      readFileSync(join(repoRoot, "campaigns", "project", "controller", "test", "terminal.json"), "utf8"),
    );
    expect(released).toBe(true);
    if (mode === "unsettled") expect(terminal.verifierCleanup).toBeUndefined();
    else {
      expect(terminal.verifierCleanup).toEqual({ state: "pending", receiptIds: [receipt] });
      expect(terminal.outcome).toBe("aborted");
      expect(terminal.terminalReason).toContain(
        mode === "failure" ? "primary failure" : "verifier process cleanup",
      );
    }
  },
);
