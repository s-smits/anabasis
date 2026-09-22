/**
 * The host access facts for every Builder backend. `deriveCandidateIsolation` incorporates
 * these grants into the one policy enforced by the host file and command tools. Native
 * projections formerly dropped purpose-based denies and exposed evidence created after startup;
 * all backends now use the host tools rather than maintaining separate filesystem rules.
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
 * The Builder may read host tools, but it writes only its workspace and the separately declared OS
 * scratch roots. An installer that expects HOME writes under the workspace's `.toolchain/home`; this
 * keeps the installed bytes useful for authoring without letting them masquerade as host-owned engines.
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
