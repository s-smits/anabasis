/**
 * Shared session lifecycle for the diagnosis reader
 * (`diagnosis-reader.ts`) and the epoch reviewer (`epoch-reviewer.ts`). Both open one fresh review
 * session, read within one bounded allowance, deliver through in-process tools, and dispose.
 * Neither may change a pass, an acceptance, a claim or a promotion: the result is advice
 * attached to controller-owned evidence, and the controller decides what to do with it.
 *
 * Two readers, one lifecycle. The review callers each used to carry their own session factory,
 * prompt assembly, response parser and evidence writer; this module is the part they actually
 * shared. The reader-specific choices -- what the session reads, what it may report, and where its
 * output is recorded -- stay with each reader.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "../meta/json-shape.ts";
import type { HostSession } from "../backends/pi-session.ts";
import { backendConditionPin } from "../backends/resolve.ts";
import type { RunObserver } from "../observe/run-observer.ts";
import {
  isProviderResourceBudgetInterruption,
  runBudgetedAgentTurn,
} from "../run/provider-resource-budget.ts";
import type { ProviderResourceBudget } from "../run/provider-resource-budget.ts";
import { type EnabledReview, openReviewSession } from "./review-session.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { boundText } from "../meta/bounded-text.ts";

/** Every reader turn records the same three facts: the slot it ran on, what the model said, and
 *  why the turn failed, when it did. A switched-off slot opens no turn, so it is no turn's state. */
export type ReaderTurn = {
  pin: string | null;
  text: string;
  error: string | null;
};

/** How one review reading ended: read; not owed, with the reason; or owed and not done, with why.
 *  Only the last is absent work, and it must never read as a review that found nothing. */
export type ReviewOutcome =
  | { kind: "read" }
  | { kind: "skipped"; reason: string }
  | { kind: "absent"; why: string };

/** One reader session's deadline, continuations included. A review settles in a few minutes, so
 *  the bound is not a throughput limit; it exists for the tail, where a review still working runs
 *  into the Judge's 30-minute turn wall and loses its findings to it. An hour is the session's own
 *  turn ceiling, so nothing below this cuts a review that is still working. */
export const READER_DEADLINE_MS = 60 * 60_000;

interface ReaderTurnInput {
  review: EnabledReview;
  repoRoot: string;
  /** Names the reader in a failure clause. */
  role: string;
  /** Controller-owned in-process tools; the reader's output arrives through one of them. */
  tools: ReaderTool[];
  systemPrompt: string;
  prompt: string;
  /** After a settled successful turn, the next prompt back to unfinished work. Null ends reading. */
  continuePrompt?: () => string | null;
  /** Same lifecycle with a deterministic session in tests; production resolves the review slot. */
  openSession?: () => Promise<HostSession>;
  providerBudget?: ProviderResourceBudget;
}

export type ReaderToolResult = { content: Array<{ type: "text"; text: string }>; details: null };

/** A reader tool: pi's tool shape, whose `parameters` a controller-written JSON schema fills
 *  (`readerParameters`) and whose `details` stay null. */
export type ReaderTool = AgentTool<never, null>;

/** The controller terminal's absent steps: one line per named reading whose outcome is absent. */
export function absentLines(outcomes: Readonly<Record<string, ReviewOutcome>>): string[] {
  return Object.entries(outcomes).flatMap(([name, outcome]) =>
    outcome.kind === "absent" ? [`${name}: ${outcome.why}`] : [],
  );
}

/** Open a reader's analyse phase row, and return what closes it on the reading's outcome. */
export function readerPhase(role: string, observer: RunObserver | undefined) {
  observer?.phase({ phase: "analyse", state: "started", summary: `${role} started` });
  return (outcome: ReviewOutcome) =>
    observer?.phase({
      phase: "analyse",
      state: outcome.kind === "absent" ? "failed" : "completed",
      summary: `${role} ${outcome.kind === "absent" ? outcome.why : "completed"}`,
    });
}

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
  const { review, repoRoot, role } = input;
  let session: HostSession | null = null;
  let error: string | null = null;
  let text = "";
  try {
    session = await (input.openSession?.() ??
      openReviewSession(review, repoRoot, input.tools, input.systemPrompt));
    ({ text, error } = await readInSession(session, input));
  } catch (cause: unknown) {
    if (isProviderResourceBudgetInterruption(cause)) throw cause;
    error = boundText(`${role}: ${errorMessage(cause)}`, 300).shown;
  } finally {
    try {
      await session?.dispose();
    } catch (cause: unknown) {
      error ??= boundText(`${role} dispose failed: ${errorMessage(cause)}`, 300).shown;
    }
  }
  return { pin: backendConditionPin(review), text, error };
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
    text = result.finalText ?? "";
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
