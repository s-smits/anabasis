/**
 * The declared-key allowlist on the review surface that hands a controller-built object to a
 * model. A hostile review probe on w29 planted an undeclared field inside a declared object
 * and it reached the Judge prompt 2/2, because the surface rebuilt only its top-level keys and the
 * sanitizer normalizes bytes rather than removing them.
 *
 * The first test checks byte equality: on well-formed input the allowlist changes nothing —
 * the same model-visible prompt bytes and the same recorded digests as the pre-allowlist path, which
 * is computed here from the same inputs rather than pinned as a literal.
 */
import { describe, expect, it } from "bun:test";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { JUDGE_PUBLIC_CONTEXT_DECLARATION, projectDeclared } from "../src/truth/declared-projection.ts";
import {
  type JudgeAttempt,
  type JudgeInput,
  type JudgePublicContext,
  type JudgePublicDomain,
  type JudgePublicTask,
  type JudgeRequest,
  judgeSubject,
} from "../src/truth/judge.ts";
import { judgeTurnPrompt } from "../src/truth/judge-framing.ts";
import { sanitizeForEvaluator } from "../src/truth/sanitize.ts";
import { double, required } from "./helpers/doubles.ts";

const DOMAIN: JudgePublicDomain = {
  slug: "route",
  domain: "routing",
  publicRequest: "plan a delivery route",
  artifactSchema: [{ name: "route", carries: "string[]" }],
  publicResources: [{ name: "design-rule-constants", content: { maxStops: 4 }, digest: "d".repeat(64) }],
  toolContract: {
    presets: ["writer"],
    tools: [{ name: "plan_route", kind: "adviser", description: "propose an ordering" }],
    availableToolNames: ["plan_route", "submit"],
  },
  runtimeFacts: {
    capabilities: ["python3"],
    maxSubmitAttempts: 3,
    condition: { variant: "shipping", advisorsRemoved: [], toolInterfaceHash: "a".repeat(64) },
  },
};

/** `publicInput` is declared `unknown`, so its own nested keys are task bytes and stay whole. */
const TASK: JudgePublicTask = {
  taskId: "task-1",
  family: "routing",
  publicInput: { stops: ["a", "b"], window: { open: "08:00", close: "17:00" } },
  publicValidityRules: [{ assertion: "every stop appears once", publicInputPaths: ["stops"] }],
};

const REQUEST: JudgeRequest = {
  subjectId: "task-1",
  publicContext: { domain: DOMAIN, publicTask: TASK },
  submittedArtifact: { route: ["a", "b"] },
};

const VERDICT: JudgeAttempt = {
  verdict: true,
  abstained: false,
  rationale: "the route visits both stops",
  rules: [],
  error: null,
  errorKind: null,
  turns: 1,
};

/** Exactly what the pre-allowlist path produced: the same top-level rebuild and the same
 *  sanitizer, with no declared-key projection between them. */
function preAllowlistInput(request: JudgeRequest): JudgeInput {
  const sanitized = sanitizeForEvaluator({
    publicContext: {
      domain: request.publicContext.domain,
      publicTask: request.publicContext.publicTask,
    },
    submittedArtifact: request.submittedArtifact,
  });
  return double<JudgeInput>(sanitized.value);
}

/** Run one subject and return the exact input the session was handed. */
async function judgedInput(request: JudgeRequest): Promise<JudgeInput> {
  const seen: JudgeInput[] = [];
  await judgeSubject(
    {
      pin: "scripted/judge",
      invoke: async (input) => {
        seen.push(input);
        return VERDICT;
      },
    },
    request,
    "battery-case",
  );
  return required(seen[0], "the judge session input");
}

/** The Judge's context under its own declaration; the production call site says the same thing. */
function projectJudgeContext(context: JudgePublicContext): JudgePublicContext {
  return projectDeclared(context, JUDGE_PUBLIC_CONTEXT_DECLARATION);
}

describe("the Judge public context allowlist", () => {
  it("leaves a well-formed input byte-identical: same prompt bytes and same recorded digests", async () => {
    const baseline = preAllowlistInput(REQUEST);
    const seen: JudgeInput[] = [];
    const evidence = await judgeSubject(
      {
        pin: "scripted/judge",
        invoke: async (input) => {
          seen.push(input);
          return VERDICT;
        },
      },
      REQUEST,
      "battery-case",
    );
    const input = required(seen[0], "the judge session input");
    // The model surface itself, not a re-serialization of it: judgeTurnPrompt is the only writer
    // of the bytes a census judge reads.
    expect(judgeTurnPrompt(input, "Call record_judge_verdict exactly once.")).toBe(
      judgeTurnPrompt(baseline, "Call record_judge_verdict exactly once."),
    );
    expect(JSON.stringify(input)).toBe(JSON.stringify(baseline));
    expect(evidence).toMatchObject({
      schema: "judge-subject/v3",
      publicContextDigest: hashJsonValue(baseline.publicContext),
      judgeInputDigest: hashJsonValue(baseline),
    });
  });

  it("drops an undeclared field nested inside a declared object and inside an array element", async () => {
    const request: JudgeRequest = {
      ...REQUEST,
      publicContext: {
        domain: double<JudgePublicDomain>({
          ...DOMAIN,
          publicResources: [
            { ...required(DOMAIN.publicResources[0], "resource"), referenceArtifact: "PROTECTED-REFERENCE" },
          ],
          toolContract: {
            ...required(DOMAIN.toolContract, "toolContract"),
            tools: [
              {
                ...required(required(DOMAIN.toolContract, "toolContract").tools[0], "tool"),
                remedy: "PROTECTED-REMEDY",
              },
            ],
          },
          runtimeFacts: {
            ...required(DOMAIN.runtimeFacts, "runtimeFacts"),
            verifierSource: "PROTECTED-SOURCE",
            condition: {
              ...required(required(DOMAIN.runtimeFacts, "runtimeFacts").condition, "condition"),
              failureLocation: "PROTECTED-LOCATION",
            },
          },
        }),
        publicTask: double<JudgePublicTask>({
          ...TASK,
          hiddenExpectation: "PROTECTED-EXPECTATION",
          publicValidityRules: [
            {
              ...required(TASK.publicValidityRules?.[0], "rule"),
              checkId: "PROTECTED-CHECK-ID",
            },
          ],
        }),
      },
    };
    const prompt = judgeTurnPrompt(await judgedInput(request), "check");
    expect(prompt).not.toContain("PROTECTED");
    // The declared siblings of every dropped field survive; removing one field must preserve them.
    for (const kept of ["plan_route", "python3", "design-rule-constants", "every stop appears once"]) {
      expect(prompt).toContain(kept);
    }
  });

  it("keeps opaque contract fields whole, because the contract declares them unknown", () => {
    const projected = projectJudgeContext({
      domain: { ...DOMAIN, artifactSchema: { anything: { nested: ["deep"] } } },
      publicTask: TASK,
    });
    expect(projected.domain.artifactSchema).toEqual({ anything: { nested: ["deep"] } });
    expect(projected.publicTask?.publicInput).toEqual({
      stops: ["a", "b"],
      window: { open: "08:00", close: "17:00" },
    });
  });

  it("drops a declared key whose value contradicts its declared kind", () => {
    const projected = projectJudgeContext({
      domain: double<JudgePublicDomain>({ ...DOMAIN, slug: { leak: "PROTECTED-SOURCE" } }),
      publicTask: TASK,
    });
    expect(JSON.stringify(projected)).not.toContain("PROTECTED");
    expect("slug" in projected.domain).toBe(false);
    expect(projected.domain.domain).toBe("routing");
  });

  it("passes a declared null through unchanged", () => {
    const projected = projectJudgeContext({
      domain: { ...DOMAIN, publicRequest: null, toolContract: null },
      publicTask: TASK,
    });
    expect(projected).toEqual({
      domain: { ...DOMAIN, publicRequest: null, toolContract: null },
      publicTask: TASK,
    });
  });
});
