import { mkdirSync, statSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { spawnTextSync } from "./helpers/bun-spawn-sync.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { selectCampaignEpoch } from "../src/author/campaign-epoch.ts";

const script = join(
  import.meta.dir,
  "../.claude/skills/attribution-and-proof/scripts/inspect-solvability.mjs",
);

afterAll(cleanupScratch);

describe("the F2 solvability inspector", () => {
  it("keeps the documented inspector directly executable", () => {
    expect(statSync(script).mode & 0o111).not.toBe(0);
  });

  it("executes under Bun and prints only aggregate evidence, epochs in their recorded order", () => {
    const root = scratchDir("inspect-solvability-");
    // Epoch keys are hashes of their binding, so the recorded order is not the sorted one.
    const first = selectCampaignEpoch(root, { kickoff: "one line b" });
    const second = selectCampaignEpoch(root, { kickoff: "one line a" });
    expect(second.key < first.key).toBe(true);
    for (const [epoch, commit] of [
      [first, "1111111111111111"],
      [second, "2222222222222222"],
    ] as const) {
      const iteration = join(epoch.dir, "01-builder");
      mkdirSync(iteration, { recursive: true });
      writeFileSync(
        join(iteration, "solvability.json"),
        JSON.stringify({
          evidence: {
            cases: [
              { status: "passed" },
              { status: "failed", failedCheckIds: ["check-b", "check-a"] },
              { status: "failed", failedCheckIds: ["check-a"] },
              { status: "non-result" },
            ],
          },
          findings: [{ code: "F2" }, { code: "F2" }, { code: "OTHER" }],
          source: { commit },
          drift: { ok: true },
        }),
      );
    }

    const result = spawnTextSync(Bun.argv[0]!, ["--no-env-file", script, root]);

    expect(result).toMatchObject({ status: 0, signal: null, stderr: "", error: null });
    const block = (key: string, commit: string) =>
      `${key}/01-builder\n` +
      `  cases 4: 1 passed, 2 failed, 1 non-result\n` +
      `  failing checks: check-a (2), check-b (1) — 2 class(es)\n` +
      `  finding codes: F2, OTHER (3 rows)\n` +
      `  source ${commit.slice(0, 12)}, drift {"ok":true}\n`;
    expect(result.stdout).toBe(block(first.key, "1111111111111111") + block(second.key, "2222222222222222"));
  });
});
