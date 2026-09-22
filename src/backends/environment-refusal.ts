/** A refused launch precondition: a missing credential or required operator declaration, found
 *  before any model turn. Typed so the controller terminal records `environment-blocked` instead of
 *  an abort with no ownership category (two 2026-08-27 runs recorded `abortClause: null` on
 *  exactly these refusals). Zero imports so every backend can throw it without a cycle. */
export class EnvironmentRefusal extends Error {
  readonly kind = "environment-refusal" as const;

  constructor(message: string) {
    super(message);
    this.name = "EnvironmentRefusal";
  }
}
