/**
 * Shared rules for deny-default processes that may access only explicitly allowed paths, so one
 * posture reaches the Seatbelt profile and the Bubblewrap argv alike.
 *
 * `shared` holds what both mechanisms express. `seatbelt` holds what only Seatbelt has: its move
 * guards are string rules against a rename, while a bwrap bind stays attached to its dentry and
 * needs no counterpart. Bubblewrap's private PID namespace is a posture rather than a rule, so it
 * needs no section of its own.
 *
 * The open-read shell policy (`solve-command-isolation.ts`), the Built Harness session isolation
 * and the Builder's candidate isolation are built the opposite way and stay in their own modules.
 */
import { SEATBELT_BASELINE, SYSTEM_SERVICE_RULES } from "./wall-policy.ts";
import { sbRule } from "./seatbelt-path-guard.ts";

/** Paths a rule applies to, in Seatbelt's two forms. A subpath covers a tree; a literal is one
 *  exact path, which is what a runtime closure needs so a sibling in the same directory stays out. */
interface IsolationPaths {
  literals?: readonly string[];
  subpaths?: readonly string[];
}

/**
 * The part of a wall's posture that carries no paths, so one constant can hold it and both
 * adapters read that same constant.
 */
export interface IsolationPosture {
  /** Whether the confined process may reach the network, as the boolean Bubblewrap takes. */
  network: boolean;
}

/** What both mechanisms express. Every field here reaches Darwin and Linux alike. */
interface SharedIsolationRules extends IsolationPosture {
  metadata: IsolationPaths;
  reads: IsolationPaths;
  writes: IsolationPaths;
  /** Emitted after the allows, so a denial wins over a root that would otherwise open it. */
  deniedReads?: readonly string[];
  deniedWrites?: readonly string[];
}

/** Seatbelt's own rules, emitted after everything `shared` produces since Seatbelt takes the last
 *  matching rule. */
interface SeatbeltOnlyRules {
  /** Verbatim rules that need Seatbelt's last-match ordering. Emitted after the shared denies and
   *  before move guards; callers keep their own re-allows adjacent to the exception they close. */
  finalRules?: readonly string[];
  /** Rendered `moveBlockingRules` output: a rename cannot relocate a protected root out from under
   *  the path strings a denial names. Bubblewrap needs no counterpart. */
  moveGuards?: readonly string[];
}

interface IsolationDescription {
  shared: SharedIsolationRules;
  seatbelt?: SeatbeltOnlyRules;
}

function allowRules(verb: string, paths: IsolationPaths): string[] {
  return [...sbRule(verb, "literal", paths.literals ?? []), ...sbRule(verb, "subpath", paths.subpaths ?? [])];
}

/**
 * The Darwin adapter: Seatbelt profile text, with no trailing newline since most callers pass it
 * straight into argv. `system.sb` and `(allow process*)` are there because a bare deny-default
 * profile cannot execute a binary at all.
 */
export function seatbeltProfile({ shared, seatbelt }: IsolationDescription): string {
  return [
    "(version 1)",
    "(deny default)",
    `(import "${SEATBELT_BASELINE}")`,
    "(allow process*)",
    shared.network ? "(allow network*)" : "(deny network*)",
    // A denied Mach lookup panics tools that expect it to work; `wall-policy.ts` owns which are open.

    SYSTEM_SERVICE_RULES,
    ...allowRules("allow file-read-metadata", shared.metadata),
    ...allowRules("allow file-read*", shared.reads),
    ...allowRules("allow file-write*", shared.writes),
    ...sbRule("deny file-read*", "subpath", shared.deniedReads ?? []),
    ...sbRule("deny file-write*", "subpath", shared.deniedWrites ?? []),
    ...(seatbelt?.finalRules ?? []),
    ...(seatbelt?.moveGuards ?? []),
  ].join("\n");
}
