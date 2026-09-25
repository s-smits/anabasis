import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { campaignBudgetGate, setTurnBudget } from "../src/run/campaign-budget.ts";
import { buildHarness, resolveBuilderCondition } from "../src/run/harness-build.ts";
import { loadRepoEnv } from "../src/backends/env.ts";
import { resolveSlots } from "../src/backends/resolve.ts";
import type { AskManifest } from "../src/run/ask-manifest.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const MANIFEST: AskManifest = { slug: "bridge-truss", domain: "bridge-truss", expectedTasks: 25 };

/**
 * The build entrypoint: which epoch a pass opens and returns to, what it refuses to start without,
 * and which Builder slot the campaign resolves for it. A spent turn budget returns straight after
 * epoch selection, so the epoch binding is exercised without opening a provider session.
 */

afterAll(cleanupScratch);

const SCRATCH_ROOT = scratchDir(".ana-scratch-build-", import.meta.dir);

describe("the harness build step", () => {
  it.concurrent("opens a reopening pass's own epoch and returns to it when the round resumes", async () => {
    const repoRoot = join(SCRATCH_ROOT, "reopen-epoch-repo");
    const campaignRoot = join(repoRoot, "campaigns", MANIFEST.slug);
    mkdirSync(campaignRoot, { recursive: true });
    // A spent budget returns immediately after epoch selection, so the epoch binding is exercised
    // without opening a Builder session.
    setTurnBudget(campaignRoot, 1);
    campaignBudgetGate(campaignRoot).startAttempt("builder").complete();
    const kickoff = "Build a truss harness: every joint must carry its declared load.";
    const build = await buildHarness(MANIFEST, { repoRoot, kickoff });
    const reopen = await buildHarness(MANIFEST, { repoRoot, kickoff, epochPass: "c".repeat(64) });
    const resumed = await buildHarness(MANIFEST, { repoRoot, kickoff, epochPass: "c".repeat(64) });
    expect(build.buildAdmissible).toBe(false);
    expect(reopen.epoch.key).not.toBe(build.epoch.key);
    expect(reopen.epoch.dir).not.toBe(build.epoch.dir);
    expect(reopen.epoch.supersedes).toBe(build.epoch.key);
    expect(resumed.epoch.key).toBe(reopen.epoch.key);
  });

  it.concurrent("requires the direct kickoff without reading an on-disk request bundle", async () => {
    const repoRoot = join(SCRATCH_ROOT, "direct-repo");
    const manifest = { slug: "direct-hardware", domain: "direct-hardware", expectedTasks: 25 };
    await expect(buildHarness(manifest, { repoRoot })).rejects.toThrow(/requires the direct user kickoff/);
    expect(existsSync(join(repoRoot, "asks"))).toBe(false);
  });
});

// Which slot a repository resolves is `resolve.test.ts`'s; what the build adds is the entrypoint's
// effort and model laid over the resolved Builder slot, and nothing over the other two.
describe("the Builder condition a build records", () => {
  it.concurrent("keeps the resolved effort, and lays an entrypoint effort and model over it", () => {
    const repoRoot = join(SCRATCH_ROOT, "condition");
    mkdirSync(repoRoot, { recursive: true });
    const resolvedSlots = resolveSlots(repoRoot, MANIFEST.slug, loadRepoEnv(repoRoot, {}));
    const declared = resolveBuilderCondition(MANIFEST, { resolvedSlots }, repoRoot);
    expect(declared.builder.reasoningEffort).toBe(resolvedSlots.builder.reasoningEffort);
    const pinned = resolveBuilderCondition(
      MANIFEST,
      { resolvedSlots, effort: "high", model: "pinned" },
      repoRoot,
    );
    expect(pinned.builder).toMatchObject({
      kind: resolvedSlots.builder.kind,
      model: "pinned",
      reasoningEffort: "high",
    });
    expect(pinned.slots.builder).toMatchObject({ model: "pinned", reasoningEffort: "high" });
    expect(pinned.slots.built).toEqual(resolvedSlots.built);
  });
});
