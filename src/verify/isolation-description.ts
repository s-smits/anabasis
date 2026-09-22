/**
 * Shared rules for processes that may access only explicitly allowed paths, with the additions
 * needed by Seatbelt. The OS adapters turn these descriptions into launch policies.
 *
 * This description originated with the verifier host, generated-tool
 * worker and Built Harness shell. Each one stated its rules twice — once as Seatbelt profile
 * text for Darwin, once as Bubblewrap argv for Linux — so one wall's posture lived in two places
 * with no shared setting. On 2026-08-19 the Built Harness shell was given network access, and the
 * change needed five separate edits across two files; the Linux half of one was missed on the first
 * pass and only a second reading caught it. The shared description lets both adapters read
 * the same setting. The shell has since moved to an open-read policy with explicit denials;
 * it now constructs that policy separately in `solve-command-isolation.ts`.
 *
 * `shared` holds what both mechanisms express, so a change there
 * cannot reach one host and not the other. `seatbelt` holds what only Seatbelt has — its move
 * guards are string rules against a rename, while a bwrap bind stays attached to its dentry and
 * needs no counterpart. Bubblewrap has no matching section: its extra argument, a private PID
 * namespace, is a posture rather than a rule, so it sits in `IsolationPosture` beside the network
 * and the Darwin adapter ignores it. No additional Bubblewrap rule section is needed.
 *
 * The Built Harness session isolation also has a separate description: it mounts the
 * host and hides protected roots behind empty tmpfs, which is the opposite construction and shares
 * no policy structure with deny-default callers. The Builder's candidate isolation defines its own
 * workspace and authoring permissions. Those policies stay in their respective modules;
 * including them here would require modes that ignore much of this description.
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
 * adapters can read that same constant. The paths differ per call - a scratch tree, a runtime
 * closure - but the posture does not, and the posture is what drifted.
 */
export interface IsolationPosture {
  /** Whether the confined process may reach the network. One statement, both adapters. It is the
   *  boolean Bubblewrap takes rather than a word, so the constant also supplies its launch options and
   *  no translation step stands between the two mechanisms. */
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

/** Seatbelt's own rules. Order matters: Seatbelt takes the last matching rule, so
 *  these are emitted after everything `shared` produces. */
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
 * The Darwin adapter: Seatbelt profile text, with no trailing newline.
 *
 * `system.sb` is imported for the reason the verifier host imports it — a bare deny-default profile
 * cannot execute a binary at all — and `(allow process*)` follows it for the same reason.
 *
 * Two of the three callers pass the result straight into argv, where a trailing newline would be
 * one more byte in a recorded identity for no reason, so the one caller staging a file adds its own.
 */
export function seatbeltProfile({ shared, seatbelt }: IsolationDescription): string {
  return [
    "(version 1)",
    "(deny default)",
    `(import "${SEATBELT_BASELINE}")`,
    "(allow process*)",
    shared.network ? "(allow network*)" : "(deny network*)",
    // A denied Mach lookup does not read as a denial: it panics tools that expect it to work.
    // `wall-policy.ts` owns which services are open and which stay closed, and why.
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
