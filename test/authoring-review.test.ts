/**
 * The Epoch Reviewer beside a live authoring session.
 *
 * A review starts at a completed host tool call over bytes frozen the way the gate freezes a
 * candidate, and the Builder keeps working while it runs: nothing waits for it except a submit
 * that arrives while it is running. What it found rides the first tool result after it finishes,
 * a failed review reaches the Builder as nothing at all, and at most one review is ever in flight.
 * Every review double here is settled by hand, so the session's view of a running review is what
 * each case observes. Each review is also handed the round's blind rehearsals, as the bytes the
 * solver submitted and the one verdict they earned, which the Builder that ran them never sees.
 */
import { readFileSync, renameSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { Type } from "typebox";
import {
  FRESH_BUILD,
  completeBundle,
  installTool,
  namedTool,
  requireExternalVerifier,
  submitTool,
} from "./helpers/builder-campaign.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { double, required, scriptedSession, toolDouble } from "./helpers/doubles.ts";
import { MATCHING_OPERATING_GUIDE } from "./helpers/matching-fixture.ts";
import { PLAN_FIELDS } from "./helpers/experiment-plan.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import type { BuilderCampaignDeps } from "../src/run/builder-campaign.ts";
import { readExecutionEvidence } from "../tools/outcome/builder-execution-facts.ts";
import { createBuiltStarter } from "../src/solve/built-starter.ts";
import { defineDraftTool } from "../src/solve/draft-tool.ts";
import { type Solver, withSolverBuiltStarterFactory } from "../src/correctness-bundle/solve.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";

const ADVICE = "Public review advice.";
const GAP = "The writer cannot express a pinned joint.";

/** A tool call that must come back without waiting for a review does so well inside this. */
const PROMPT_MS = 2_000;

/** The matching fixture's `t1` binds its one part to `s3`; a solver writing `s9` fails it. */
const WRONG_SLOT = "s9";
const WRITER = "write_answer";

/** What one review hands the campaign, as the campaign declares it. */
type AuthoringAdvice = Awaited<ReturnType<NonNullable<BuilderCampaignDeps["reviewAuthoring"]>>>;

afterAll(cleanupScratch);

const noop = toolDouble({ name: "noop", execute: async () => ({ content: [{ type: "text", text: "ok" }] }) });

function advice(findings: number): AuthoringAdvice {
  return { text: `${ADVICE} (${String(findings)} shown)`, findings };
}

/** The tool result as the model reads it, refused if it waited on a review longer than a prompt
 *  call ever should. */
async function promptly(work: Promise<unknown>): Promise<string> {
  const late = Bun.sleep(PROMPT_MS).then(() => {
    throw new Error("the call waited on a running review");
  });
  return JSON.stringify(await Promise.race([work, late]));
}

/** Every review the campaign started, each settled only when the case says so. */
class HeldReviews {
  readonly calls: Array<{
    root: string;
    trigger: string;
    gap: string | null;
    rehearsals: readonly unknown[];
    settle: PromiseWithResolvers<AuthoringAdvice>;
  }> = [];

  readonly review: NonNullable<BuilderCampaignDeps["reviewAuthoring"]> = async (
    root,
    trigger,
    plan,
    rehearsals: readonly unknown[],
  ) => {
    const settle = Promise.withResolvers<AuthoringAdvice>();
    this.calls.push({ root, trigger, gap: plan?.gap ?? null, rehearsals, settle });
    return settle.promise;
  };

  /** Settles one review and lets its bookkeeping run before the next tool call. */
  async finish(index: number, value: AuthoringAdvice | Error): Promise<void> {
    const { settle } = this.calls[index]!;
    if (value instanceof Error) settle.reject(value);
    else settle.resolve(value);
    await Bun.sleep(0);
  }

  /** The case body, with every review still open finished afterwards, so a failed assertion ends
   *  the round rather than leaving it waiting on a review nobody will settle. */
  guard(body: () => Promise<void>) {
    return async () => {
      try {
        await body();
      } finally {
        for (const { settle } of this.calls) settle.resolve(advice(0));
      }
      return { status: "completed" as const };
    };
  }
}

/** A bundle the gate clears, with the round plan beside it in the workspace. */
function authorable(workspace: string): void {
  completeBundle(workspace);
  requireExternalVerifier(workspace);
  installTool(workspace, "field-engine");
  writeFileSync(
    join(workspace, "EXPERIMENT.json"),
    JSON.stringify({
      ...PLAN_FIELDS,
      scope: "product",
      gap: GAP,
      change: "Add pinned joints to the writer.",
      expectedResult: "More accepted submissions.",
      target: { comparator: "at-least", verifiedPasses: 1 },
    }),
  );
}

function reviseGuide(workspace: string, line: string): void {
  writeFileSync(join(workspace, "agent/BUILT_AGENTS.md"), `${MATCHING_OPERATING_GUIDE}\n${line}\n`);
}

/** The measured Built solver's stand-in for a rehearsal: it writes one binding through a writer its
 *  starter registers, and submits. It is never told the hidden expectation. */
function bindingSolver(slot: string): Solver {
  const solver: Solver = async (_task, toolset) => {
    const byName = new Map(toolset.tools.map((tool) => [tool.name, tool]));
    const tool = (name: string) => required(byName.get(name), `a registered ${name}`);
    await tool(WRITER).execute(WRITER, double({ assignments: [{ part: "alpha", slot }] }), undefined);
    await tool("submit").execute("submit", double({}), undefined);
    return { turns: 1, completedTurns: 1, errors: [], toolCalls: 2, startedToolCalls: 2 };
  };
  return withSolverBuiltStarterFactory(solver, async (_slugDir, task, submission, schema) =>
    createBuiltStarter(
      task,
      () => ({
        tools: [
          defineDraftTool({
            name: WRITER,
            label: "Write answer",
            description: "Write the complete structured answer.",
            executionMode: "sequential",
            parameters: Type.Object({ assignments: Type.Unknown() }),
            run(params, draft) {
              draft.setArtifact(double(params));
              return { text: "answer written" };
            },
          }),
        ],
      }),
      submission,
      {
        domainToolAuthorities: [{ name: WRITER, authority: "artifact-writer" }],
        publicArtifactSchema: schema,
      },
    ),
  );
}

/** A campaign whose round runs `body`. `parent` puts the scratch inside the checkout, where a
 *  rehearsal's compiled correctness model resolves its `@ana/*` imports. */
function campaign(
  prefix: string,
  held: HeldReviews,
  deps: Partial<BuilderCampaignDeps> = {},
  parent?: string,
) {
  const campaignDir = scratchDir(prefix, parent);
  const workspace = join(campaignDir, "workspace");
  const run = (body: (tools: readonly unknown[]) => Promise<void>) =>
    runBuilderCampaign(
      { ...FRESH_BUILD, campaignDir, maxTurns: 1 },
      {
        tools: [noop],
        toolsProbes: () => ({ load: async () => [] }),
        gates: async () => [],
        reviewAuthoring: held.review,
        open: async (tools) => scriptedSession(held.guard(async () => body(tools))),
        ...deps,
      },
    );
  return { campaignDir, workspace, run };
}

describe("the Epoch Reviewer beside an authoring session", () => {
  it("reviews a validated repair on its own snapshot while the Builder works on, and hands the advice to the first call after it finishes", async () => {
    const held = new HeldReviews();
    const { campaignDir, workspace, run } = campaign("ana-review-repair-", held);
    const outcome = await run(async (tools) => {
      authorable(workspace);
      const [check, call] = [namedTool(tools, "correctness_check"), namedTool(tools, "noop")];
      // The check returns without the review it made due, which is still running.
      expect(await promptly(check.execute("check", {}))).not.toContain(ADVICE);
      expect(held.calls.map(({ trigger, gap }) => [trigger, gap])).toEqual([["repair", GAP]]);
      expect(held.calls[0]?.root).toContain(".bundle-snapshots");
      expect(await promptly(call.execute("while-running", {}))).not.toContain(ADVICE);
      await held.finish(0, advice(0));
      expect(await promptly(call.execute("after", {}))).toContain(ADVICE);
      // Unchanged product bytes: the same clear result, no second review.
      await check.execute("same-check", {});
      expect(held.calls).toHaveLength(1);
      reviseGuide(workspace, "A repaired public instruction.");
      await check.execute("repaired-check", {});
      expect(held.calls).toHaveLength(2);
      expect(readFileSync(join(held.calls[1]!.root, "agent/BUILT_AGENTS.md"), "utf8")).toContain(
        "A repaired public instruction.",
      );
      await held.finish(1, advice(0));
      // Acceptance closes authoring; the accepted product is reviewed after its battery.
      expect(await promptly(submitTool(tools).execute("submit", {}))).not.toContain(ADVICE);
    });
    expect(outcome.buildAdmissible).toBe(true);
    const rows = readExecutionEvidence(campaignDir)[0]?.authoringReviews ?? [];
    expect(rows.map((row) => [row.tool, row.adviceChars])).toEqual([["noop", advice(0).text.length]]);
  });

  it("freezes the workspace for a backstop review instead of reading it live, and restarts the clock when the review finishes", async () => {
    const held = new HeldReviews();
    const { workspace, run } = campaign("ana-review-clock-", held, { reviewIntervalMs: 300 });
    await run(async (tools) => {
      completeBundle(workspace);
      const call = namedTool(tools, "noop");
      await Bun.sleep(350);
      expect(held.calls).toHaveLength(0);
      await promptly(call.execute("due", {}));
      expect(held.calls.map(({ trigger }) => trigger)).toEqual(["backstop"]);
      const { root } = held.calls[0]!;
      expect(root).not.toBe(workspace);
      expect(root).toContain(".bundle-snapshots");
      // An edit made after the review began is not in the bytes it reads.
      reviseGuide(workspace, "Edited while the review ran.");
      expect(readFileSync(join(root, "agent/BUILT_AGENTS.md"), "utf8")).not.toContain("Edited while");
      // The interval elapses again while it runs: that trigger is coalesced into nothing new.
      await Bun.sleep(350);
      await promptly(call.execute("while-running", {}));
      expect(held.calls).toHaveLength(1);
      await held.finish(0, advice(0));
      // The clock restarted when the review finished, not when it became due.
      expect(await promptly(call.execute("delivered", {}))).toContain(ADVICE);
      expect(held.calls).toHaveLength(1);
      await Bun.sleep(350);
      await promptly(call.execute("due-again", {}));
      expect(held.calls).toHaveLength(2);
      expect(readFileSync(join(held.calls[1]!.root, "agent/BUILT_AGENTS.md"), "utf8")).toContain(
        "Edited while",
      );
    });
  });

  it("coalesces the products validated while a review runs into one review of the latest, never a queue", async () => {
    const held = new HeldReviews();
    const { workspace, run } = campaign("ana-review-coalesce-", held);
    await run(async (tools) => {
      authorable(workspace);
      const [check, call] = [namedTool(tools, "correctness_check"), namedTool(tools, "noop")];
      await promptly(check.execute("first", {}));
      reviseGuide(workspace, "Second product.");
      await promptly(check.execute("second", {}));
      reviseGuide(workspace, "Third product.");
      await promptly(check.execute("third", {}));
      expect(held.calls).toHaveLength(1);
      await held.finish(0, advice(0));
      expect(await promptly(call.execute("delivered", {}))).toContain(ADVICE);
      expect(held.calls).toHaveLength(2);
      expect(readFileSync(join(held.calls[1]!.root, "agent/BUILT_AGENTS.md"), "utf8")).toContain(
        "Third product.",
      );
      await held.finish(1, advice(0));
      await promptly(call.execute("settled", {}));
      expect(held.calls).toHaveLength(2);
    });
  });

  it("does not make a submit wait when no review is in flight, even with one due", async () => {
    const held = new HeldReviews();
    const { workspace, run } = campaign("ana-review-no-wait-", held, { reviewIntervalMs: 50 });
    const outcome = await run(async (tools) => {
      authorable(workspace);
      await Bun.sleep(100);
      expect(await promptly(submitTool(tools).execute("submit", {}))).toContain("Accepted.");
    });
    expect(outcome.buildAdmissible).toBe(true);
    expect(held.calls).toHaveLength(0);
  });

  it("holds a submit made during a review until it finishes, returns findings the Builder has not seen and counts no submit", async () => {
    const held = new HeldReviews();
    const { campaignDir, workspace, run } = campaign("ana-review-join-", held);
    const outcome = await run(async (tools) => {
      authorable(workspace);
      await promptly(namedTool(tools, "correctness_check").execute("check", {}));
      let returned = false;
      const submitting = submitTool(tools)
        .execute("held", {})
        .finally(() => {
          returned = true;
        });
      await Bun.sleep(50);
      expect(returned).toBe(false);
      await held.finish(0, advice(2));
      const heldText = await promptly(submitting);
      expect(heldText).toContain("Nothing was submitted.");
      expect(heldText).toContain(ADVICE);
      expect(heldText).toContain('"reason":"review-unread"');
      // The same bytes again: judged as they stand, neither a strike nor a refusal.
      expect(await promptly(submitTool(tools).execute("same-bytes", {}))).toContain("Accepted.");
    });
    expect(outcome.buildAdmissible).toBe(true);
    expect(outcome.iterations).toHaveLength(1);
    const record = readExecutionEvidence(campaignDir)[0];
    expect(record?.submits.map((row) => row.outcome)).toEqual(["accepted"]);
  });

  it("holds a submit that follows a finished review with no call between to hand its findings over", async () => {
    const held = new HeldReviews();
    const { workspace, run } = campaign("ana-review-join-finished-", held);
    const outcome = await run(async (tools) => {
      authorable(workspace);
      await promptly(namedTool(tools, "correctness_check").execute("check", {}));
      await held.finish(0, advice(1));
      const heldText = await promptly(submitTool(tools).execute("held", {}));
      expect(heldText).toContain("Nothing was submitted.");
      expect(heldText).toContain(ADVICE);
      expect(await promptly(submitTool(tools).execute("read", {}))).toContain("Accepted.");
    });
    expect(outcome.buildAdmissible).toBe(true);
  });

  it("lets a submit through when the review it waited for shows no finding", async () => {
    const held = new HeldReviews();
    const { workspace, run } = campaign("ana-review-join-clear-", held);
    const outcome = await run(async (tools) => {
      authorable(workspace);
      await promptly(namedTool(tools, "correctness_check").execute("check", {}));
      const submitting = submitTool(tools).execute("submit", {});
      await held.finish(0, advice(0));
      const result = await promptly(submitting);
      expect(result).toContain("Accepted.");
      expect(result).not.toContain(ADVICE);
    });
    expect(outcome.buildAdmissible).toBe(true);
  });

  it("keeps a review that throws out of every result: it neither blocks submit nor reads as a finding", async () => {
    const held = new HeldReviews();
    const { campaignDir, workspace, run } = campaign("ana-review-throws-", held);
    const failure = new Error("private reviewer failure detail");
    const outcome = await run(async (tools) => {
      authorable(workspace);
      const [check, call] = [namedTool(tools, "correctness_check"), namedTool(tools, "noop")];
      await promptly(check.execute("check", {}));
      await held.finish(0, failure);
      const after = await promptly(call.execute("after-failure", {}));
      expect(after).toContain('"text":"ok"');
      expect(after).not.toContain("private reviewer failure");
      reviseGuide(workspace, "Repaired after a failed review.");
      await promptly(check.execute("repaired", {}));
      expect(held.calls).toHaveLength(2);
      const submitting = submitTool(tools).execute("submit", {});
      await held.finish(1, failure);
      const submitted = await promptly(submitting);
      expect(submitted).toContain("Accepted.");
      expect(submitted).not.toContain("private reviewer failure");
    });
    expect(outcome.buildAdmissible).toBe(true);
    // The failure the Builder's next call met is on record as a review that produced nothing.
    const rows = readExecutionEvidence(campaignDir)[0]?.authoringReviews ?? [];
    expect(rows.map((row) => [row.tool, row.adviceChars])).toEqual([["noop", null]]);
  });

  it("has the round's records on disk while a review is still running", async () => {
    // A SIGTERM never reaches the settled record, so what survives one is the last checkpoint. The
    // triggering call's checkpoint used to wait behind the review; this is the in-process reading
    // of that durability, not a delivered signal.
    const held = new HeldReviews();
    const { campaignDir, workspace, run } = campaign("ana-review-durable-", held);
    await run(async (tools) => {
      authorable(workspace);
      await promptly(namedTool(tools, "correctness_check").execute("check", {}));
      expect(held.calls).toHaveLength(1);
      const record = readExecutionEvidence(campaignDir)[0];
      const check = record?.customCalls.find((row) => row.tool === "correctness_check");
      expect(check?.dispatchOutcome).toBe("returned");
      expect(record?.authoringReviews).toEqual([]);
      await held.finish(0, advice(0));
    });
  });

  it("hands each review the round's blind rehearsals: the bytes the solver submitted, its one verdict, and whether it solved the bytes under review", async () => {
    const held = new HeldReviews();
    const parent = scratchDir(".ana-scratch-review-rehearsal-", import.meta.dir);
    const deps = {
      reviewIntervalMs: 50,
      builtSolver: () => bindingSolver(WRONG_SLOT),
      verifierLifetime: createVerifierLifetime({ root: join(parent, ".verifier") }),
    };
    const { workspace, run } = campaign("ana-review-rehearsal-", held, deps, parent);
    await run(async (tools) => {
      completeBundle(workspace);
      // The rehearsal outlasts the backstop interval, so its own completion starts the review.
      const trial = JSON.stringify(
        await namedTool(tools, "harness_trial").execute("rehearse", { taskId: "t1" }),
      );
      expect(trial).toContain(String.raw`\"verdict\":\"fail\"`);
      // The Builder that ran it reads the verdict alone, never the bytes its solver submitted.
      expect(trial).not.toContain(WRONG_SLOT);
      expect(held.calls).toHaveLength(1);
      const seen = held.calls[0]!.rehearsals;
      expect(seen).toMatchObject([
        { ordinal: 1, taskId: "t1", family: "single-part", verdict: "fail", current: true },
      ]);
      const { artifact } = double<{ artifact: string }>(seen[0]);
      expect(JSON.parse(artifact)).toEqual({ assignments: [{ part: "alpha", slot: WRONG_SLOT }] });
      // Bytes authored after the rehearsal: the next review is told it graded earlier ones.
      reviseGuide(workspace, "Edited after the rehearsal.");
      await held.finish(0, advice(0));
      await Bun.sleep(60);
      await promptly(namedTool(tools, "noop").execute("later", {}));
      expect(held.calls).toHaveLength(2);
      expect(held.calls[1]!.rehearsals).toMatchObject([{ ordinal: 1, verdict: "fail", current: false }]);
    });
  }, 60_000);

  it("does not review a draft that cannot be frozen, and tries again at the next completed call", async () => {
    const held = new HeldReviews();
    const { workspace, run } = campaign("ana-review-unfrozen-", held, { reviewIntervalMs: 50 });
    await run(async (tools) => {
      completeBundle(workspace);
      const call = namedTool(tools, "noop");
      await Bun.sleep(100);
      renameSync(join(workspace, "agent"), join(workspace, "agent-away"));
      await promptly(call.execute("unfrozen", {}));
      expect(held.calls).toHaveLength(0);
      renameSync(join(workspace, "agent-away"), join(workspace, "agent"));
      await promptly(call.execute("frozen", {}));
      expect(held.calls.map(({ trigger }) => trigger)).toEqual(["backstop"]);
      expect(held.calls[0]?.root).toContain(".bundle-snapshots");
    });
  });
});
