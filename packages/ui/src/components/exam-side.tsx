/*
 * Placeholder notes shown when exam-side content is withheld by the server tier or blind-labelling
 * rules. Because deliberate redaction is neither an error nor a missing value, it is styled as a
 * plain note without a callout tone or border.
 *
 * Referee rulings are withheld in both tiers under two conditions: while a rejection awaits an
 * operator's blind label (since exposing the Referee's verdict would contaminate the calibration
 * pool in `poolOf`, `src/kernel/reports.ts`), and until the enclosing comparison has reported
 * (`withheld.ts`). Because switching to `--exam-side` will not reveal such a ruling,
 * `RulingWithheld` explains why it is hidden instead.
 */
import type { Withheld } from "../models.ts";

const WHY = {
  label: "while its rejection waits for a person's label",
  report: "until its comparison reports",
} as const satisfies Record<Exclude<Withheld, null>, string>;

/** Renders a muted note in place of exam-side content; `what` completes "The exam side holds ...". */
export function ExamSide({ what }: { what: string }) {
  return (
    <p className="ana-exam-side">
      The exam side holds {what}: start the server with <code>--exam-side</code> to open it.
    </p>
  );
}

/** Returns a short phrase explaining why a Referee ruling is withheld in both tiers. */
export function withheldWords(why: Exclude<Withheld, null>): string {
  return WHY[why];
}

/** Renders a muted note explaining why a Referee ruling is withheld regardless of server tier. */
export function RulingWithheld({ why }: { why: Exclude<Withheld, null> }) {
  return <p className="ana-exam-side">The ruling is withheld {WHY[why]}, in either tier.</p>;
}
