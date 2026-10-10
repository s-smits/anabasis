/**
 * A campaign's moves, as the decision table returns them (`decide.ts`): the one move a log leads
 * to, with its reason, or the campaign's ending; the makers of each; and a move in one line. Split
 * from `decide.ts` on 10 October, when that file passed 800 lines. Until 11 October it also read
 * what a report said of a budget and a full-limit reading, for the ladder of shorter budgets the
 * table walked; a campaign runs at one budget since (`docs/simplify.md`, package A).
 */

/** How a campaign ends, as its last event says it. */
export type Ending = "budget" | "stop" | "exam" | "no-room" | "environment" | "operator";

/** The one move a campaign's log leads to, with its reason, or its ending. */
export type Decided =
  /** An Examiner session that drafts the exam of a campaign opened from a prompt (row F53). */
  | { readonly move: "draft"; readonly why: string }
  | { readonly move: "accept"; readonly why: string }
  /** `practice` names the count practice is brought to where it is more than the campaign's. */
  | { readonly move: "prepare"; readonly why: string; readonly practice?: number }
  /** An Examiner session. `room` asks for tasks that leave a harness room (row F52). `answers`
   *  names the operator's word it follows, where it follows one (`pendingWords`). */
  | {
      readonly move: "examine";
      readonly why: string;
      readonly room: boolean;
      readonly answers?: readonly number[];
    }
  | { readonly move: "build"; readonly why: string }
  /** A comparison of `fresh` with `reference`, which is `promoted`, `starter` or a digest. `id`
   *  names one that began and goes on. `noise` reads the reference against itself beside it. */
  | {
      readonly move: "compare";
      readonly why: string;
      readonly fresh: string;
      readonly reference: string;
      readonly noise: boolean;
      readonly id?: string | undefined;
    }
  | { readonly move: "promote"; readonly why: string; readonly harness: string }
  | {
      readonly move: "end";
      readonly why: string;
      readonly ending: Ending;
      readonly answers?: readonly number[];
    };

export const STEP = "step";
/** What a comparison the table names is of: the last harness a session left, or the starter as a
 *  control on the reference harness. */
export type Fresh = "latest" | "starter";

export const end = (ending: Ending, why: string): Decided => ({ move: "end", ending, why });
export const build = (why: string): Decided => ({ move: "build", why });
export const short = (digest: string): string => digest.slice(0, 8);

/** A comparison of the latest harness, or of the starter as a control, with the reference one,
 *  under the campaign's setting. */
export const compare = (why: string, noise: "noise" | "alone", fresh: Fresh = "latest"): Decided => ({
  move: "compare",
  fresh,
  reference: "promoted",
  noise: noise === "noise",
  why,
});

/** A decided move in one line, as the campaign's command and its view print it. */
export function decidedLine(decided: Decided): string {
  const named = (harness: string) => (harness.length > 16 ? short(harness) : `the ${harness} harness`);
  const what = {
    draft: () => "an Examiner session, to draft the exam",
    accept: () => "read the exam",
    prepare: () => "set the tasks apart",
    examine: () =>
      decided.move === "examine" && decided.room
        ? "an Examiner session, for tasks that leave room"
        : "an Examiner session",
    build: () => "a Builder session",
    compare: () =>
      decided.move === "compare"
        ? `a comparison of ${named(decided.fresh)} with ${named(decided.reference)}${decided.noise ? ", and the reference against itself" : ""}`
        : "",
    promote: () => (decided.move === "promote" ? `promote harness ${short(decided.harness)}` : ""),
    end: () => (decided.move === "end" ? `the campaign ends (${decided.ending})` : ""),
  } as const satisfies Record<Decided["move"], () => string>;
  return `${what[decided.move]()}: ${decided.why}`;
}
