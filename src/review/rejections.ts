/**
 * A reading of the answers a checker refused: what the Referee ruled of each, and the order in which
 * a person's labels and the Referee's rulings are made.
 *
 * A checker's controls test the faults their author thought of (`src/kernel/acceptance.ts`). Whether
 * its rejections are sound shows only on answers it refused that nobody wrote to be refused, and a
 * stored sweep holds those: every rejected answer, with the checks that refused it. In v1 that share
 * was never taken for a pack before the pack was used, and when it was taken afterwards the check
 * was the stricter side on 17 of the 22 fails counted as limits (v1 `AGENTS.md`, "Open gaps").
 *
 * The labels come first. A person labels a drawn sample with the Referee's three rulings before the
 * Referee reads anything, since the log shows a ruling to whoever opens it and a label made after
 * that was not made blind. So the draw refuses a log that holds a ruling, and the caller starts no
 * reading while a drawn fail is unlabelled. The sample is drawn by a seed fixed before the fails
 * were known, as the scored set's is (`compare.ts`, `draw`).
 *
 * This counts and decides nothing. What share of check defects a checker may carry, and the bar the
 * Referee must clear against the labels (`agreement.ts`), are the operator's.
 */
import type { Regraded } from "../kernel/acceptance.ts";
import { draw } from "../kernel/compare.ts";
import type { LogEvent } from "../kernel/log.ts";
import { refusedBy, verdictsOf } from "../kernel/solves.ts";
import { asRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { plural } from "../meta/text.ts";
import { RULINGS } from "./agreement.ts";
import type { Ruling } from "./referee.ts";

export interface Rejections {
  /** The refused answers the log holds, by the solve each verdict names. */
  readonly fails: readonly string[];
  /** The Referee's last ruling of each, counted. */
  readonly rulings: Readonly<Record<Ruling, number>>;
  /** Fails with no ruling yet. */
  readonly unruled: readonly string[];
  /** The check defects, by the check each ruling names. */
  readonly defects: Readonly<Record<string, number>>;
}

/** A repaired checker as the readings of the old one's verdicts judge it. */
interface RepairReading {
  /** Refusals the repair withdraws, by what was read of each answer: ruled a check defect, ruled
   *  earned, or not read, an unclear ruling among them. */
  readonly withdrawn: Readonly<Record<"check-defect" | "earned" | "unread", readonly string[]>>;
  /** Answers the old checker accepted and the repaired one refuses. Nobody rules on a pass, so none
   *  of these was read. */
  readonly tightened: readonly string[];
  /** Answers ruled a check defect that the repaired checker still refuses. */
  readonly unrepaired: readonly string[];
  /** What stands between the repair and its adoption, one sentence each; none when every verdict
   *  it moves is one that was read and ruled the old checker's fault. */
  readonly against: readonly string[];
}

/** Every solve whose logged verdict is an answer some check refused. An answer outside the
 *  contract's format reached no check, and is not a rejection of the checker's. */
function refused(events: readonly LogEvent[]): string[] {
  return [...verdictsOf(events).values()].flatMap((verdict) =>
    refusedBy(verdict).length > 0 ? [verdict.solve] : [],
  );
}

/** The refused answers and what the Referee has ruled of them so far. */
export function rejections(events: readonly LogEvent[]): Rejections {
  const fails = refused(events);
  const rulings: Record<Ruling, number> = { earned: 0, "check-defect": 0, unclear: 0 };
  const defects: Record<string, number> = {};
  const unruled: string[] = [];
  for (const solve of fails) {
    const found = events.findLast(
      ({ kind, data }) => kind === "referee.finding" && data.solve === solve,
    )?.data;
    const ruling = RULINGS.find((known) => known === found?.ruling);
    if (ruling === undefined) {
      unruled.push(solve);
      continue;
    }
    rulings[ruling] += 1;
    if (ruling === "check-defect" && isString(found?.check)) {
      defects[found.check] = (defects[found.check] ?? 0) + 1;
    }
  }
  return { fails, rulings, unruled, defects };
}

/** The fails a person labels before the Referee reads any: `count` of the refused answers, by `seed`. */
export function drawn(events: readonly LogEvent[], count: number, seed: string): string[] {
  if (events.some(({ kind }) => kind === "referee.finding")) {
    throw new Error("the log already holds a ruling, so a label drawn now would not be made blind");
  }
  const fails = refused(events);
  if (fails.length < count) {
    throw new Error(
      `${String(count)} labels need as many refused answers; the log holds ${String(fails.length)}`,
    );
  }
  return draw(fails, count, seed);
}

/** A person's labels as their file holds them, a word a drawn solve, and the solves still to be
 *  labelled: any whose entry is none of the `known` words, which are the three rulings of a
 *  rejection unless the caller reads another kind of label (`settle.ts --passes`). */
export function labelled<Word extends string>(file: JsonValue, known: readonly Word[]) {
  const labels = new Map<string, Word>();
  const open: string[] = [];
  for (const [solve, value] of Object.entries(asRecord(file) ?? {})) {
    const word = known.find((each) => each === value);
    if (word === undefined) open.push(solve);
    else labels.set(solve, word);
  }
  return { labels, open };
}

/**
 * A repair read against what was ruled of the old checker's verdicts: `rows` are a log's answers
 * under the repaired checker (`regraded`), `labels` a person's, which stand over the Referee's
 * ruling of the same solve.
 *
 * It is what keeps a repair from being a tuning. A checker may be changed where it was shown wrong
 * on an answer, and nowhere else: a refusal is withdrawn only from an answer ruled a check defect.
 * One withdrawn from an answer ruled earned loosens the exam, one withdrawn from an answer nobody
 * read is a guess, and an accepted answer newly refused is a change nobody asked for. Each is named,
 * and whether to adopt the repair all the same is the operator's.
 */
export function repairReading(
  rows: readonly Regraded[],
  events: readonly LogEvent[],
  labels: ReadonlyMap<string, Ruling>,
): RepairReading {
  const ruled = (solve: string) =>
    labels.get(solve) ??
    RULINGS.find(
      (known) =>
        known ===
        events.findLast(({ kind, data }) => kind === "referee.finding" && data.solve === solve)?.data.ruling,
    );
  const refusedBefore = rows.filter(({ was }) => was.startsWith("fail "));
  const passing = refusedBefore.filter(({ now }) => now === "pass");
  const of = (ruling: Ruling | undefined) =>
    passing.flatMap(({ solve }) => (ruled(solve) === ruling ? [solve] : []));
  const withdrawn = {
    "check-defect": of("check-defect"),
    earned: of("earned"),
    unread: [...of("unclear"), ...of(undefined)],
  };
  const tightened = rows.flatMap(({ solve, was, now }) =>
    was === "pass" && now.startsWith("fail ") ? [solve] : [],
  );
  const said = (solves: readonly string[], what: string) =>
    solves.length === 0 ? [] : [`${plural(solves.length, "answer")} ${what}: ${solves.join(", ")}`];
  return {
    withdrawn,
    tightened,
    unrepaired: refusedBefore.flatMap(({ solve, now }) =>
      now.startsWith("fail ") && ruled(solve) === "check-defect" ? [solve] : [],
    ),
    against: [
      ...said(withdrawn.earned, "ruled an earned fail would pass"),
      ...said(withdrawn.unread, "refused before and read by nobody would pass"),
      ...said(tightened, "accepted before would be refused"),
    ],
  };
}
