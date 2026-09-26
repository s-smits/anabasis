import type { AgentTool } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "bun:test";
import type { AgentSession } from "../src/backends/backend-types.ts";
import { evaluatorIndependence } from "../src/claim/calibration.ts";
import { judgeDecision, validateJudgeEvidence } from "../src/claim/judge.ts";
import { JudgeCensus, type JudgeCensusSubject } from "../src/review/judge-census.ts";
import { runJudgePhase } from "../src/review/judge-phase.ts";
import {
  type JudgeAttempt,
  type JudgeSession,
  type JudgeObservation,
  type JudgeRequest,
  confirmedDisagreement,
  judgeSubject,
  sessionJudge,
  summarizeJudge,
} from "../src/review/judge.ts";
import { SANITIZER_VERSION } from "../src/correctness-bundle/sanitize.ts";
import { RATIONALE_MAX, errorText } from "../src/review/judge-drivers.ts";
import { double, required, scriptedSession } from "./helpers/doubles.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import {
  ProviderResourceBudget,
  ProviderResourceBudgetExhausted,
} from "../src/run/provider-resource-budget.ts";
const EVERY_STOP_IS_VISITED_ONCE = "every stop is visited once";

const REQUEST: JudgeRequest = {
  subjectId: "task-1",
  publicContext: {
    domain: {
      slug: "route",
      domain: "routing",
      publicRequest: "plan a route",
      artifactSchema: [{ name: "route", "shape": "string[]" }],
      publicResources: [],
      toolContract: null,
      runtimeFacts: {
        capabilities: [],
        maxSubmitAttempts: 1,
        condition: { variant: "shipping", advisorsRemoved: [], toolInterfaceHash: null },
      },
    },
    publicTask: { taskId: "task-1", family: "routing", publicInput: { stops: ["a", "b"] } },
  },
  submittedArtifact: { route: ["a", "b"] },
};

/** The evaluated (built-agent) pin every aggregation test uses, a different family from the
 *  scripted judge pin. */
const EVALUATED_PIN = "codex/gpt-5.5";

/** One tri-state attempt, stated by the fields that differ. Every judge answer carries all seven,
 *  and writing the six unchanged ones at each site hid which one the test was about. */
const attempt = (states: Partial<JudgeAttempt>): JudgeAttempt => ({
  verdict: null,
  abstained: false,
  rationale: null,
  rules: [],
  error: null,
  errorKind: null,
  turns: 1,
  ...states,
});

/** A judge driven by the schema tool: only the turn body and, rarely, the dispose differ, so the
 *  session around them is the shared double. No caller reads `backend` on this path. */
const toolJudge = (
  turn: (
    tool: AgentTool<never>,
    options: Parameters<AgentSession["runTurn"]>[0],
  ) => ReturnType<AgentSession["runTurn"]>,
  onDispose: () => void = () => {},
) =>
  sessionJudge({
    openSession: async (tool) => scriptedSession((options) => turn(tool, options), onDispose),
  });

/** One subject through the controller's evidence path, under the scripted pin the aggregation
 *  fixtures also use. */
const subjectOf = (invoke: JudgeSession["invoke"], request: JudgeRequest = REQUEST) =>
  judgeSubject({ pin: "scripted/judge", invoke }, request, "battery-case");

/** Census subjects for the given ids, each bound to its own evidence path and verifier verdict. */
const subjectsFor = (ids: readonly string[], verifierVerdict = true): JudgeCensusSubject[] =>
  ids.map((subjectId) => ({
    evidencePath: `cases/${subjectId}/judge.json`,
    request: { ...REQUEST, subjectId },
    subjectKind: "battery-case",
    observation: { verifierVerdict },
  }));

/** `count` census subjects named c1..cN. */
const subjects = (count: number, verifierVerdict = true): JudgeCensusSubject[] =>
  subjectsFor(
    Array.from({ length: count }, (_, index) => `c${index + 1}`),
    verifierVerdict,
  );

describe("Judge verdict schema", () => {
  it("bounds a transport error to the diagnostic limit in bytes and marks the cut", () => {
    expect(errorText(new Error("z".repeat(600)))).toBe(`${"z".repeat(500)} […100 bytes omitted]`);
  });

  it("accepts one typed verdict through the only output method", async () => {
    let opened = 0;
    const judge = sessionJudge({
      openSession: async (tool: AgentTool<never>) => {
        opened += 1;
        return scriptedSession(async () => {
          await tool.execute("call-1", double({ verdict: "pass", rationale: "the route is complete" }));
          return { status: "completed" };
        });
      },
    });

    await expect(judge(REQUEST)).resolves.toEqual(
      attempt({ verdict: true, rationale: "the route is complete" }),
    );
    expect(opened).toBe(1);
  });

  it("records abstention with its reason and no error", async () => {
    const judge = toolJudge(async (tool) => {
      await tool.execute(
        "call-1",
        double({
          verdict: "abstain",
          rationale: "public context lacks the binding table",
        }),
      );
      return { status: "completed" };
    });
    await expect(judge(REQUEST)).resolves.toEqual(
      attempt({ abstained: true, rationale: "public context lacks the binding table" }),
    );
  });

  it("a judge error is null, never a fail verdict", async () => {
    let inputKeys: string[] = [];
    const evidence = await subjectOf(async (input) => {
      inputKeys = Object.keys(input).sort();
      return Promise.reject(new Error("timed out"));
    });
    expect(evidence).toMatchObject({
      schema: "judge-subject/v3",
      publicContextDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      judgeInputDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      ...attempt({ error: "timed out", errorKind: "transport", turns: 0 }),
    });
    expect(inputKeys).toEqual(["publicContext", "submittedArtifact"]);
  });

  it("keeps subject budget exhaustion typed instead of recording a null judge result", async () => {
    const exhaustion = new ProviderResourceBudgetExhausted("review", 1, 1);
    await expect(subjectOf(async () => Promise.reject(exhaustion))).rejects.toBe(exhaustion);
  });

  it("keeps the controller stop typed through the Judge subject catch", async () => {
    class RunStopped extends Error {
      readonly kind = "test-run-stopped" as const;
    }
    const budget = new ProviderResourceBudget(2);
    const stopped = new RunStopped("deadline elapsed");
    budget.stopNewReservations(stopped);
    await expect(
      subjectOf(async () => {
        budget.assertAvailable("review");
        throw new Error("unreached");
      }),
    ).rejects.toBe(stopped);
  });

  it("a non-abstention null without an error string is a malformed attempt, not silence", async () => {
    const evidence = await subjectOf(async () => attempt({}));
    expect(evidence).toMatchObject(
      attempt({ error: "judge returned a malformed tri-state attempt", errorKind: "transport", turns: 0 }),
    );
  });

  it("rejects an error attempt that lacks its typed error kind", async () => {
    const evidence = await subjectOf(async () => attempt({ error: "untyped failure" }));
    expect(evidence).toMatchObject({
      verdict: null,
      error: "judge returned a malformed tri-state attempt",
      errorKind: "transport",
    });
  });

  it("every model-visible judge input passes the versioned sanitizer before the session sees it", async () => {
    const seen: unknown[] = [];
    const evidence = await subjectOf(
      async (input) => {
        seen.push(input);
        return attempt({ verdict: false, rationale: "invalid route" });
      },
      {
        ...REQUEST,
        publicContext: double<JudgeRequest["publicContext"]>({
          ...REQUEST.publicContext,
          verifier: "PROTECTED",
        }),
        submittedArtifact: { route: ["a\u200Bb\u202Econcealed"] },
      },
    );
    const session = double<{ submittedArtifact: { route: string[] } }>(
      required(seen[0], "the first judge session"),
    );
    expect(session.submittedArtifact.route[0]).toBe("abconcealed");
    expect(JSON.stringify(session)).not.toContain("PROTECTED");
    expect(evidence.sanitizer).toEqual({
      version: SANITIZER_VERSION,
      modified: true,
      actions: ["stripped-control-characters"],
    });
  });

  it("delivers a complete ordinary source file to the Judge instead of a per-string preview", async () => {
    // A round i04: the Judge abstained because sanitization cut firmware.ino at 4,000
    // characters, even though the complete subject was small enough for the request.
    const source = "// firmware source\n".repeat(260) + "void loop() { complete(); }";
    let received: unknown;
    const evidence = await subjectOf(
      async (input) => {
        received = input.submittedArtifact;
        return attempt({ verdict: true, rationale: "fixture" });
      },
      { ...REQUEST, submittedArtifact: { files: { "firmware.ino": source } } },
    );
    expect(received).toEqual({ files: { "firmware.ino": source } });
    expect(evidence.sanitizer.modified).toBe(false);
  });

  it("a completed prose-only turn is null because no schema verdict was recorded", async () => {
    const judge = toolJudge(async () => ({ status: "completed", assistantText: "looks fine" }));
    await expect(judge(REQUEST)).resolves.toEqual(
      attempt({ error: "judge completed without schema output", errorKind: "protocol" }),
    );
  });

  it("records the first valid compatibility-tool verdict when the backend delivers a duplicate call", async () => {
    const judge = toolJudge(async (tool) => {
      await tool.execute("call-1", double({ verdict: "pass", rationale: "first verdict" }));
      try {
        await tool.execute("call-2", double({ verdict: "pass", rationale: "duplicate verdict" }));
      } catch {
        // A backend may book the second call as a tool error and still complete the turn.
      }
      return { status: "completed" };
    });
    await expect(judge(REQUEST)).resolves.toEqual(attempt({ verdict: true, rationale: "first verdict" }));
  });

  it("a conflicting duplicate call is acknowledged without comparison and cannot erase the capture", async () => {
    const acknowledgements: string[] = [];
    const judge = toolJudge(async (tool) => {
      await tool.execute("call-1", double({ verdict: "pass", rationale: "first verdict" }));
      const second = double<{ content: Array<{ text: string }> }>(
        await tool.execute("call-2", double({ verdict: "fail", rationale: "conflicting verdict" })),
      );
      acknowledgements.push(second.content[0]?.text ?? "");
      return { status: "completed" };
    });
    await expect(judge(REQUEST)).resolves.toEqual(attempt({ verdict: true, rationale: "first verdict" }));
    expect(acknowledgements).toEqual(["verdict already recorded"]);
  });

  it("retains the recorded verdict when the turn later fails", async () => {
    const judge = toolJudge(async (tool) => {
      await tool.execute(
        "call-1",
        double({ verdict: "fail", rationale: "invalid route", rules: ["publicInput"] }),
      );
      return { status: "failed", errorMessages: ["stream closed"] };
    });
    await expect(judge(REQUEST)).resolves.toEqual(
      attempt({ verdict: false, rationale: "invalid route", rules: ["publicInput"] }),
    );
  });

  it("retains the recorded verdict when session disposal fails", async () => {
    const judge = toolJudge(
      async (tool) => {
        await tool.execute("call-1", double({ verdict: "pass", rationale: "route holds" }));
        return { status: "completed" };
      },
      () => {
        throw new Error("session already closed");
      },
    );
    await expect(judge(REQUEST)).resolves.toEqual(attempt({ verdict: true, rationale: "route holds" }));
  });

  it("a malformed first call may be retried and the later valid call is captured", async () => {
    const judge = toolJudge(async (tool) => {
      await expect(tool.execute("call-1", double({ verdict: "maybe", rationale: "" }))).rejects.toThrow(
        "judge verdict must match",
      );
      await tool.execute("call-2", double({ verdict: "pass", rationale: "second attempt is valid" }));
      return { status: "completed" };
    });
    await expect(judge(REQUEST)).resolves.toEqual(
      attempt({ verdict: true, rationale: "second attempt is valid" }),
    );
  });

  it("zero valid captures stays a typed operational non-result", async () => {
    const judge = toolJudge(async (tool) => {
      await tool.execute("call-1", double({ verdict: "maybe", rationale: "" })).catch(() => {});
      return { status: "completed" };
    });
    await expect(judge(REQUEST)).resolves.toEqual(
      attempt({ error: "judge completed without schema output", errorKind: "protocol" }),
    );
  });
});

// The census has one output method, the schema tool; the transport-native structured output that
// live-c3-comparison-007-r2 compared it against is gone with the transports that offered it.
describe("the schema-tool verdict: budget, task disclosure, hint and cited rules", () => {
  it("keeps review budget exhaustion typed instead of returning an ordinary null verdict", async () => {
    const providerBudget = new ProviderResourceBudget(1);
    providerBudget.reserve("built").complete();
    const judge = sessionJudge({
      providerBudget,
      openSession: async () =>
        scriptedSession(async () => {
          throw new Error("the provider must not be called without a permit");
        }),
    });
    await expect(judge(REQUEST)).rejects.toBeInstanceOf(ProviderResourceBudgetExhausted);
  });

  it("states the bound public task and never what would make an artifact valid", async () => {
    // live-run-01 and run 68 were both symptoms of judging real subjects without their bound
    // task; every subject now arrives task-bound, and the prompt says so.
    const prompts: string[] = [];
    const judge = toolJudge(async (tool, options) => {
      prompts.push(options.prompt);
      await tool.execute("call-1", double({ verdict: "pass", rationale: "solves the task" }));
      return { status: "completed" };
    });
    await judge(REQUEST);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("This input contains a public task");
    // Naming a check, a join, a decoy class, or an expectation would be the coaching the doctrine
    // forbids, and none of those vocabularies reaches a judge prompt.
    expect(prompts[0]).not.toMatch(/checkId|decoyClass|mutationClass|targetsJoin|expectation/i);
  });

  it("answers a malformed verdict with the whole schema hint, so the model can retry", async () => {
    const judge = toolJudge(async (tool) => {
      await expect(tool.execute("call-1", double({ verdict: "maybe", rationale: "" }))).rejects.toThrow(
        // The hint states the rationale bound the schema enforces, so the retry can meet it.
        `judge verdict must match {verdict:"pass"|"fail"|"abstain",rationale:string(1..${String(RATIONALE_MAX)}),rules?:string[]}; a fail must cite only shown rules, verbatim, at least one`,
      );
      return { status: "completed" };
    });
    await expect(judge(REQUEST)).resolves.toEqual(
      attempt({ error: "judge completed without schema output", errorKind: "protocol" }),
    );
  });

  // A fail is decisive only through the rule it cites: a verbatim shown assertion joins to the
  // check that passed the artifact, and an invented rule (run 69's hold on unshown tool text) is a
  // protocol non-result rather than a verdict.
  it("records the shown rules a fail cites and refuses a fail that cites anything unshown", async () => {
    const shown: JudgeRequest = {
      ...REQUEST,
      publicContext: {
        ...REQUEST.publicContext,
        publicTask: {
          taskId: "task-1",
          family: "routing",
          publicInput: { stops: ["a", "b"] },
          publicValidityRules: [{ assertion: EVERY_STOP_IS_VISITED_ONCE, publicInputPaths: ["$.stops"] }],
        },
      },
    };
    // A refused call throws the hint back to the model; the turn then ends without a capture.
    const judgeWith = (verdict: JsonValue) =>
      toolJudge(async (tool) => {
        await tool.execute("call-1", double(verdict)).catch(() => {});
        return { status: "completed" };
      });
    await expect(
      judgeWith({
        verdict: "fail",
        rationale: "b is skipped",
        rules: [EVERY_STOP_IS_VISITED_ONCE, "publicInput"],
      })(shown),
    ).resolves.toMatchObject({
      verdict: false,
      rules: [EVERY_STOP_IS_VISITED_ONCE, "publicInput"],
      error: null,
    });
    await expect(
      judgeWith({
        verdict: "fail",
        rationale: "stops must be alphabetical",
        rules: [EVERY_STOP_IS_VISITED_ONCE, "stops are sorted"],
      })(shown),
    ).resolves.toMatchObject({
      verdict: null,
      rules: [],
      errorKind: "protocol",
    });
    await expect(judgeWith({ verdict: "fail", rationale: "uncited" })(shown)).resolves.toMatchObject({
      verdict: null,
      errorKind: "protocol",
    });
    // A pass never carries a rule, whatever the model sent.
    await expect(
      judgeWith({ verdict: "pass", rationale: "complete", rules: [EVERY_STOP_IS_VISITED_ONCE] })(shown),
    ).resolves.toMatchObject({ verdict: true, rules: [] });
    // A public rule decision on the domain card is a shown rule too; its id and family scope are not.
    const decided: JudgeRequest = {
      ...shown,
      publicContext: {
        ...shown.publicContext,
        domain: {
          ...shown.publicContext.domain,
          publicResources: [
            {
              name: "public-rule-decisions",
              digest: "d",
              content: [{ id: "order", visibility: "public", statement: "stops are visited in list order" }],
            },
          ],
        },
      },
    };
    await expect(
      judgeWith({ verdict: "fail", rationale: "b before a", rules: ["stops are visited in list order"] })(
        decided,
      ),
    ).resolves.toMatchObject({ verdict: false, error: null });
    await expect(
      judgeWith({ verdict: "fail", rationale: "b before a", rules: ["order"] })(decided),
    ).resolves.toMatchObject({ verdict: null, errorKind: "protocol" });
  });
});

describe("the judge battery review", () => {
  it.each([
    {
      verdict: true,
      abstained: true,
      rationale: "contradictory",
      rules: [],
      error: null,
      errorKind: null,
      turns: 1,
    },
    {
      verdict: null,
      abstained: true,
      rationale: "public facts are insufficient",
      rules: [],
      error: null,
      errorKind: null,
      turns: 1,
    },
    {
      verdict: null,
      abstained: false,
      rationale: null,
      rules: [],
      error: "provider unavailable",
      errorKind: "provider",
      turns: 0,
    },
    {
      verdict: true,
      abstained: false,
      rationale: "satisfies the public task",
      rules: [],
      error: null,
      errorKind: null,
      turns: 1,
    },
  ] satisfies JudgeAttempt[])("continues after one subject returns %j", async (first) => {
    const calls: string[] = [];
    const written: string[] = [];
    const result = await runJudgePhase({
      judge: {
        pin: "scripted/judge",
        invoke: async (input, context) => {
          expect(input.submittedArtifact).toEqual(REQUEST.submittedArtifact);
          calls.push(required(context, "subject context").subjectId);
          return context?.subjectId === "first"
            ? first
            : attempt({ verdict: true, rationale: "satisfies the public task" });
        },
      },
      subjects: subjectsFor(["first", "later"]),
      write: (path) => {
        written.push(path);
      },
    });
    const valid = first.error === null && (first.verdict === null || !first.abstained);
    expect(calls).toEqual(["first", "later"]);
    expect(written).toEqual(["cases/first/judge.json", "cases/later/judge.json"]);
    expect(result.map((row) => row.evidence.verdict)).toEqual([valid ? first.verdict : null, true]);
    expect(result[0]?.evidence.abstained).toBe(first.verdict === null && first.abstained);
    expect(result[0]?.evidence.errorKind).toBe(
      first.verdict === true && first.abstained ? "transport" : first.errorKind,
    );
  });

  it("buys nothing after a disagreement: only the battery subjects reach the session", async () => {
    const calls: string[] = [];
    const written: string[] = [];
    const result = await runJudgePhase({
      judge: {
        pin: "scripted/judge",
        invoke: async (_input, context) => {
          calls.push(`${String(context?.subjectKind)}:${String(context?.subjectId)}`);
          return attempt({ verdict: false, rationale: "rejects every case" });
        },
      },
      subjects: subjectsFor(["t1", "t2"]),
      write: (path) => {
        written.push(path);
      },
    });
    expect(result).toHaveLength(2);
    expect(calls).toEqual(["battery-case:t1", "battery-case:t2"]);
    expect(written).toEqual(["cases/t1/judge.json", "cases/t2/judge.json"]);
  });

  it("samples a verdict that contradicts the verifier once more and records the second verdict beside the first", async () => {
    // Task 12-low-side-lamp split 2 fail / 1 pass over three replays on 2026-09-15.
    const calls: string[] = [];
    const verdicts = new Map<string, Array<boolean | null>>([
      ["c1", [false, false]],
      ["c2", [false, true]],
      ["c3", [true]],
      ["c4", [false]],
      ["c5", [true, true]],
    ]);
    const census = new JudgeCensus(
      {
        pin: "scripted/judge",
        invoke: async (_input, context) => {
          const id = context?.subjectId ?? "";
          calls.push(id);
          const verdict = verdicts.get(id)?.shift() ?? null;
          if (verdict === null) return attempt({ error: "degraded", errorKind: "provider", turns: 0 });
          return attempt({
            verdict,
            rationale: "reason",
            rules: verdict ? [] : [EVERY_STOP_IS_VISITED_ONCE],
          });
        },
      },
      () => {},
    );
    const result = await census.run([...subjects(3), ...subjects(5, false).slice(3)]);
    expect(calls.sort()).toEqual(["c1", "c1", "c2", "c2", "c3", "c4", "c5", "c5"]);
    const byId = new Map(result.observations.map((row) => [row.evidence.subjectId, row.evidence]));
    expect(byId.get("c1")).toMatchObject({
      verdict: false,
      confirmation: { verdict: false, rules: [EVERY_STOP_IS_VISITED_ONCE] },
    });
    expect(byId.get("c2")).toMatchObject({ verdict: false, confirmation: { verdict: true } });
    expect("confirmation" in (byId.get("c3") ?? {})).toBe(false);
    expect("confirmation" in (byId.get("c4") ?? {})).toBe(false);
    expect(byId.get("c5")).toMatchObject({ verdict: true, confirmation: { verdict: true, rules: [] } });
    expect(
      result.observations
        .filter((row) => confirmedDisagreement(row.evidence))
        .map((row) => row.evidence.subjectId),
    ).toEqual(["c1", "c5"]);
  });

  it("without a declared width the census keeps the shared batch stop, so the sixth subject is never spent", async () => {
    const invoked: string[] = [];
    const census = new JudgeCensus(
      {
        pin: "paid/judge",
        invoke: async (_input, context) => {
          invoked.push(context?.subjectId ?? "");
          return attempt({ error: "degraded", errorKind: "provider", turns: 0 });
        },
      },
      () => {},
    );
    const result = await census.run(subjects(8));
    expect(invoked).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(result.abort).toMatchObject({ attempted: 5 });
  });

  it("runs five fresh subjects at once and settles evidence in input order", async () => {
    let active = 0;
    let maximum = 0;
    const written: string[] = [];
    const census = new JudgeCensus(
      {
        pin: "scripted/judge",
        invoke: async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          await Bun.sleep(2);
          active -= 1;
          return attempt({ verdict: true, rationale: "valid" });
        },
      },
      (path) => written.push(path),
    );
    const result = await census.run(subjects(7));
    expect(maximum).toBe(5);
    expect(result.observations.map((row) => row.evidence.subjectId)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
      "c6",
      "c7",
    ]);
    expect(written).toEqual(subjects(7).map((subject) => subject.evidencePath));
    expect(result.abort).toBeNull();
  });

  it("settles each paid wave and stops after five consecutive failed attempts", async () => {
    // Four failures, one pass, four failures, one abstention, then five failures: the streak
    // resets on each answered subject and only the last run of five stops the census.
    const answered = new Map([
      [5, "pass"],
      [10, "abstain"],
    ]);
    const written = new Map<string, unknown>();
    const census = new JudgeCensus(
      {
        pin: "scripted/judge",
        invoke: async (_input, context) => {
          const outcome = answered.get(Number(context?.subjectId.slice(1)));
          if (outcome === "pass") return attempt({ verdict: true, rationale: "valid" });
          if (outcome === "abstain") return attempt({ abstained: true, rationale: "insufficient" });
          return attempt({ error: "provider degraded turn", errorKind: "provider" });
        },
      },
      (path, value) => written.set(path, value),
    );
    const result = await census.run(subjects(20));
    expect(result.observations).toHaveLength(15);
    expect(result.abort).toEqual({
      schema: "judge-census-abort/v1",
      attempted: 15,
      threshold: 5,
      lastError: "provider degraded turn",
    });
    expect(written.get("judge/census-abort.json")).toEqual(result.abort);
    expect(written.has("cases/c16/judge.json")).toBe(false);
  });
});

describe("judge battery aggregation", () => {
  const session = { pin: "scripted/judge", invoke: async (): Promise<JudgeAttempt> => attempt({ turns: 0 }) };

  const observation = (
    id: string,
    verdict: boolean | null,
    options: {
      verifier?: boolean | null;
      error?: string | null;
      errorKind?: "provider" | "protocol" | "transport" | null;
      turns?: number;
      abstained?: boolean;
      rules?: string[];
      confirmation?: boolean | null;
    } = {},
  ): JudgeObservation => {
    const abstained = options.abstained ?? false;
    const failed = verdict === null && !abstained;
    const confirmation =
      options.confirmation === undefined
        ? {}
        : {
            confirmation: attempt({
              verdict: options.confirmation,
              rationale: "again",
              rules: options.confirmation === false ? (options.rules ?? []) : [],
            }),
          };
    return {
      evidence: {
        ...confirmation,
        schema: "judge-subject/v3",
        publicContextDigest: "0".repeat(64),
        judgeInputDigest: "0".repeat(64),
        subjectId: id,
        subjectKind: "battery-case",
        judgePin: "scripted/judge",
        verifierBlind: true,
        sanitizer: { version: SANITIZER_VERSION, modified: false, actions: [] },
        ...attempt({
          verdict,
          abstained,
          rationale: failed ? null : `reason ${id}`,
          rules: options.rules ?? [],
          error: options.error ?? (failed ? "judge timeout" : null),
          errorKind: options.errorKind ?? (failed ? ("transport" as const) : null),
          turns: options.turns ?? 1,
        }),
      },
      verifierVerdict: options.verifier ?? null,
    };
  };

  /** Every aggregation reads the same judge session and correctness-model identity. */
  const summarize = (battery: readonly JudgeObservation[], offered?: { battery: number }) =>
    summarizeJudge(session, "correctness-model@g1", EVALUATED_PIN, battery, offered);

  it("records no control census: the evidence is unvalidated and still an advisory comparison", () => {
    const evidence = summarize([observation("t1", false, { verifier: true })]);
    expect(evidence).toMatchObject({
      judge: "unvalidated",
      offered: 1,
      disagreements: 1,
      disagreementDenominator: 1,
    });
    expect(judgeDecision(evidence)).toBe("advisory-comparison");
    expect("controlValidity" in evidence).toBe(false);
    expect("calibration" in evidence).toBe(false);
    expect(() => validateJudgeEvidence(evidence)).not.toThrow();
  });

  it("counts a veto only for a cited fail of a verifier pass that a second sample confirmed", () => {
    const evidence = summarize([
      observation("t1", false, {
        verifier: true,
        rules: [EVERY_STOP_IS_VISITED_ONCE],
        confirmation: false,
      }),
      observation("t2", false, { verifier: true }),
      observation("t3", true, { verifier: false, rules: ["misplaced"] }),
      observation("t4", true, { verifier: true }),
      observation("t5", false, { verifier: true, rules: [EVERY_STOP_IS_VISITED_ONCE], confirmation: true }),
      observation("t6", false, { verifier: true, rules: [EVERY_STOP_IS_VISITED_ONCE] }),
    ]);
    expect(evidence).toMatchObject({
      disagreements: 5,
      verifierPassJudgeFail: 4,
      vetoed: 1,
    });
    expect(() => validateJudgeEvidence(evidence)).not.toThrow();
    if (evidence.judge === "off") throw new Error("the census ran");
    expect(() => validateJudgeEvidence({ ...evidence, vetoed: 5 })).toThrow(/vetoed/);
  });

  it("a review in which every attempt failed reads as a non-result, not a comparison", () => {
    // Each subject's typed errorKind stays in its own cases/<taskId>/judge.json; the aggregate
    // records only that nothing came back.
    const evidence = summarize([
      observation("t1", null, { verifier: true, errorKind: "provider", error: "turn refused" }),
      observation("t2", null, { verifier: false, errorKind: "provider", error: "turn refused" }),
      observation("t3", null, { verifier: true, errorKind: "transport", error: "socket reset" }),
    ]);
    expect(evidence).toMatchObject({ offered: 3, verdicts: 0 });
    expect(judgeDecision(evidence)).toBe("non-result");
    expect(() => validateJudgeEvidence(evidence)).not.toThrow();
  });

  it("an incomplete battery review discloses the rate but proves neither direction", () => {
    const evidence = summarize([
      observation("disagree", false, { verifier: true }),
      observation("null-1", null, { verifier: true }),
      observation("verifier-null", false, { verifier: null }),
    ]);
    expect(evidence).toMatchObject({
      disagreementDenominator: 1,
      disagreements: 1,
      offered: 3,
      verdicts: 2,
    });
    expect(judgeDecision(evidence)).toBe("incomplete-census");
    expect(() => validateJudgeEvidence(evidence)).not.toThrow();
  });

  it("complete reviews retain raw disagreement counts without a materiality threshold", () => {
    const evidence = summarize([
      observation("strict-verifier", false, { verifier: true }),
      observation("lax-verifier", true, { verifier: false }),
      observation("agree", true, { verifier: true }),
    ]);
    expect(evidence).toMatchObject({
      disagreements: 2,
      disagreementDenominator: 3,
      verifierPassJudgeFail: 1,
    });
    expect(judgeDecision(evidence)).toBe("advisory-comparison");
    expect(() => validateJudgeEvidence(evidence)).not.toThrow();
  });

  it("an unconfigured judge is explicitly off", () => {
    expect(summarizeJudge(undefined, "correctness-model@g1", EVALUATED_PIN, [])).toEqual({ judge: "off" });
  });

  it("an aborted battery keeps the offered denominator: unattempted subjects stay offered", () => {
    // Three eligible artifacts were offered; the review aborted after one completed observation.
    const aborted = summarize([observation("t1", true, { verifier: true })], { battery: 3 });
    expect(aborted).toMatchObject({ offered: 3, verdicts: 1 });
    expect(judgeDecision(aborted)).toBe("incomplete-census");
    expect(() => validateJudgeEvidence(aborted)).not.toThrow();
    // A stated denominator below the completed observations is a controller contradiction.
    expect(() =>
      summarize([observation("t1", true, { verifier: true }), observation("t2", true, { verifier: true })], {
        battery: 1,
      }),
    ).toThrow(/cannot be below/);
  });

  it("records both pins, from which independence derives", () => {
    const crossFamily = summarize([observation("t1", true, { verifier: true })]);
    // The label compares model names; it does not prove independent errors or reasoning.
    expect(crossFamily).toMatchObject({ judgePin: session.pin, evaluatedPin: EVALUATED_PIN });
    expect(evaluatorIndependence("scripted/judge", EVALUATED_PIN)).toBe("different-family");
    expect(evaluatorIndependence(EVALUATED_PIN, EVALUATED_PIN)).toBe("same-model");
  });

  it("rejects contradictory observations before aggregation", () => {
    // Evidence sanitized by a different sanitizer generation.
    const stale = observation("t1", true, { verifier: true });
    stale.evidence.sanitizer = { version: "judge-sanitizer/v0", modified: false, actions: [] };
    expect(() => summarize([stale])).toThrow(/sanitizer "judge-sanitizer\/v0"/);
    const crossed = observation("t2", true, { verifier: true });
    crossed.evidence.judgePin = "claude/other-judge";
    expect(() => summarize([crossed])).toThrow(/not aggregate session/);
  });
});
