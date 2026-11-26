/*
 * Notes standing where the server's tier or blind labelling withholds exam-side content, styled plain
 * since a redaction is neither an error nor a missing value. A ruling is withheld in both tiers while
 * its rejection awaits a blind label (`poolOf`) and until its comparison has reported (`withheld.ts`);
 * `--exam-side` will not show it, so `RulingWithheld` says why.
 */
import type { Withheld } from "../models.ts";

const WHY = {
  label: "while its rejection waits for a person's label",
  report: "until its comparison reports",
} as const satisfies Record<Exclude<Withheld, null>, string>;

/** `what` completes "The exam side holds ...". */
export function ExamSide({ what }: { what: string }) {
  return (
    <p className="ana-exam-side">
      The exam side holds {what}: start the server with <code>--exam-side</code> to open it.
    </p>
  );
}

export function withheldWords(why: Exclude<Withheld, null>): string {
  return WHY[why];
}

export function RulingWithheld({ why }: { why: Exclude<Withheld, null> }) {
  return <p className="ana-exam-side">The ruling is withheld {WHY[why]}, in either tier.</p>;
}
