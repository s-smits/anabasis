/** A refused launch precondition — a missing credential or a required operator declaration —
 *  found before any model turn runs. It is a distinct type rather than a plain Error so the
 *  controller terminal records `environment-blocked` and the refusal keeps an owner. Thrown as a
 *  plain Error the same refusal reaches that terminal as `abortClause: null`, which is an abort
 *  naming nobody. Zero imports, so every backend can throw it without an import cycle. */
export class EnvironmentRefusal extends Error {
  readonly kind = "environment-refusal" as const;

  constructor(message: string) {
    super(message);
    this.name = "EnvironmentRefusal";
  }
}
