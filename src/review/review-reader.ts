/**
 * Shared session lifecycle for the diagnosis reader
 * (`diagnosis-reader.ts`) and the epoch reviewer (`epoch-reviewer.ts`). Both open one fresh review
 * session, read within one bounded allowance, deliver through in-process tools, and dispose.
 * Neither may change a pass, an acceptance, a claim or a promotion: the result is advice
 * attached to controller-owned evidence, and the controller decides what to do with it.
 *
 * Two readers, one lifecycle. The four review callers removed on 2026-09-04 each carried their own
 * session factory, prompt assembly, response parser and evidence writer; this module is the part
 * they actually shared. The reader-specific choices -- what the session reads, what it may report,
 * and where its output is recorded -- stay with each reader.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "../meta/json-shape.ts";
import type { HostSession } from "../backends/pi-session.ts";
import type { ReviewChoice } from "../backends/resolve.ts";
import type { RunObserver } from "../observe/run-observer.ts";
import {
  isProviderResourceBudgetInterruption,
  runBudgetedAgentTurn,
} from "../run/provider-resource-budget.ts";
import type { ProviderResourceBudget } from "../run/provider-resource-budget.ts";
import { openReviewSession, reviewSlotPin } from "./review-session.ts";
import { errorMessage } from "../meta/runtime-values.ts";

/** Every reader records the same three facts: the slot it ran on, what the model said, and the
 *  one typed reason it produced nothing. `pin: null` with `error: "review-slot-off"` is the
 *  explicit disabled state, not a failure. */
export type ReaderTurn = {
  pin: string | null;
  text: string;
  error: string | null;
};

/** One reader session's deadline, continuations included. 246 recorded epoch reviews took a median
 *  of 4 minutes, so the bound is not a throughput limit; it exists for the tail, where one review
 *  reached the Judge's 30-minute wall and lost its findings to it. An hour is the session's own
 *  turn ceiling, so nothing below this cuts a review that is still working. */
export const READER_DEADLINE_MS = 60 * 60_000;

interface ReaderTurnInput {
  review: ReviewChoice;
  repoRoot: string;
  /** Names the reader in the observability stream and in a failure clause. */
  role: string;
  /** Controller-owned in-process tools; the reader's output arrives through one of them. */
  tools: ReaderTool[];
  systemPrompt: string;
  prompt: string;
  /** After a settled successful turn, the reader may expose unfinished work. Null ends reading. */
  continuePrompt?: () => string | null;
  /** Same lifecycle with a deterministic session in tests; production resolves the review slot. */
  openSession?: () => Promise<HostSession>;
  observer?: RunObserver;
  providerBudget?: ProviderResourceBudget;
}

export type ReaderToolResult = { content: Array<{ type: "text"; text: string }>; details: null };

/** A reader tool: pi's tool shape, whose `parameters` a controller-written JSON schema fills
 *  (`readerParameters`) and whose `details` stay null. */
export type ReaderTool = AgentTool<never, null>;

/** A controller-written JSON schema as a reader tool's parameters. */
export function readerParameters(schema: Record<string, JsonValue>): never {
  // SAFETY: `AgentTool<never>` is the roster's common type, whose `parameters` is `never`. pi
  // validates every call against this schema before execute runs, and each reader parses the
  // fields it reads, so execute's object argument holds.
  return schema as never;
}
/**
 * One reader session: open, read within one deadline, dispose. A provider budget interruption
 * rethrows because the controller owns the run's stop; every other failure becomes a typed error,
 * so the caller drops the turn's output and records why rather than reading an empty result as
 * agreement.
 */
export async function runReaderTurn(input: ReaderTurnInput): Promise<ReaderTurn> {
  const { review, repoRoot, role, observer } = input;
  const pin = reviewSlotPin(review);
  if (!review.enabled) return { pin, text: "", error: "review-slot-off" };
  const phase = observer?.phase({ phase: "analyse", state: "started", summary: `${role} started` });
  let session: HostSession | null = null;
  let error: string | null = null;
  let text = "";
  try {
    session = await (input.openSession?.() ??
      openReviewSession(review, repoRoot, input.tools, input.systemPrompt));
    ({ text, error } = await readInSession(session, input));
  } catch (cause: unknown) {
    if (isProviderResourceBudgetInterruption(cause)) throw cause;
    error = `${role}: ${errorMessage(cause)}`.slice(0, 300);
  } finally {
    try {
      await session?.dispose();
    } catch (cause: unknown) {
      error ??= `${role} dispose failed: ${errorMessage(cause)}`.slice(0, 300);
    }
  }
  if (phase !== undefined) {
    observer?.phase({
      phase: "analyse",
      state: error === null ? "completed" : "failed",
      summary: `${role} ${error ?? "completed"}`,
    });
  }
  return { pin, text, error };
}

/** Continuations share one deadline and provider allowance; a failed turn is never retried. */
async function readInSession(
  session: HostSession,
  input: ReaderTurnInput,
): Promise<Pick<ReaderTurn, "text" | "error">> {
  const { role } = input;
  let text = "",
    error: string | null = null;
  const deadline = Date.now() + READER_DEADLINE_MS;
  let prompt: string | null = input.prompt;
  while (prompt !== null) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      error = `${role}: review deadline reached`;
      break;
    }
    const result = await runBudgetedAgentTurn(
      session,
      { prompt, turnTimeoutMs: remaining },
      input.providerBudget,
      "review",
    );
    text = result.assistantText?.trim() ?? "";
    if (result.status !== "completed") {
      error = `${role} turn ${result.status}: ${result.errorMessages?.join("; ") ?? "no error recorded"}`;
      break;
    }
    prompt = input.continuePrompt?.() ?? null;
  }
  return { text, error };
}

/** The tool return shape every reader tool uses: `content` is the whole model-visible result and
 *  `details` stays null, keeping everything told to the reader in the visible content. */
export function readerToolText(text: string): ReaderToolResult {
  return { content: [{ type: "text" as const, text }], details: null };
}
