/**
 * The review slot decides who reviews and on what terms, and every case here reads that without
 * reaching a provider. `reviewSlotPin` names no evaluator when the slot is disabled, however it
 * came to be disabled, and names the enabled slot's condition with OpenRouter's provider routing.
 * `judgeSessionFor` returns no census session for a disabled slot and, for an enabled one, carries
 * the pin and the census prompt digest without resolving a credential at all.
 *
 * Opening a session is where a credential finally matters, and a missing one is the environment's
 * refusal rather than a review that failed. An unpinned slot opens at the Judge's high effort with
 * no web search, and a session presents the one shared account token. The reader's continuations
 * are bounded rather than open-ended: they share one deadline across settled turns and dispose on
 * expiry, and they charge the same provider budget while preserving its interruption.
 */
import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { EnvironmentRefusal } from "../src/backends/environment-refusal.ts";
import type { ReviewChoice } from "../src/backends/resolve.ts";
import { READER_DEADLINE_MS, runReaderTurn } from "../src/review/review-reader.ts";
import {
  judgeSessionFor,
  openReviewSession,
  reviewSlot,
  reviewSlotPin,
} from "../src/review/review-session.ts";
import {
  ProviderResourceBudget,
  ProviderResourceBudgetExhausted,
} from "../src/run/provider-resource-budget.ts";
import { ACTIVE_JUDGE_PROMPT_DIGESTS } from "../src/truth/judge-prompt-policy.ts";
import { required } from "./helpers/doubles.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

type EnabledReview = Extract<ReviewChoice, { enabled: true }>;

const DISABLED: ReviewChoice[] = [
  { enabled: false, source: "unconfigured" },
  { enabled: false, source: "operator" },
];
const ROUTED: EnabledReview = {
  enabled: true,
  kind: "openrouter",
  model: "openai/gpt-4o-mini",
  source: "operator",
};
const CLAUDE: EnabledReview = { enabled: true, kind: "claude", model: "claude-opus-5", source: "env" };

afterAll(cleanupScratch);

/** A repository whose `.env` is the only credential source; the test preload strips the process's. */
function repoWith(env: Record<string, string>): string {
  const root = scratchDir("ana-review-session-");
  writeFileSync(
    join(root, ".env"),
    Object.entries(env)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
  return root;
}

describe("reviewSlotPin", () => {
  it("names no evaluator when the slot is disabled, however it came to be", () => {
    for (const review of DISABLED) expect(reviewSlotPin(review)).toBeNull();
  });

  it("names the enabled slot's condition, with openrouter's provider routing", () => {
    expect(reviewSlotPin(CLAUDE)).toBe("claude/claude-opus-5");
    expect(reviewSlotPin(ROUTED)).toBe("openrouter/openai/gpt-4o-mini@providers=unconstrained");
    expect(reviewSlotPin({ ...ROUTED, providerPin: ["anthropic", "google"] })).toBe(
      "openrouter/openai/gpt-4o-mini@providers=anthropic,google",
    );
  });
});

describe("judgeSessionFor", () => {
  it("returns no census session when the slot is disabled", () => {
    for (const review of DISABLED) expect(judgeSessionFor(review, repoWith({}))).toBeNull();
  });

  it("carries the slot's pin and the census prompt digest without resolving a credential", () => {
    // No credential anywhere: the session resolves its slot when a subject opens one, not here.
    const session = required(judgeSessionFor(ROUTED, repoWith({})), "an enabled review's census session");
    expect(session.pin).toBe("openrouter/openai/gpt-4o-mini@providers=unconstrained");
    expect(session.promptPolicyDigest).toBe(ACTIVE_JUDGE_PROMPT_DIGESTS.census);
  });
});

describe("review sessions", () => {
  it("refuses to open a session whose credential is missing, as the environment's refusal", async () => {
    const work = openReviewSession(ROUTED, repoWith({}), [], "framing");
    await expect(work).rejects.toThrow("OPENROUTER_API_KEY is required for the openrouter transport");
    await expect(work).rejects.toBeInstanceOf(EnvironmentRefusal);
  });

  it("opens an unpinned slot at the Judge's high effort, without web search", () => {
    const slot = reviewSlot(CLAUDE, repoWith({ CLAUDE_CODE_OAUTH_TOKEN: "fake-shared-token" }));
    expect(slot.profile).toEqual({
      provider: "anthropic",
      transport: "claude",
      model: "claude-opus-5",
      thinkingLevel: "high",
      compaction: "claude-ss",
    });
    const pinned = reviewSlot(
      { ...CLAUDE, reasoningEffort: "max" },
      repoWith({ CLAUDE_CODE_OAUTH_TOKEN: "x" }),
    );
    expect(pinned.profile.thinkingLevel).toBe("max");
  });

  it("presents the one shared account token", async () => {
    const shared = { CLAUDE_CODE_OAUTH_TOKEN: "fake-shared-token" };
    expect(await reviewSlot(CLAUDE, repoWith(shared)).auth()).toEqual({
      type: "bearer",
      token: "fake-shared-token",
    });
  });
});

// The reader shares one deadline and one provider allowance across its continuations, and only
// these two cases fail when it stops doing so.
describe("reader continuation limits", () => {
  it("shares one deadline across settled turns and disposes on expiry", async () => {
    let now = 1_000,
      disposals = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    const timeouts: number[] = [];
    try {
      const result = await runReaderTurn({
        review: CLAUDE,
        repoRoot: "/repo",
        role: "reader",
        tools: [],
        systemPrompt: "read",
        prompt: "first",
        continuePrompt: () => "continue",
        openSession: async () => ({
          backend: "claude",
          sessionId: "pi-test",
          configure() {},
          abort() {},
          async dispose() {
            disposals++;
          },
          async runTurn({ turnTimeoutMs }) {
            timeouts.push(required(turnTimeoutMs, "turn timeout"));
            now += READER_DEADLINE_MS / 2;
            return { status: "completed", assistantText: "partial" };
          },
        }),
      });
      expect(timeouts).toEqual([READER_DEADLINE_MS, READER_DEADLINE_MS / 2]);
      expect(result.error).toContain("review deadline reached");
      expect(disposals).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });

  it("charges continuations to the same provider budget and preserves its interruption", async () => {
    const providerBudget = new ProviderResourceBudget(1);
    let turns = 0,
      disposals = 0;
    try {
      await expect(
        runReaderTurn({
          review: CLAUDE,
          repoRoot: "/repo",
          role: "reader",
          tools: [],
          systemPrompt: "read",
          prompt: "first",
          providerBudget,
          continuePrompt: () => "continue",
          openSession: async () => ({
            backend: "claude",
            sessionId: "pi-test",
            configure() {},
            abort() {},
            async dispose() {
              disposals++;
            },
            async runTurn() {
              turns++;
              return { status: "completed" };
            },
          }),
        }),
      ).rejects.toBeInstanceOf(ProviderResourceBudgetExhausted);
      expect([turns, disposals]).toEqual([1, 1]);
      expect(providerBudget.snapshot()).toMatchObject({ used: 1, active: 0, byRole: { review: 1 } });
    } finally {
      providerBudget.terminalSnapshot();
    }
  });
});
