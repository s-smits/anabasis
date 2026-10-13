/*
 * What a page served in the default tier shows where the exam side's content would stand: one quiet
 * line that says where the content is and how to open it (the brief of 11 October, section 8). An
 * absence by design is neither an error nor an empty box, so it is drawn as neither: no callout
 * tone, no border, the faint text of a note.
 *
 * A ruling is the one exception that holds in both tiers: while its rejection waits for a person's
 * label it stays hidden, since a label made beside the ruling measures nothing (`poolOf`,
 * `src/kernel/reports.ts`), and so does every ruling of a comparison that has not reported yet
 * (`withheld.ts`). Opening the exam side would not show it, so that line says so instead.
 */
import type { Withheld } from "../models.ts";

const WHY = {
  label: "while its rejection waits for a person's label",
  report: "until its comparison reports",
} as const satisfies Record<Exclude<Withheld, null>, string>;

/** The line in place of exam-side content: `what` names it as the object of "holds". */
export function ExamSide({ what }: { what: string }) {
  return (
    <p className="ana-exam-side">
      The exam side holds {what}: start the server with <code>--exam-side</code> to open it.
    </p>
  );
}

/** Why a ruling is withheld from both tiers, in a few words. */
export function withheldWords(why: Exclude<Withheld, null>): string {
  return WHY[why];
}

/** The line in place of a ruling withheld from both tiers. */
export function RulingWithheld({ why }: { why: Exclude<Withheld, null> }) {
  return <p className="ana-exam-side">The ruling is withheld {WHY[why]}, in either tier.</p>;
}
