/**
 * The host access facts for every Builder backend. `deriveCandidateIsolation` folds these grants
 * into the one policy the host file and command tools enforce. A backend that projected its own
 * filesystem rules instead dropped the purpose-based denies and exposed evidence created after the
 * session started; every backend now reaches the filesystem through the host tools, so this map is
 * the whole statement of what a session may touch outside its tree.
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
 * scratch roots. An installer that expects HOME writes under the workspace's `.toolchain/home`,
 * which keeps the installed bytes where authoring and the candidate's own checks find them without
 * letting them pass for host-owned engines.
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
