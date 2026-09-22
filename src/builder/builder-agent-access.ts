/**
 * The host access facts for every Builder backend. `deriveCandidateIsolation` folds these grants
 * into the one policy the host file and command tools enforce.
 */
import { controllerCheckoutRoot } from "../verify/wall-policy.ts";

/** The home parents, closed as roots so the operator's ordinary files and every other account stay
 * shut. A deeper workspace grant is the only exception. */
export const OPERATOR_HOME_ROOTS: readonly string[] = ["/Users", "/home"];

/** A wall's verb for one path, in the vocabulary both adapters already share. */
type BuilderHostVerb = "read" | "write" | "deny";
type BuilderHostAccess = Record<string, BuilderHostVerb>;

/**
 * Everything a Builder session may reach on the host outside its own tree, as one access map.
 *
 * The Builder may read host tools but writes only its workspace and the declared OS scratch roots.
 */
export function builderHostAccess(workspace: string) {
  const verb = (paths: readonly string[], access: BuilderHostVerb) =>
    Object.fromEntries(
      paths.map((path): [string, BuilderHostVerb] => [path, access]),
    ) satisfies BuilderHostAccess;
  return {
    ...verb(OPERATOR_HOME_ROOTS, "deny"),
    ...verb([controllerCheckoutRoot()], "deny"),
    // Last and absolute: a Builder workspace is `campaigns/<slug>/…` inside the denied checkout.
    ...verb([workspace], "write"),
  };
}
