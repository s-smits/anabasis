/**
 * A campaign's moves, as the decision table returns them (`decide.ts`): the one move a log leads
 * to, with its reason and the row that chose it, or the campaign's ending; and a move in one line.
 */

/** How a campaign ends, as its last event says it. */
export type Ending =
  | "budget"
  | "stop"
  | "exam"
  | "no-room"
  | "environment"
  | "operator"
  | "control"
  | "finished";

/** The one move a campaign's log leads to, with its reason, or its ending. */
export type Decided =
  /** An Examiner session that drafts the exam of a campaign opened from a prompt (row F53). */
  (
    | { readonly move: "draft"; readonly why: string }
    | { readonly move: "accept"; readonly why: string }
    /** `practice` names the count practice is brought to where it is more than the campaign's. */
    | { readonly move: "prepare"; readonly why: string; readonly practice?: number }
    /** An Examiner session, which is always asked for tasks the reference harness fails (row F52).
     *  `answers` names the operator's word it follows, where it follows one (`pendingWords`), and
     *  `repeats` the reading under the trigger whose repeat waits on the tasks it writes. */
    | {
        readonly move: "examine";
        readonly why: string;
        readonly answers?: readonly number[];
        readonly repeats?: string;
      }
    | { readonly move: "build"; readonly why: string }
    /** A comparison of `fresh` with `reference`: `latest`, `promoted`, `starter`, or a digest. The
     *  reference against itself is the operator's `--noise` on a checkpoint, and no move of the
     *  table. `id` names one that began and goes on. `repeats` names the reading under the trigger
     *  this one is the repeat of: the same two harnesses, so the new one is the one that reading
     *  froze, whatever a live Builder has changed since. */
    | {
        readonly move: "compare";
        readonly why: string;
        readonly fresh: string;
        readonly reference: string;
        readonly id?: string;
        readonly repeats?: string;
      }
    | { readonly move: "promote"; readonly why: string; readonly harness: string }
    | {
        readonly move: "end";
        readonly why: string;
        readonly ending: Ending;
        readonly answers?: readonly number[];
      }
  ) & {
    /** The row of the table that chose it, or the hold that changed what a row named (`ROWS`,
     *  `HOLDS`, `decide.ts`), which `campaign.move` carries beside its reason. */
    readonly code: string;
  };

export const short = (digest: string): string => digest.slice(0, 8);

/** A decided move in one line, as the campaign's command and its view print it. */
export function decidedLine(decided: Decided): string {
  const named = (harness: string) => (harness.length > 16 ? short(harness) : `the ${harness} harness`);
  const what = (): string => {
    switch (decided.move) {
      case "draft":
        return "an Examiner session, to draft the exam";
      case "accept":
        return "read the exam";
      case "prepare":
        return "set the tasks apart";
      case "examine":
        return "an Examiner session";
      case "build":
        return "a Builder session";
      case "compare":
        return `a comparison of ${named(decided.fresh)} with ${named(decided.reference)}`;
      case "promote":
        return `promote harness ${short(decided.harness)}`;
      case "end":
        return `the campaign ends (${decided.ending})`;
    }
  };
  return `${what()}: ${decided.why}`;
}
