import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { campaignBudgetGate, setTurnBudget } from "../src/run/campaign-budget.ts";
import { buildHarness, resolveBuilderSlots, withBuilderPin } from "../src/run/harness-build.ts";
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

describe("backend slot resolution for the campaign", () => {
  it.concurrent("resolves the builder to claude through the operator pin and records its model", () => {
    const repoRoot = join(SCRATCH_ROOT, "resolve-pinned");
    mkdirSync(join(repoRoot, ".harness", "backends"), { recursive: true });
    writeFileSync(
      join(repoRoot, ".harness", "backends", "bridge-truss.json"),
      JSON.stringify({ builder: { kind: "claude" } }),
    );
    const slots = resolveBuilderSlots(repoRoot, "bridge-truss", {});
    expect(slots.builder).toEqual({ kind: "claude", model: "claude-opus-5", source: "operator" });
    // bridge-truss.json pins only the builder, so the built slot takes the declared default, which is now
    // claude for every slot instead of codex-by-first-position.
    expect(slots.built.kind).toBe("claude");
    expect(slots.review).toEqual({ enabled: false, source: "unconfigured" });
  });

  it.concurrent("resolves an explicit codex builder pin; an unpinned repo defaults to claude and passes", () => {
    // The unconfigured default now comes from the completeness matrix (builder → claude), so an
    // unpinned repository resolves a Builder here. This test does not open a provider session.
    const repoRoot = join(SCRATCH_ROOT, "resolve-unpinned");
    mkdirSync(repoRoot, { recursive: true });
    expect(resolveBuilderSlots(repoRoot, "bridge-truss", {}).builder).toEqual({
      kind: "claude",
      model: "claude-opus-5",
      source: "default",
    });
    // A codex builder pin resolves: every kind opens the one pi host session on the mounted roster
    // (builderSlot + builderSessionOpener).
    // The default stays claude — this row states support, never the default.
    expect(
      resolveBuilderSlots(repoRoot, "bridge-truss", { HARNESS_BUILDER_BACKEND: "codex" }).builder,
    ).toMatchObject({
      kind: "codex",
      source: "env",
    });
  });

  it.concurrent("resolves an openrouter builder pin through the env", () => {
    const repoRoot = join(SCRATCH_ROOT, "resolve-openrouter");
    mkdirSync(repoRoot, { recursive: true });
    expect(
      resolveBuilderSlots(repoRoot, "bridge-truss", {
        HARNESS_BUILDER_BACKEND: "openrouter",
        OPENROUTER_PROVIDER: "deepinfra",
      }).builder,
    ).toMatchObject({ kind: "openrouter", providerPin: ["deepinfra"], source: "env" });
  });

  it.concurrent("a default operator pin satisfies the entrypoint's own guard", () => {
    const repoRoot = join(SCRATCH_ROOT, "resolve-default-operator");
    mkdirSync(join(repoRoot, ".harness", "backends"), { recursive: true });
    writeFileSync(
      join(repoRoot, ".harness", "backends", "default.json"),
      JSON.stringify({ builder: { kind: "claude" }, built: { kind: "claude" }, review: { kind: "claude" } }),
    );
    const slots = resolveBuilderSlots(repoRoot, "bridge-truss", {});
    expect(slots.builder.kind).toBe("claude");
    expect(slots.builder.source).toBe("operator");
  });

  it.concurrent("records the entrypoint's builder effort when the resolver leaves it unset", () => {
    const repoRoot = join(import.meta.dir, "..");
    const slots = resolveBuilderSlots(repoRoot, "bridge-truss", {});
    expect(slots.builder.reasoningEffort).toBeUndefined();
    const denominated = withBuilderPin(slots, { effort: "medium" });
    expect(denominated.builder).toMatchObject({ kind: "claude", reasoningEffort: "medium" });
  });
});
