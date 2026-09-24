import type { JsonValue } from "../src/meta/json-shape.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { loadRepoEnv } from "../src/backends/env.ts";
import type { OptionalEnvValues } from "../src/backends/scrub-env.ts";
import {
  BACKEND_KINDS,
  backendPinOf,
  defaultEffortOf,
  defaultModelOf,
  resolveSlots,
} from "../src/backends/resolve.ts";

const dirs: string[] = [];
/** Builder and Built slots set to Claude so these tests can vary review selection alone. */
const RUNNABLE_SIDES = { HARNESS_BUILDER_BACKEND: "claude", HARNESS_BUILT_BACKEND: "claude" };

function repo(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "ana-broker-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function operatorFile(slug: string, config: JsonValue) {
  return { [`.harness/backends/${slug}.json`]: JSON.stringify(config) };
}

describe("one env loader", () => {
  it("process env wins over files; earlier file wins over later; process.env is never mutated", () => {
    const root = repo({
      ".env.cloud": "FROM_CLOUD=cloud\nSHADOWED=cloud\n",
      ".env.local": "FROM_LOCAL=local\nSHADOWED=local\n",
      ".env": "FROM_BASE=base\nSHADOWED=base\n",
    });
    const processEnv = { SHADOWED: "process" } satisfies OptionalEnvValues;
    const { env, sources } = loadRepoEnv(root, processEnv);
    expect(env.SHADOWED).toBe("process");
    expect(env.FROM_CLOUD).toBe("cloud");
    expect(env.FROM_LOCAL).toBe("local");
    expect(env.FROM_BASE).toBe("base");
    expect(sources).toMatchObject({ SHADOWED: "process", FROM_LOCAL: ".env.local" });
    expect(Object.keys(processEnv)).toEqual(["SHADOWED"]);
  });

  it("parses quoted environment values and trailing comments", () => {
    const root = repo({ ".env": '# comment\nQUOTED="a value" # trailing\n' });
    const { env } = loadRepoEnv(root, {});
    expect(env.QUOTED).toBe("a value");
  });

  it("refuses an unreadable env path instead of replacing its intended pins with defaults", () => {
    const root = repo();
    mkdirSync(join(root, ".env"));
    expect(() => loadRepoEnv(root, {})).toThrow(/\.env cannot be read/);
  });
});

describe("slot resolution", () => {
  it("defaults unconfigured Builder and Built slots to Claude", () => {
    // SLOT_DEFAULTS declares defaults separately from the list of supported backends. Previously,
    // changing the first supported entry also changed the default provider. Run 4 recorded
    // `backendPin: codex/gpt-5.5` when the operator intended Claude, without a recorded selection
    // source to explain the difference. An earlier live-run-02 also failed preflight because
    // the then-default Codex Builder lacked the required author-session implementation.
    // These historical failures motivate an explicit default; this test checks the resolved
    // Builder and Built values and their selection source.
    const root = repo();
    const slots = resolveSlots(root, "s1", loadRepoEnv(root, {}));
    expect(slots.builder).toEqual({
      kind: "claude",
      model: "claude-opus-5",
      reasoningEffort: "medium",
      source: "default",
    });
    expect(slots.built).toEqual({
      kind: "claude",
      model: "claude-opus-5",
      reasoningEffort: "medium",
      source: "default",
    });
    expect(backendPinOf(slots)).toBe("claude/claude-opus-5");
  });

  it("an explicit codex pin resolves as codex, never by falling through to Claude", () => {
    const root = repo(operatorFile("s1", { built: { kind: "codex" } }));
    const env = loadRepoEnv(root, {
      HARNESS_BUILDER_BACKEND: "claude",
      CODEX_BUILT_MODEL: "gpt-5.5",
      CODEX_BUILT_REASONING_EFFORT: "medium",
    });
    expect(resolveSlots(root, "s1", env).built).toEqual({
      kind: "codex",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      source: "operator",
    });
  });

  it("includes the OpenRouter provider route in each slot and the Built comparison identity", () => {
    const root = repo();
    const slots = resolveSlots(
      root,
      "s1",
      loadRepoEnv(root, {
        HARNESS_BUILDER_BACKEND: "openrouter",
        HARNESS_BUILT_BACKEND: "openrouter",
        HARNESS_REVIEW_BACKEND: "openrouter",
        OPENROUTER_PROVIDER: "deepinfra,together",
      }),
    );
    expect(slots.builder.providerPin).toEqual(["deepinfra", "together"]);
    expect(slots.built.providerPin).toEqual(["deepinfra", "together"]);
    expect(slots.review).toMatchObject({ providerPin: ["deepinfra", "together"] });
    expect(backendPinOf(slots)).toContain("@providers=deepinfra,together");
  });

  it("defaults every Codex slot to Luna xhigh", () => {
    const root = repo(
      operatorFile("s1", {
        builder: { kind: "codex" },
        built: { kind: "codex" },
        review: { kind: "codex" },
      }),
    );
    const slots = resolveSlots(root, "s1", loadRepoEnv(root, {}));
    expect(slots.builder).toMatchObject({
      kind: "codex",
      model: "gpt-5.6-luna",
      reasoningEffort: "xhigh",
    });
    expect(slots.built).toMatchObject({
      kind: "codex",
      model: "gpt-5.6-luna",
      reasoningEffort: "xhigh",
    });
    expect(slots.review).toMatchObject({
      enabled: true,
      kind: "codex",
      model: "gpt-5.6-luna",
      reasoningEffort: "xhigh",
    });
  });

  it("keeps the generic Codex model override above the Builder default", () => {
    const root = repo(operatorFile("s1", { builder: { kind: "codex" } }));
    const slots = resolveSlots(root, "s1", loadRepoEnv(root, { CODEX_MODEL: "gpt-5.6-sol" }));
    expect(slots.builder).toMatchObject({
      kind: "codex",
      model: "gpt-5.6-sol",
      reasoningEffort: "xhigh",
    });
  });

  it("pins Codex builder, built, and review models independently by named slot env", () => {
    const root = repo();
    const slots = resolveSlots(
      root,
      "s1",
      loadRepoEnv(root, {
        HARNESS_BUILDER_BACKEND: "codex",
        HARNESS_BUILT_BACKEND: "codex",
        HARNESS_REVIEW_BACKEND: "codex",
        CODEX_BUILDER_MODEL: "gpt-5.6-builder",
        CODEX_BUILT_MODEL: "gpt-5.5",
        CODEX_REVIEW_MODEL: "gpt-5.5-judge",
        CODEX_BUILDER_REASONING_EFFORT: "xhigh",
        CODEX_BUILT_REASONING_EFFORT: "medium",
        CODEX_REVIEW_REASONING_EFFORT: "low",
      }),
    );
    expect(slots.builder).toMatchObject({
      kind: "codex",
      model: "gpt-5.6-builder",
      reasoningEffort: "xhigh",
    });
    expect(slots.built).toMatchObject({ kind: "codex", model: "gpt-5.5", reasoningEffort: "medium" });
    expect(slots.review).toMatchObject({
      enabled: true,
      kind: "codex",
      model: "gpt-5.5-judge",
      reasoningEffort: "low",
    });
  });

  it("pins Claude builder, built, and review efforts independently by named slot env", () => {
    const root = repo();
    const claudeKinds = {
      HARNESS_BUILDER_BACKEND: "claude",
      HARNESS_BUILT_BACKEND: "claude",
      HARNESS_REVIEW_BACKEND: "claude",
    };
    const slots = resolveSlots(
      root,
      "s1",
      loadRepoEnv(root, {
        ...claudeKinds,
        CLAUDE_BUILDER_REASONING_EFFORT: "xhigh",
        CLAUDE_BUILT_REASONING_EFFORT: "xhigh",
        CLAUDE_REVIEW_REASONING_EFFORT: "xhigh",
      }),
    );
    expect(slots.builder).toMatchObject({
      kind: "claude",
      model: "claude-opus-5",
      reasoningEffort: "xhigh",
    });
    expect(slots.built).toMatchObject({
      kind: "claude",
      model: "claude-opus-5",
      reasoningEffort: "xhigh",
    });
    expect(slots.review).toMatchObject({
      enabled: true,
      kind: "claude",
      model: "claude-opus-5",
      reasoningEffort: "xhigh",
    });
    // With no explicit Claude effort, resolution records the declared default rather than leaving
    // each consumer to pick its own, so the condition a slot reports is the one it serves.
    const bare = resolveSlots(root, "s1", loadRepoEnv(root, { ...claudeKinds }));
    expect(bare.builder.reasoningEffort).toBe("medium");
    expect(bare.built.reasoningEffort).toBe("medium");
    expect(bare.review).toMatchObject({ enabled: true, reasoningEffort: "high" });
  });

  it("resolves Claude Builder, Codex Built, and Claude review independently", () => {
    const root = repo();
    const slots = resolveSlots(
      root,
      "s1",
      loadRepoEnv(root, {
        HARNESS_BUILDER_BACKEND: "claude",
        HARNESS_BUILT_BACKEND: "codex",
        HARNESS_REVIEW_BACKEND: "claude",
        CLAUDE_BUILDER_MODEL: "claude-builder",
        CODEX_BUILT_MODEL: "gpt-built",
        CLAUDE_REVIEW_MODEL: "claude-judge",
      }),
    );
    expect(slots.builder).toMatchObject({ kind: "claude", model: "claude-builder" });
    expect(slots.built).toMatchObject({ kind: "codex", model: "gpt-built" });
    expect(slots.review).toMatchObject({ enabled: true, kind: "claude", model: "claude-judge" });
    expect(backendPinOf(slots)).toBe("codex/gpt-built");
  });

  it("resolves all eight Claude/Codex Builder, Built, and review combinations independently", () => {
    const kinds = ["claude", "codex"] as const;
    const env = {
      CLAUDE_BUILDER_MODEL: "claude-builder",
      CLAUDE_BUILT_MODEL: "claude-built",
      CLAUDE_REVIEW_MODEL: "claude-judge",
      CODEX_BUILDER_MODEL: "codex-builder",
      CODEX_BUILT_MODEL: "codex-built",
      CODEX_REVIEW_MODEL: "codex-judge",
    };
    for (const builder of kinds) {
      for (const built of kinds) {
        for (const review of kinds) {
          const root = repo(
            operatorFile("s1", {
              builder: { kind: builder },
              built: { kind: built },
              review: { kind: review },
            }),
          );
          const slots = resolveSlots(root, "s1", loadRepoEnv(root, env));
          expect(slots.builder).toMatchObject({ kind: builder, model: `${builder}-builder` });
          expect(slots.built).toMatchObject({ kind: built, model: `${built}-built` });
          expect(slots.review).toMatchObject({ enabled: true, kind: review, model: `${review}-judge` });
          expect(backendPinOf(slots)).toBe(`${built}/${built}-built`);
        }
      }
    }
  });

  it("a Claude selection resolves its default model and records the selection source", () => {
    const root = repo();
    const env = loadRepoEnv(root, {
      HARNESS_BUILDER_BACKEND: "claude",
      HARNESS_BUILT_BACKEND: "claude",
    });
    const slots = resolveSlots(root, "s1", env);
    expect(slots.built).toEqual({
      kind: "claude",
      model: "claude-opus-5",
      reasoningEffort: "medium",
      source: "env",
    });
    expect(backendPinOf(slots)).toBe("claude/claude-opus-5");
  });

  it("operator file outranks env; env outranks default; provenance is recorded", () => {
    const root = repo(operatorFile("s1", { built: { kind: "claude" } }));
    const env = loadRepoEnv(root, {
      HARNESS_BUILT_BACKEND: "codex",
      HARNESS_BUILDER_BACKEND: "claude",
    });
    const slots = resolveSlots(root, "s1", env);
    expect(slots.built).toMatchObject({ kind: "claude", source: "operator", model: "claude-opus-5" });
    expect(slots.builder).toMatchObject({ kind: "claude", source: "env" });
  });

  it("lists the three supported backend kinds", () => {
    // Earlier source cuts removed particular transport implementations. OpenRouter later
    // returned through a different implementation, so those removals do not forbid its
    // backend name. This assertion checks the current selection list.
    expect(BACKEND_KINDS).toEqual(["codex", "openrouter", "claude"]);
  });

  it("rejects a model field in the selection file; environment settings choose the model", () => {
    const root = repo(operatorFile("s1", { built: { kind: "claude", model: "sneaky" } }));
    const env = loadRepoEnv(root, { HARNESS_BUILDER_BACKEND: "claude" });
    expect(() => resolveSlots(root, "s1", env)).toThrow(/built\.model/);
  });

  it("rejects an unknown backend kind", () => {
    const root = repo(operatorFile("s1", { built: { kind: "codexx" } }));
    const env = loadRepoEnv(root, { HARNESS_BUILDER_BACKEND: "claude" });
    expect(() => resolveSlots(root, "s1", env)).toThrow(/unknown backend kind/);
  });

  it("refuses misspelled slot and field names before they can fall through", () => {
    const misspelledSlot = repo(operatorFile("s1", { buidler: { kind: "codex" } }));
    expect(() => resolveSlots(misspelledSlot, "s1", loadRepoEnv(misspelledSlot, {}))).toThrow(
      /unknown slot.*buidler/,
    );
    const misspelledField = repo(operatorFile("s1", { builder: { knd: "codex" } }));
    expect(() => resolveSlots(misspelledField, "s1", loadRepoEnv(misspelledField, {}))).toThrow(
      /builder has unknown field.*knd/,
    );
  });

  it("refuses review-only inheritance on a verified slot", () => {
    const root = repo(operatorFile("s1", { builder: { inherit: true } }));
    expect(() => resolveSlots(root, "s1", loadRepoEnv(root, {}))).toThrow(/builder\.inherit is review-only/);
  });
});

describe("the review slot never silently inherits", () => {
  it("disables an unconfigured review slot", () => {
    const root = repo();
    const slots = resolveSlots(root, "s1", loadRepoEnv(root, { ...RUNNABLE_SIDES }));
    expect(slots.review).toEqual({ enabled: false, source: "unconfigured" });
  });

  it("explicit inherit via operator file carries inherited-explicit provenance", () => {
    const root = repo(operatorFile("s1", { review: { inherit: true } }));
    const slots = resolveSlots(root, "s1", loadRepoEnv(root, { ...RUNNABLE_SIDES }));
    expect(slots.review).toEqual({
      enabled: true,
      kind: "claude",
      model: "claude-opus-5",
      reasoningEffort: "medium",
      source: "inherited-explicit",
    });
  });

  it("explicit inherit via HARNESS_REVIEW_BACKEND=inherit works the same", () => {
    const root = repo();
    const slots = resolveSlots(
      root,
      "s1",
      loadRepoEnv(root, { ...RUNNABLE_SIDES, HARNESS_REVIEW_BACKEND: "inherit" }),
    );
    expect(slots.review).toMatchObject({ enabled: true, source: "inherited-explicit" });
  });

  it("inherits the Built provider route whether the file or the environment asks", () => {
    // The environment spelling once copied kind, model and effort but dropped providerPin, so an
    // inherited review of a pinned OpenRouter battery ran on an unconstrained route while the file
    // spelling of the same choice kept it.
    const pinned = {
      HARNESS_BUILDER_BACKEND: "claude",
      HARNESS_BUILT_BACKEND: "openrouter",
      OPENROUTER_PROVIDER: "hostA,hostB",
    };
    const viaFile = repo(operatorFile("s1", { review: { inherit: true } }));
    const viaEnv = repo();
    const fromFile = resolveSlots(viaFile, "s1", loadRepoEnv(viaFile, pinned)).review;
    const fromEnv = resolveSlots(
      viaEnv,
      "s1",
      loadRepoEnv(viaEnv, { ...pinned, HARNESS_REVIEW_BACKEND: "inherit" }),
    ).review;
    expect(fromEnv).toMatchObject({
      kind: "openrouter",
      providerPin: ["hostA", "hostB"],
      reasoningEffort: "off",
    });
    expect(fromEnv).toEqual(fromFile);
  });

  it("rejects a misspelled review backend", () => {
    const root = repo();
    const env = loadRepoEnv(root, { ...RUNNABLE_SIDES, HARNESS_REVIEW_BACKEND: "claud" });
    expect(() => resolveSlots(root, "s1", env)).toThrow(/unknown backend kind/);
  });

  it("a Codex review selection resolves its own model and effort", () => {
    const root = repo();
    const env = loadRepoEnv(root, { ...RUNNABLE_SIDES, HARNESS_REVIEW_BACKEND: "codex" });
    expect(resolveSlots(root, "s1", env).review).toMatchObject({
      enabled: true,
      kind: "codex",
      model: "gpt-5.6-luna",
      reasoningEffort: "xhigh",
    });
  });

  it("an empty review object is ambiguous and errors", () => {
    const root = repo(operatorFile("s1", { review: {} }));
    expect(() => resolveSlots(root, "s1", loadRepoEnv(root, { ...RUNNABLE_SIDES }))).toThrow(/ambiguous/);
  });

  it("refuses conflicting or false review selection markers", () => {
    const conflicting = repo(operatorFile("s1", { review: { kind: "claude", inherit: true } }));
    expect(() => resolveSlots(conflicting, "s1", loadRepoEnv(conflicting, RUNNABLE_SIDES))).toThrow(
      /choose exactly one/,
    );
    const falseMarker = repo(operatorFile("s1", { review: { disabled: false } }));
    expect(() => resolveSlots(falseMarker, "s1", loadRepoEnv(falseMarker, RUNNABLE_SIDES))).toThrow(
      /review\.disabled must be true/,
    );
  });

  it("an explicit review kind resolves its own model (REVIEW_MODEL first)", () => {
    const root = repo(operatorFile("s1", { review: { kind: "claude" } }));
    const slots = resolveSlots(
      root,
      "s1",
      loadRepoEnv(root, { ...RUNNABLE_SIDES, REVIEW_MODEL: "claude-haiku-4-5" }),
    );
    expect(slots.review).toMatchObject({
      enabled: true,
      kind: "claude",
      model: "claude-haiku-4-5",
      source: "operator",
    });
  });

  it("rejects a review model in the selection file; environment settings choose the model", () => {
    const root = repo(operatorFile("s1", { review: { kind: "codex", model: "sneaky" } }));
    expect(() => resolveSlots(root, "s1", loadRepoEnv(root, RUNNABLE_SIDES))).toThrow(/review\.model/);
  });
});

describe("a selection file a prompt-driven run can actually reach", () => {
  // Run 4 measured with its review roles disabled while the intended selection sat in a file
  // named for the request. The generated campaign slug includes a prompt hash, which makes
  // a default selection file useful before the operator has resolved the exact slug.
  const unnameable = "regional-route-planning-e289e0f9";

  it("default.json carries the selection when no slug-specific file exists", () => {
    const root = repo({
      ".harness/backends/default.json": JSON.stringify({ review: { kind: "claude" } }),
    });
    const slots = resolveSlots(root, unnameable, loadRepoEnv(root, { ...RUNNABLE_SIDES }));
    expect(slots.review).toMatchObject({ enabled: true, kind: "claude", source: "operator" });
    expect(slots.operatorConfig).toBe(".harness/backends/default.json");
  });

  it("a slug-specific file still wins over default.json", () => {
    const root = repo({
      ...operatorFile("s1", { review: { kind: "claude" } }),
      ".harness/backends/default.json": JSON.stringify({ review: { inherit: true } }),
    });
    const slots = resolveSlots(root, "s1", loadRepoEnv(root, { ...RUNNABLE_SIDES }));
    expect(slots.review).toMatchObject({ source: "operator" });
    expect(slots.operatorConfig).toBe(".harness/backends/s1.json over .harness/backends/default.json");
  });

  it("applies project overrides per slot and keeps defaults for the other slots", () => {
    // Run 15 (2026-07-28): `--built-backend claude` on a fresh project wrote {built} alone, that
    // key shadowed the whole default, and 50 measured cases recorded judge:"off" with no control
    // census. A slot nobody named takes the standing default instead of vanishing.
    const root = repo({
      ...operatorFile("s1", { built: { kind: "claude" } }),
      ".harness/backends/default.json": JSON.stringify({
        builder: { kind: "codex" },
        built: { kind: "codex" },
        review: { kind: "claude" },
      }),
    });
    const slots = resolveSlots(root, "s1", loadRepoEnv(root, { ...RUNNABLE_SIDES }));
    expect(slots.built).toMatchObject({ kind: "claude", source: "operator" });
    expect(slots.builder).toMatchObject({ kind: "codex", source: "operator" });
    expect(slots.review).toMatchObject({ enabled: true, kind: "claude", source: "operator" });
  });

  it("an explicit review off survives the layering that an absent key does not", () => {
    const root = repo({
      ...operatorFile("s1", { review: { disabled: true } }),
      ".harness/backends/default.json": JSON.stringify({ review: { kind: "claude" } }),
    });
    const slots = resolveSlots(root, "s1", loadRepoEnv(root, { ...RUNNABLE_SIDES }));
    // `operator` instead of `unconfigured`: the caller about to spend a battery warns only on
    // the silent one, so a chosen off must not read as nobody's decision.
    expect(slots.review).toEqual({ enabled: false, source: "operator" });
  });

  it("refuses an off switch on a verified slot instead of resolving it to the default", () => {
    // The review slot has an off state and the verified slots do not. Ignoring the key would resolve
    // `built` to claude with nothing on the evidence saying the operator asked for anything else —
    // a silent slot substitution, which is the class the whole resolver exists to refuse.
    const root = repo(operatorFile("s1", { built: { disabled: true } }));
    expect(() => resolveSlots(root, "s1", loadRepoEnv(root, { ...RUNNABLE_SIDES }))).toThrow(
      /built\.disabled is review-only/,
    );
  });

  it("no selection file at all leaves operatorConfig null, so the fallback to defaults is stated", () => {
    const root = repo();
    const slots = resolveSlots(root, unnameable, loadRepoEnv(root, {}));
    expect(slots.operatorConfig).toBeNull();
    expect(slots.builder.source).toBe("default");
    expect(slots.review).toEqual({ enabled: false, source: "unconfigured" });
  });

  it("default.json is validated like any selection file, never silently ignored", () => {
    const root = repo({ ".harness/backends/default.json": JSON.stringify(["claude"]) });
    expect(() => resolveSlots(root, "s1", loadRepoEnv(root, { ...RUNNABLE_SIDES }))).toThrow(
      /must be a JSON object/,
    );
  });

  it("reads a comment beside a slot, so the file can say which condition it is", () => {
    // Backend files can differ only in their three `kind` values, so a comment helps name the
    // intended condition. The JSON5 reader accepts the existing JSON files and also permits
    // comments beside slot declarations. The fixture checks that these comments do not change
    // the resolved selection or its recorded source.
    const root = repo({
      ".harness/backends/default.json": [
        "{",
        "  // The Opus 5 condition: all three slots on claude.",
        '  "builder": { "kind": "claude" },',
        '  "built": { "kind": "claude" },',
        '  "review": { "kind": "claude" },',
        "}",
      ].join("\n"),
    });
    const slots = resolveSlots(root, unnameable, loadRepoEnv(root, { ...RUNNABLE_SIDES }));
    expect(slots.builder).toMatchObject({ kind: "claude", source: "operator" });
    expect(slots.review).toMatchObject({ enabled: true, kind: "claude", source: "operator" });
  });

  it("still refuses bytes that are not a selection file at all", () => {
    // The added spellings are syntax, not tolerance: a truncated or hand-mangled file refuses
    // before a provider default can stand in for the operator's intended condition.
    const root = repo({ ".harness/backends/default.json": '{ "builder": ' });
    expect(() => resolveSlots(root, "s1", loadRepoEnv(root, { ...RUNNABLE_SIDES }))).toThrow();
  });

  it("refuses an unreadable selection path instead of replacing it with defaults", () => {
    const root = repo();
    mkdirSync(join(root, ".harness/backends/default.json"), { recursive: true });
    expect(() => resolveSlots(root, "s1", loadRepoEnv(root, RUNNABLE_SIDES))).toThrow(
      /default\.json cannot be read/,
    );
  });
});

// The slot was renamed from `judge` to `review` on 2026-08-19. The old environment variable
// does not configure the review slot; it remains `unconfigured`, which differs from an explicit
// off selection. Run 15 recorded judge:"off" across 50 measured cases after review configuration
// was lost, so the distinction needs to remain visible to callers. The old operator-file key
// refuses, like any unknown slot.
describe("the former slot name is gone", () => {
  it("leaves the review slot unconfigured when only HARNESS_JUDGE_BACKEND is set", () => {
    const root = repo();
    const slots = resolveSlots(
      root,
      "s1",
      loadRepoEnv(root, { ...RUNNABLE_SIDES, HARNESS_JUDGE_BACKEND: "claude" }),
    );
    expect(slots.review).toEqual({ enabled: false, source: "unconfigured" });
  });

  it("refuses an operator file that still names the judge key", () => {
    const root = repo(operatorFile("s1", { judge: { kind: "claude" } }));
    expect(() => resolveSlots(root, "s1", loadRepoEnv(root, { ...RUNNABLE_SIDES }))).toThrow(
      /unknown slot\(s\) \[judge\]/,
    );
  });

  it("reads the current name from the same file", () => {
    const root = repo(operatorFile("s1", { review: { kind: "claude" } }));
    const slots = resolveSlots(root, "s1", loadRepoEnv(root, { ...RUNNABLE_SIDES }));
    expect(slots.review.enabled).toBe(true);
  });
});

// An unpinned codex slot silently chooses what the run measures, and until this block nothing
// asserted which model that is. The equality against the descriptor is the real guard: a second
// table layered over the registry would satisfy the literals below while making the registry's
// own declared default unreachable, which is what these three assertions exist to refuse.
describe("the unpinned codex default has one owner", () => {
  const CODEX_SIDES = {
    HARNESS_BUILDER_BACKEND: "codex",
    HARNESS_BUILT_BACKEND: "codex",
    HARNESS_REVIEW_BACKEND: "codex",
  };

  const codexDefaults = () => ({ model: defaultModelOf("codex"), effort: defaultEffortOf("codex", "built") });

  it("resolves the descriptor's declared model and effort on all three slots", () => {
    const root = repo();
    const slots = resolveSlots(root, "s1", loadRepoEnv(root, { ...CODEX_SIDES }));
    const declared = codexDefaults();
    for (const slot of [slots.builder, slots.built] as const) {
      expect(slot.model).toBe(declared.model);
      expect(slot.reasoningEffort).toBe(declared.effort);
    }
    expect(slots.review.enabled).toBe(true);
    if (!slots.review.enabled) throw new Error("review slot resolved disabled under an explicit pin");
    expect(slots.review.model).toBe(declared.model);
    expect(slots.review.reasoningEffort).toBe(declared.effort);
  });

  it("names that default as the measured condition, so a change to it is a change to every unpinned run", () => {
    expect(defaultModelOf("codex")).toBe("gpt-5.6-luna");
    for (const slot of ["builder", "built", "review"] as const) {
      expect(defaultEffortOf("codex", slot)).toBe("xhigh");
    }
  });

  it("still lets a per-slot env pin beat the default", () => {
    const root = repo();
    const slots = resolveSlots(
      root,
      "s1",
      loadRepoEnv(root, {
        ...CODEX_SIDES,
        CODEX_BUILT_MODEL: "gpt-5.6-sol",
        CODEX_BUILT_REASONING_EFFORT: "high",
      }),
    );
    expect(slots.built.model).toBe("gpt-5.6-sol");
    expect(slots.built.reasoningEffort).toBe("high");
    expect(slots.builder.model).toBe(codexDefaults().model);
  });
});
