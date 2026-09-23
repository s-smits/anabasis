/**
 * A cut only stays cut if something notices when it comes back. Deleting a module leaves no trace
 * in the suite, so a later author who needs the shape it held can reintroduce it, wire it up and
 * still pass everything else. Each case below names one removed thing and asserts its absence: the
 * harness-verb tools, the subagent and web-search tools, the flat edit-argument shim, the broker
 * origin variable, the `HARNESS_INNER_UNSANDBOXED` sandbox bypass, the three per-kind backends, the
 * run journal, the synthetic run events, the record projections, and the ten modules and seven
 * producer calls of the multi-session authoring workflow.
 *
 * Absence is read two ways, because the two ways a cut comes back are different. `existsSync`
 * catches a module restored as a file, and `scanTokens` over the owning source catches the call or
 * the literal restored without one, which is what happens when a producer is re-added inline and
 * the deleted path stays deleted. The Builder-toolkit cases also call the real `createBuilderTools`
 * rather than scanning it, because the roster is what a model actually sees and no token scan can
 * say what the function returned.
 */
import { existsSync, readFileSync } from "../src/meta/filesystem.ts";
import { describe, expect, it } from "bun:test";
import type { PathRecord } from "../src/builder/candidate-isolation-runtime.ts";
import {
  CANDIDATE_ISOLATION_SCHEMA,
  type CandidateAccessPolicy,
} from "../src/builder/candidate-isolation.ts";
import { type BuilderIsolation, createBuilderTools } from "../src/builder/tools.ts";
import { scanTokens } from "../tools/loc/token-facts.ts";

const source = (path: string) => scanTokens(readFileSync(path, "utf8"));

const toolsSource = () => readFileSync("src/builder/tools.ts", "utf8");

// What the cases below read are contract facts — the roster, the options shape, and a refusal that
// lands before any file is touched — so a hand-built policy value is enough and no tool here ever
// reaches an OS child. The `append` deliberately throws: if a case ever did reach the isolation,
// the throw says so rather than letting a silent write pass for a contract check. Isolation
// behaviour itself belongs elsewhere, to candidate-isolation-policy.test.ts against a fixture repo
// and to the darwin and linux files, which spawn real sandboxed children.
function stubIsolation(): BuilderIsolation {
  const policy: CandidateAccessPolicy = {
    schema: CANDIDATE_ISOLATION_SCHEMA,
    repoRoot: "/stub/repo",
    epochDir: "/stub/repo/campaigns/bb3/epoch-1",
    allow: { read: [], write: [], exec: [] },
    measuredNamePrefixes: [],
    network: "deny",
    profile: "candidate",
    scratchWriteRoots: [],
    readDenyRoots: [],
    writeDenyRoots: [],
    cellRuntimeRoots: [],
    digest: "stub-digest",
  };
  const record: PathRecord = {
    path: "/stub/record.jsonl",
    sessionId: "stub",
    append() {
      throw new Error("cuts tests never reach the isolation");
    },
    count: () => 0,
  };
  return { policy, record, workDir: "/stub/repo/campaigns/bb3/epoch-1/02-bb3" };
}

describe("the toolkit cuts hold", () => {
  it("offers exactly the seven file and command tools without the removed harness-verb calls", () => {
    const names = createBuilderTools(stubIsolation()).map((t) => t.name);
    expect(names.sort()).toEqual(["bash", "edit", "find", "grep", "ls", "read", "write"]);
    const facts = scanTokens(toolsSource());
    expect(facts.calls.has("hostedHarnessVerbs")).toBe(false);
    expect(facts.calls.has("callHarnessVerb")).toBe(false);
  });

  it("does not add subagent or web-search tools to the Builder file toolkit", () => {
    // createBuilderTools takes only the isolation; web search is backend-owned (builder-backend.ts),
    // and no option shape reintroduces an injected tool silently.
    const names = createBuilderTools(stubIsolation()).map((t) => t.name);
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("subagent");
    expect(scanTokens(toolsSource()).calls.has("loadSubagentDefs")).toBe(false);
  });

  it("keeps the removed broker origin variable and producer out of Builder tools", () => {
    const facts = scanTokens(toolsSource());
    expect(facts.literals.has("HARNESS_EVAL_BROKER_ORIGIN")).toBe(false);
    expect(facts.calls.has("selfOrigin")).toBe(false);
  });

  it("keeps the removed mutation-evidence and staleness calls out of file tools", () => {
    // A malformed .build write gets no contract verdict or staleness line; the isolation
    // toolkit writes bytes and says what it wrote. Content judgment belongs to measurement sessions.
    const facts = scanTokens(toolsSource());
    expect(facts.calls.has("mutationEvidenceLines")).toBe(false);
    expect(facts.calls.has("domainInputTarget")).toBe(false);
    expect(facts.calls.has("staledBatteryCount")).toBe(false);
  });

  it("keeps the former sandbox-bypass environment variable absent", () => {
    // No bash may consult HARNESS_INNER_UNSANDBOXED to skip its sandbox. The isolation refuses when
    // the mechanism is unavailable (CandidateIsolationUnavailable) instead of running degraded.
    expect(scanTokens(toolsSource()).literals.has("HARNESS_INNER_UNSANDBOXED")).toBe(false);
  });

  it("requires an edits array and refuses the former flat edit arguments", async () => {
    const edit = createBuilderTools(stubIsolation()).find((t) => t.name === "edit");
    if (!edit) throw new Error("edit tool not found");
    expect(edit.prepareArguments).toBeUndefined();
    // Without the coercion shim, a flat-shape call has no edits and is refused with the remedy
    // before any file is touched (the stub record throws if the isolation is ever reached).
    await expect(edit.execute("t", { path: "domains/bb3/a.ts", oldText: "1", newText: "2" })).rejects.toThrow(
      /edits must contain at least one replacement/,
    );
  });
});

describe("PR1 consolidation cuts", () => {
  it("Builder and review sessions open the one pi host session", () => {
    // The three per-kind transports are gone; one pi session serves both host slots.
    for (const removed of ["openrouter-backend.ts", "codex-backend.ts", "claude-backend.ts"]) {
      expect(existsSync(`src/backends/${removed}`)).toBe(false);
    }
    expect(source("src/run/builder-backend.ts").calls.has("openHostSession")).toBe(true);
    expect(source("src/review/review-session.ts").calls.has("openHostSession")).toBe(true);
    // Built keeps its own confined pi path; it does not open a host session.
    expect(source("src/backends/pi-built.ts").calls.has("openHostSession")).toBe(false);
  });

  it("keeps the run journal and its producer call absent", () => {
    expect(existsSync("src/truth/run-journal.ts")).toBe(false);
    expect(source("src/truth/verification-runner.ts").calls.has("createRunJournal")).toBe(false);
  });

  it("keeps the synthetic run-event module and producer call absent", () => {
    expect(existsSync("src/truth/run-events.ts")).toBe(false);
    expect(source("src/truth/verification-runner.ts").calls.has("batteryRunEvents")).toBe(false);
  });

  it("keeps the removed record-projection module and calls absent", () => {
    expect(existsSync("src/claim/record-projections.ts")).toBe(false);
    const facts = source("src/claim/battery-run-evidence.ts");
    expect(facts.calls.has("runStatus")).toBe(false);
    expect(facts.calls.has("staleness")).toBe(false);
  });

  it("keeps the former seven-session authoring workflow absent", () => {
    for (const path of [
      "src/author/session-build-pipeline.ts",
      "src/author/accepted-examples-session.ts",
      "src/author/control-corpus-session.ts",
      "src/author/controls-producers.ts",
      "src/author/tool-spec-session.ts",
      "src/author/bundle-window.ts",
      "src/author/climb-round.ts",
      "src/author/task-battery-session.ts",
      "src/author/evaluator-session.ts",
      "src/run/climb-campaign.ts",
    ]) {
      expect(existsSync(path), path).toBe(false);
    }
    const round = source("src/run/builder-campaign.ts");
    expect(round.calls.has("runSessionBuildPipeline")).toBe(false);
    for (const producer of [
      "authorAcceptedExamples",
      "authorControlCorpus",
      "authorHarnessBrief",
      "authorToolSpec",
      "authorEvaluator",
      "authorAgentTools",
      "runBundlePreservingWindow",
    ]) {
      expect(round.calls.has(producer), producer).toBe(false);
    }
    expect(existsSync("src/truth/evaluator-source.ts")).toBe(false);
    expect(source("src/author/fresh-candidate-contract.ts").calls.has("validateEvaluatorSource")).toBe(false);
  });
});
