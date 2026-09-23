/** A refused launch precondition — a missing credential or a required operator declaration —
 *  found before any model turn runs. It is a distinct type rather than a plain Error so the
 *  controller terminal records `environment-blocked` and the refusal keeps an owner: two runs of
 *  2026-08-27 recorded `abortClause: null` on exactly these refusals, which is an abort that names
 *  nobody. Zero imports, so every backend can throw it without an import cycle. */
export class EnvironmentRefusal extends Error {
  readonly kind = "environment-refusal" as const;

  constructor(message: string) {
    super(message);
    this.name = "EnvironmentRefusal";
  }
}
