/** The slot preflight a run records before any paid turn: host slots read the catalogue, not the
 *  provider, and a missing host login refuses before the Built worker spawns. */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { EnvironmentRefusal } from "../src/backends/environment-refusal.ts";
import type { ModelSelectionEvidence } from "../src/backends/model-selection.ts";
import type { PiBuiltRuntime } from "../src/backends/pi-built.ts";
import type { PiSlotChoice } from "../src/backends/pi-providers.ts";
import type { ReviewChoice } from "../src/backends/resolve.ts";
import { builtSolveIsolation } from "../src/run/built-agent-runtime.ts";
import { preflightCampaignModels } from "../src/run/model-preflight.ts";
import { double } from "./helpers/doubles.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const MODEL = "openai/gpt-4o-mini";
const CATALOGUE: ModelSelectionEvidence = {
  resolvedModel: MODEL,
  effort: "off",
  source: "pi-provider-catalogue",
};
const BUILDER: PiSlotChoice = { kind: "openrouter", model: MODEL, reasoningEffort: "off" };
const REVIEW: ReviewChoice = {
  enabled: true,
  kind: "openrouter",
  model: MODEL,
  reasoningEffort: "off",
  source: "operator",
};
const CLAUDE_REVIEW: ReviewChoice = {
  enabled: true,
  kind: "claude",
  model: "claude-opus-5",
  reasoningEffort: "high",
  source: "operator",
};
const NO_REVIEW: ReviewChoice = { enabled: false, source: "operator" };

afterAll(cleanupScratch);

/** A repository whose `.env` is the only credential source; the test preload strips the process's. */
function repoWith(env: Record<string, string>): string {
  const root = scratchDir("ana-model-preflight-");
  writeFileSync(
    join(root, ".env"),
    Object.entries(env)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
  return root;
}

/** The real Built runtime on the openrouter transport: its credential is already resolved, and its
 *  preflight starts the confined worker without a provider turn. */
function builtRuntime(repoRoot: string): PiBuiltRuntime {
  return {
    profile: { provider: "openrouter", transport: "openrouter", model: MODEL, thinkingLevel: "off" },
    auth: async () => ({ type: "api_key", key: "fake-built-preflight-key" }),
    policy: builtSolveIsolation(repoRoot),
  };
}

/** A Built runtime that records any read, so a refusal can show the worker was never started. */
function untouchedBuilt(touched: string[]): PiBuiltRuntime {
  const read = (field: string) => () => {
    touched.push(field);
    throw new Error(`the Built runtime's ${field} was read`);
  };
  return double<PiBuiltRuntime>(
    Object.defineProperties(
      {},
      {
        profile: { get: read("profile") },
        auth: { get: read("auth") },
        policy: { get: read("policy") },
      },
    ),
  );
}

describe("preflightCampaignModels", () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  beforeEach(() => {
    fetches = 0;
    globalThis.fetch = Object.assign(
      async (): Promise<Response> => {
        fetches += 1;
        return new Response("no provider call is expected", { status: 599 });
      },
      { preconnect: () => {} },
    );
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("clears both host slots from the catalogue without a provider call, then starts the Built worker", async () => {
    const repoRoot = repoWith({ OPENROUTER_API_KEY: "fake-host-key" });
    const result = await preflightCampaignModels({
      builder: BUILDER,
      review: REVIEW,
      repoRoot,
      builtRuntime: builtRuntime(repoRoot),
    });
    expect(fetches).toBe(0);
    expect(result.modelSelections).toEqual({ builder: CATALOGUE, built: CATALOGUE, review: CATALOGUE });
    expect(result.builtSession.role).toBe("built");
    expect(result.builtSession.confinedPid).toBeGreaterThan(0);
    expect(result.hostRuntime.name).toBe("bun");
  });

  it("refuses a missing Builder credential before the Built worker starts", async () => {
    const touched: string[] = [];
    const work = preflightCampaignModels({
      builder: BUILDER,
      review: NO_REVIEW,
      repoRoot: repoWith({}),
      builtRuntime: untouchedBuilt(touched),
    });
    await expect(work).rejects.toThrow("OPENROUTER_API_KEY is required for the openrouter transport");
    await expect(work).rejects.toBeInstanceOf(EnvironmentRefusal);
    expect(touched).toEqual([]);
    expect(fetches).toBe(0);
  });

  it("refuses a missing review credential before the Built worker starts", async () => {
    const touched: string[] = [];
    const work = preflightCampaignModels({
      builder: BUILDER,
      review: CLAUDE_REVIEW,
      repoRoot: repoWith({ OPENROUTER_API_KEY: "fake-host-key" }),
      builtRuntime: untouchedBuilt(touched),
    });
    await expect(work).rejects.toThrow("CLAUDE_CODE_OAUTH_TOKEN is required for the claude transport");
    expect(touched).toEqual([]);
  });

  it("skips the Builder slot in the measurement phase, so its missing credential does not refuse", async () => {
    const repoRoot = repoWith({});
    const result = await preflightCampaignModels({
      builder: BUILDER,
      review: NO_REVIEW,
      repoRoot,
      builtRuntime: builtRuntime(repoRoot),
      phase: "measurement",
    });
    expect(result.modelSelections).toEqual({ builder: null, built: CATALOGUE, review: null });
    expect(fetches).toBe(0);
  });

  it("records no review selection when the review slot is disabled", async () => {
    const repoRoot = repoWith({ OPENROUTER_API_KEY: "fake-host-key" });
    const result = await preflightCampaignModels({
      builder: BUILDER,
      review: NO_REVIEW,
      repoRoot,
      builtRuntime: builtRuntime(repoRoot),
    });
    expect(result.modelSelections).toEqual({ builder: CATALOGUE, built: CATALOGUE, review: null });
  });

  it("resolves the review slot from the shared account token", async () => {
    const touched: string[] = [];
    const work = preflightCampaignModels({
      builder: BUILDER,
      review: CLAUDE_REVIEW,
      repoRoot: repoWith({
        OPENROUTER_API_KEY: "fake-host-key",
        CLAUDE_CODE_OAUTH_TOKEN: "fake-review-token",
      }),
      builtRuntime: untouchedBuilt(touched),
    });
    // Both host slots cleared, so the next read is the Built runtime's, which this double refuses.
    await expect(work).rejects.toThrow("the Built runtime's profile was read");
    expect(touched).toEqual(["profile"]);
    expect(fetches).toBe(0);
  });
});
