/**
 * The condition an operator may ask a paid run to measure.
 *
 * Every refusal here arrives before the first provider call. A flag read wrongly does not fail a
 * run — it measures a different condition and records it as the intended one, which is what a
 * frozen prediction is meant to catch — so each value is narrowed at the argv boundary and
 * nothing downstream re-reads a raw string.
 */

import { admitBackendSelection } from "../backends/project-backends.ts";
import type { BackendSlot, ProjectBackendSelection } from "../backends/resolve.ts";
import { builtSolveConcurrency, reviewConcurrency } from "./session-pool.ts";

/** The one policy an invocation may fix: measure and stop only. */
type ProductPolicy = "fixed";

export interface FullRunArgs {
  prompt?: string;
  contextPaths?: string[];
  /** Explicit project to continue. Absent always creates a fresh project. */
  project?: string;
  /** Exact clean source identity frozen by an operator checkpoint. */
  expectedSource?: { commit: string; sourceDigest: string };
  runId?: string;
  /** Operator interruption after N completed rounds, separate from a difficulty decision.
   *  When absent, there is no round cap; typed terminal reasons still record each stop. */
  maxIterations?: number;
  /** Operator interruption once the loop has run this long: no new round opens after it, and the
   *  round in flight still records its battery, so nothing is killed. The alternative is a manual
   *  kill, which discards every accepted artifact the round has not yet verified. */
  stopAfterMs?: number;
  /** Builder session turns per iteration; absent, a round has no turn cap. A staged rehearsal sets a
   *  small value so the session settles at the ceiling instead of running to a submit. */
  maxBuilderTurns?: number;
  expectedTasks?: number;
  /**
   * Campaign cap on reserved Builder model calls (`--iteration-budget`), stored in the
   * controller ledger and reported as `turnBudget`. Cancelled reservations do not count.
   * Null clears the cap; absence leaves it unchanged. `maxIterations` separately caps outer
   * controller rounds for this invocation.
   */
  turnBudget?: number | null;
  /** Finite outer provider turns across Builder, Built Harness and every Review caller. */
  providerTurnBudget?: number;
  /** Opt-in invocation boundary: agent, correctness model and battery stay fixed; only measure and stop run. */
  productPolicy?: ProductPolicy;
  /** Install or require the host-native Builder command guard before the controller writes.
   *  CLI admission defaults this to true; false is the explicit opt-out. */
  dcg?: boolean;
  /** Absolute controller-owned engine profile captured before the Builder opens. */
  backendSelections?: Partial<Record<BackendSlot, ProjectBackendSelection>>;
}

const FULL_RUN_USAGE =
  'usage: fullrun --prompt "<request>" --provider-turn-budget N [--project <id>] [--context <path> ...] [--expected-source <commit>:<digest>] [--run <runId>] [--max-iterations N] [--stop-after-ms N] [--max-builder-turns N] [--expected-tasks N] [--iteration-budget N|none] [--product-policy fixed] [--dcg true|false] [--builder-backend <kind>] [--built-backend <kind>] [--review-backend <kind|disabled|inherit>]';

/** What one flag does to the arguments. The flag name is passed back in so the appliers below
 *  can stay one line each and still name themselves in their refusals. */
type Apply = (args: FullRunArgs, value: string, flag: string) => void;

/** A flag that once existed is worth more than "unknown": the operator wants its replacement. */
const RETIRED = new Map<string, string>([
  [
    "--max-turns",
    "was removed: the Built solver keeps its per-case turn cap (BUILT_DEFAULT_MAX_TURNS in src/backends/pi-built.ts), and --max-builder-turns caps the Builder session",
  ],
  [
    "--turn-budget",
    "was renamed --iteration-budget: it limits durable authoring/session-call units across the campaign, not outer controller rounds",
  ],
]);

function count(flag: string, value: string): number {
  const parsed = Number.parseInt(value, 10);
  // The regexp is the narrowing: parseInt alone reads "1.5", " 2" and "0x2" as counts.
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag}: expected a positive integer, got "${value}"`);
  }
  return parsed;
}

function truth(flag: string, value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${flag}: expected true | false, got "${value}"`);
}

function sourceIdentity(value: string): NonNullable<FullRunArgs["expectedSource"]> {
  // Lowercase is part of the shape: the digest is compared byte for byte against the recorded
  // identity, so an uppercase spelling admitted here would mismatch at launch instead.
  if (!/^[0-9a-f]{40}:[0-9a-f]{64}$/.test(value)) {
    throw new Error(
      `--expected-source: expected <40-char lowercase commit>:<64-char lowercase executable digest>, got "${value}"`,
    );
  }
  return { commit: value.slice(0, 40), sourceDigest: value.slice(41) };
}

/** The five flags that are a plain count. */
function counted(
  field: "maxIterations" | "stopAfterMs" | "maxBuilderTurns" | "expectedTasks" | "providerTurnBudget",
): Apply {
  return (args, value, flag) => {
    args[field] = count(flag, value);
  };
}

/** The three that are a plain string, taken as the operator typed them. */
function text(field: "prompt" | "project" | "runId"): Apply {
  return (args, value) => {
    args[field] = value;
  };
}

function backend(slot: BackendSlot): Apply {
  return (args, value) => {
    args.backendSelections = { ...args.backendSelections, [slot]: admitBackendSelection(slot, value) };
  };
}

/** One table, so the accepted flags and what they do cannot drift apart. The previous pair — a
 *  name set beside an if-else chain — ended in an `else` that sliced a backend slot name out of
 *  whatever flag had no branch, resting on an assertion that the two lists agreed. */
const FLAGS = new Map<string, Apply>([
  ["--prompt", text("prompt")],
  ["--project", text("project")],
  ["--run", text("runId")],
  ["--max-iterations", counted("maxIterations")],
  ["--stop-after-ms", counted("stopAfterMs")],
  ["--max-builder-turns", counted("maxBuilderTurns")],
  ["--expected-tasks", counted("expectedTasks")],
  ["--provider-turn-budget", counted("providerTurnBudget")],
  ["--builder-backend", backend("builder")],
  ["--built-backend", backend("built")],
  ["--review-backend", backend("review")],
  [
    "--context",
    (args, value) => {
      args.contextPaths = [...(args.contextPaths ?? []), value];
    },
  ],
  [
    "--expected-source",
    (args, value) => {
      args.expectedSource = sourceIdentity(value);
    },
  ],
  [
    "--iteration-budget",
    (args, value, flag) => {
      args.turnBudget = value === "none" ? null : count(flag, value);
    },
  ],
  [
    "--product-policy",
    (args, value) => {
      if (value !== "fixed") throw new Error(`--product-policy: expected fixed, got "${value}"`);
      args.productPolicy = value;
    },
  ],
  [
    "--dcg",
    (args, value, flag) => {
      args.dcg = truth(flag, value);
    },
  ],
]);

export function parseFullRunArgs(argv: string[]): FullRunArgs {
  const args: FullRunArgs = { dcg: true };
  const seen = new Set<string>();
  const remaining = [...argv];
  while (remaining.length > 0) {
    const flag = remaining.shift() ?? "";
    const apply = FLAGS.get(flag);
    if (apply === undefined) {
      const retired = RETIRED.get(flag);
      throw new Error(
        `${retired === undefined ? `unknown flag ${flag}` : `${flag} ${retired}`} — ${FULL_RUN_USAGE}`,
      );
    }
    const value = remaining.shift();
    if (value === undefined) throw new Error(`${flag}: missing value`);
    // `--context` is the one flag that accumulates; every other repeat is an operator mistake a
    // run would otherwise resolve silently to whichever copy came last.
    if (flag !== "--context") {
      if (seen.has(flag)) throw new Error(`${flag}: may be specified only once`);
      seen.add(flag);
    }
    apply(args, value, flag);
  }
  if (args.prompt === undefined || args.prompt.trim() === "") throw new Error("state a non-empty --prompt");
  // Refuse a malformed operator width before any paid call rather than at the first battery.
  builtSolveConcurrency();
  reviewConcurrency();
  return args;
}
