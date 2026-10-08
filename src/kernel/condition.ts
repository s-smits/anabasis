/**
 * A condition: everything that could change a solve's result, as one content-addressed record. Two
 * solves are comparable only when their conditions differ in the one thing being compared.
 *
 * The host sets every field; the Builder sets none. The model, its effort and every limit are the
 * host's, which a Built Harness used to declare for itself: on 7 October each harness state carried
 * its own `config.yaml` naming its wall, turn cap, shell timeouts and concurrency.
 */
import type { OpenRecord } from "../meta/json-shape.ts";
import { hashJsonValue, requireJsonValue, sameJsonValue } from "../meta/stable-json.ts";
import { append, type LogEvent, read } from "./log.ts";
import type { PriceTable } from "./meter.ts";

/**
 * What the host holds every solve to. A harness never sets one: a file or a prompt that asks for a
 * longer wall, more turns, more concurrency or more disk changes nothing.
 */
export type Limits = {
  readonly wallSeconds: number;
  /** The prompts a solver is given, the opening one and each nudge after a turn that ended without a
   *  submit, before the solve stops without an answer of its own: v1's `maxTurns`. */
  readonly turns: number;
  /** How long one shell command runs when the solver names no timeout. A timeout it names only
   *  raises this, up to `shellMaxSeconds`, as v1's Built shell clamped it (built-bash.ts:316-321). */
  readonly shellDefaultSeconds: number;
  /** The longest one shell command may run. */
  readonly shellMaxSeconds: number;
  /** Solves the host runs at once, which moves wall time through the load they put on one another. */
  readonly concurrency: number;
  /**
   * The most bytes one solve's writable roots may hold together, enforced as the size of the volume
   * they sit on (`src/verify/disk-cap.ts`). Neither v1 nor the sweep this plan targets capped disk,
   * so one solve could fill the host's disk under every other. The runner hands the same number to
   * `solveIsolationPolicy`, so a change here moves `sandbox` too.
   */
  readonly diskBytes: number;
};

export interface Condition {
  /** The contract frozen in round 0. */
  readonly contract: string;
  /** The harness version a Builder session ended on. */
  readonly harness: string;
  /** The task version: family, inputs, rule ids and check. */
  readonly task: string;
  /**
   * `provider/model`, a key of `prices`, exactly as the backend is asked for it. A provider may serve
   * an alias from a snapshot of its choosing, so each turn's trace names the snapshot that served it.
   */
  readonly model: string;
  readonly effort: string;
  readonly prices: PriceTable;
  /** The agent runtime's packages by version: pi's, and the backend's own, such as the Agent SDK. */
  readonly runtime: Readonly<Record<string, string>>;
  /** How a full context is made to fit, as the runtime names it; `off` when it never is. */
  readonly compaction: string;
  readonly solverTools: string;
  readonly verifierTools: string;
  /** The digest of the sandbox's policy: what a solve may read, write, run and fill on disk. */
  readonly sandbox: string;
  readonly limits: Limits;
  /** The host's code a solve runs through, by content: `src` and `vendor` as the files stand. A
   *  commit that touches neither opens no new condition, and an uncommitted change to either does,
   *  where a commit id did the opposite on both counts. */
  readonly host: string;
  /** Which side of the pair: the test condition, or the stronger one. */
  readonly side: "test" | "strong";
}

/**
 * What a solve ran under apart from its task and its harness: the solver, its limits, the checker's
 * side and the host. A comparison holds all of it still (`compare.ts`), and so does every reading
 * of how a task stands against a harness (`ladder.ts`): a solve another model made, or the same
 * model under other limits or other host code, is no solve of this solver's.
 */
export type Setting = Omit<Condition, "task" | "harness" | "solverTools">;

/** The condition's identity: the hash of its canonical JSON, so field order does not move it. */
export function conditionId(condition: Condition): string {
  if (condition.prices[condition.model] === undefined) {
    throw new Error(`the condition runs ${condition.model} but prices no such model`);
  }
  return hashJsonValue(condition);
}

/** A setting's identity. A whole condition may be passed: its task and its harness are left out. */
export function settingId(setting: Setting): string {
  const { contract, model, effort, prices, runtime, compaction } = setting;
  const { verifierTools, sandbox, limits, host, side } = setting;
  return hashJsonValue({
    contract,
    model,
    effort,
    prices,
    runtime,
    compaction,
    verifierTools,
    sandbox,
    limits,
    host,
    side,
  });
}

/** The fields two conditions differ in, by name: what a comparison of their solves compares. */
export function fieldsApart(a: Condition, b: Condition): string[] {
  const other: OpenRecord = { ...b };
  return Object.entries(a).flatMap(([field, value]) => (sameJsonValue(value, other[field]) ? [] : [field]));
}

/**
 * Log the condition under its id, once, and return the id. A solve's events name their condition by
 * id alone, so without the record the log could not say which harness, task version or side a solve
 * ran under, nor whether two conditions differ in the one thing being compared. The id is the
 * record's hash, so a second record of it would say nothing new.
 */
export function recordCondition(log: string, condition: Condition): string {
  const id = conditionId(condition);
  if (!read(log).some((event) => event.kind === "condition.recorded" && event.data.id === id)) {
    append(log, "condition.recorded", { id, condition: requireJsonValue(condition) });
  }
  return id;
}

/** Every condition the log records, by id. A record that does not hash to its id is refused: the id
 *  is what every solve names, and a record edited under it would describe solves it never ran. */
export function conditionsOf(events: readonly LogEvent[]): Map<string, Condition> {
  const conditions = new Map<string, Condition>();
  for (const event of events) {
    if (event.kind === "condition.recorded") {
      // SAFETY: only `recordCondition` writes the event, and the hash proves the record whole.
      const condition = event.data.condition as unknown as Condition;
      const id = conditionId(condition);
      if (id !== event.data.id) throw new Error(`${event.at}: a condition does not hash to its id`);
      conditions.set(id, condition);
    }
  }
  return conditions;
}
