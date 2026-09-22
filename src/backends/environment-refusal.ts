/** A refused launch precondition, such as a missing credential, found before any model turn. Typed
 *  so the controller records `environment-blocked`; it has no imports, so any backend can throw it. */
export class EnvironmentRefusal extends Error {
  readonly kind = "environment-refusal" as const;

  constructor(message: string) {
    super(message);
    this.name = "EnvironmentRefusal";
  }
}
