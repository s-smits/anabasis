/** One declared truth check of the brief. Each is a Boolean function in the evaluator's `checks`. */
export type TruthCheck<Id extends string = string> = {
  id: Id;
  /** What the brief asserts, in the field's vocabulary — a decidable statement, not a topic word. */
  assertion: string;
};
