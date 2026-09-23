/**
 * Shared rules for processes that may access only explicitly allowed paths, with the additions
 * Seatbelt needs. The OS adapters turn these descriptions into launch policies.
 *
 * This description exists because the verifier host, the generated-tool worker and the Built Harness
 * shell each stated their rules twice — once as Seatbelt profile text for Darwin, once as Bubblewrap
 * argv for Linux — so one wall's posture lived in two places with no shared setting. Turning the
 * network on for a single caller then took five separate edits across two files, and the Linux half
 * of one is easy to miss, which leaves the two hosts confining differently while both read as
 * confined. Both adapters now read the same setting. The shell has since moved to an open-read
 * policy with explicit denials, which it constructs separately in `solve-command-isolation.ts`.
 *
 * `shared` holds what both mechanisms express, so a change there cannot reach one host and not the
 * other. `seatbelt` holds what only Seatbelt has: its move guards are string rules against a rename,
 * while a bwrap bind stays attached to its dentry and needs no counterpart. Bubblewrap gets no
 * matching section because its own additions are not per-caller — `bwrapIsolationArgs` gives every
 * launch a private PID namespace and the rest of its namespace posture unconditionally — and the one
 * thing callers do differ on, the network, sits in `IsolationPosture` below.
 *
 * The Built Harness session isolation and the Builder's candidate isolation are the opposite
 * construction: they open the host and hide protected roots behind empty mounts, and share no policy
 * structure with a deny-default caller. Those policies stay in their own modules, because bringing
 * them here would need modes that ignore most of this description.
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
 * The part of a wall's posture that carries no paths, so one constant can hold it and both adapters
 * can read that same constant. The paths differ per call — a scratch tree, a runtime closure — but
 * the posture does not, and the posture is what drifted.
 */
export interface IsolationPosture {
  /** Whether the confined process may reach the network. One statement, both adapters: it is the
   *  boolean `bwrapBaselineArgs` takes rather than a word, so the same constant supplies the Linux
   *  launch options and no translation step stands between the two mechanisms. */
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

/** Seatbelt's own rules. Order is the policy here, because Seatbelt takes the last matching rule,
 *  so these are emitted after everything `shared` produces. */
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
 * Both callers pass the result straight into argv and hash it into a recorded policy identity, where
 * a trailing newline would be one more byte for no reason.
 */
export function seatbeltProfile({ shared, seatbelt }: IsolationDescription): string {
  return [
    "(version 1)",
    "(deny default)",
    `(import "${SEATBELT_BASELINE}")`,
    "(allow process*)",
    shared.network ? "(allow network*)" : "(deny network*)",
    // A denied Mach lookup does not read as a denial to the program that made it: it panics tools
    // that expect the service to answer. `wall-policy.ts` owns which services are open, which stay
    // closed, and why.
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
