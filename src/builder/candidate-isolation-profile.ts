/**
 * The OS half of the Builder isolation: one policy value in, one Seatbelt profile out.
 *
 * `candidate-isolation.ts` defines the policy and checks requested paths.
 * This file expresses that policy in SBPL. Rule order determines the result:
 * Seatbelt takes the last matching rule, so the position of each grant and denial matters
 * as much as its presence.
 */
import { readdirSync } from "../meta/filesystem.ts";
import { sha256 } from "../meta/digest.ts";
import { posixContainsPath } from "../meta/path-containment.ts";
import { OPERATOR_HOME_ROOTS } from "./builder-agent-access.ts";
import {
  BUILDER_CONFIG_DENY_GLOB_STEMS,
  BUILDER_PRIVATE_KEY_DENY_GLOB_STEMS,
  type CandidateAccessPolicy,
  type IsolationMode,
  type IsolationRule,
} from "./candidate-isolation.ts";
import {
  HIDDEN_TASKS_DENY_PATTERN,
  SEATBELT_BASELINE,
  SYSTEM_SERVICE_RULES,
  runDataDenyRules,
  traversalMetadataRules,
} from "../verify/wall-policy.ts";

/** The Seatbelt profile text and the identity it was derived under. Both travel together: the
 *  digest is what evidence cites, and the text is what the sandbox is actually given. */
interface CandidateIsolationProfile {
  profile: string;
  profileDigest: string;
}

/**
 * Both profiles allow metadata reads everywhere, including paths whose contents remain denied.
 *
 * A grant on a path does not make it reachable: `getcwd`, the dynamic loader, every
 * CommandLineTools shim and Node's own loader stat each directory above the path they open, so one
 * unstattable ancestor fails the call before the granted file is touched. Denying `/Users` that way
 * left the Builder able to write `correctness-model/evaluator.ts` and unable to run a line of it. Existence is
 * not what these walls protect: `file-read-data` still refuses opening any denied file and
 * enumerating any denied directory, so a session can stat only a path it can already name.
 */
const METADATA_EVERYWHERE = '(allow file-read-metadata (subpath "/"))';

/** Top-level directories holding people's data rather than the platform: the two home roots and
 *  removable or network mounts. Everything else at the filesystem root is host-owned platform
 *  material the workshop may read. */
const NON_PLATFORM_ROOTS = new Set(["Users", "home", "Volumes", "net"]);

/** A path is a literal inside an SBPL regex: every metacharacter it happens to carry is escaped
 *  so `census.json` denies that name and not `censusXjson`. */
function sbplRegexEscape(path: string): string {
  return path.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** One deny glob stem as SBPL. A `/**` stem denies a directory subtree; every other stem denies a
 *  leaf name, anchored at the end so `*.p12` does not also deny `key.p12.bak`. */
function globStemToSbplRegex(stem: string): string {
  if (stem.endsWith("/**")) return `/${stem.slice(0, -3).replaceAll(".", String.raw`\.`)}/`;
  return `/${stem.replaceAll(".", String.raw`\.`).replaceAll("*", "[^/]*")}$`;
}

/**
 * The host's platform directories, derived from the filesystem root rather than named one by one.
 *
 * A fixed list needed a new entry whenever a session encountered another platform directory.
 * Those additions followed failed attempts to read an interpreter, trust store or toolchain.
 * Deriving the grants from the root directory makes newly installed platform directories
 * readable without maintaining a separate list of their names.
 *
 * It is not a grant of everything. The two home roots stay out, which keeps the user's files and
 * credentials unreadable and — the recorded reason this wall was tightened, after a sibling-worktree
 * leak — every other campaign's generated tree unreadable with them. The workspace and epoch paths
 * stay readable through the policy's own rules, and the secret-glob and repository denies still run
 * after these allows.
 */
function platformReadRoots(): string[] {
  try {
    return readdirSync("/")
      .filter((name) => !NON_PLATFORM_ROOTS.has(name))
      .map((name) => `/${name}`)
      .sort();
  } catch {
    // An unreadable filesystem root leaves the policy with its own rules, which refuses rather
    // than silently widening.
    return [];
  }
}

/** The workshop's host-platform reads. */
function workshopReadRules(): IsolationRule[] {
  return [
    ...platformReadRoots().map((path): IsolationRule => ({ kind: "subpath", path, id: "toolchain" })),
    { kind: "literal", path: "/private/var/db/xcode_select_link", id: "toolchain" } satisfies IsolationRule,
  ];
}

/**
 * The scratch roots split by whether they sit inside the repository.
 *
 * A subpath grant cannot be subtracted from. Darwin's ambient temp is a scratch root, so a
 * repository checked out under `/private/var/folders` or `/tmp` sits inside one, and a single
 * grant block re-allowed the whole repository the platform grant had just carved out. Measured
 * 2026-08-19 on the fixture repo, which lives in the OS temp tree: every key-shaped name seeded in
 * the repository became readable. Production's repository is under `/Users`, which is the only
 * reason this never showed there. The outer roots are granted before the repository is carved out
 * again, the inner ones after it.
 */
function splitScratchRoots(policy: CandidateAccessPolicy) {
  const insideRepo = (root: string) => posixContainsPath(root, policy.repoRoot);
  const rule = (path: string): IsolationRule => ({ kind: "subpath", path, id: "host-scratch" });
  return {
    outer: policy.scratchWriteRoots.filter((root) => !insideRepo(root)).map(rule),
    inner: policy.scratchWriteRoots.filter(insideRepo).map(rule),
  } satisfies { outer: IsolationRule[]; inner: IsolationRule[] };
}

// The one name every wall denies, last of all so nothing re-opens it.
//
// The wider run-data list the Built Harness takes is not available here, and both of its generic
// names proved it on 2026-08-19. `/campaigns/` is where a Builder authors, so denying it left the
// cell unable to `stat` its own `.oss`: every command died on `cd` before its first instruction.
// `/domains/` is an ordinary word, so `import sympy` failed on `sympy/polys/domains` — a package
// that is neither run data nor the cell's own tree. A peer checkout is a different threat for a
// Builder than for a Built Harness in any case: the Builder writes the correctness model rather
// than being graded by it. Hidden tasks and credentials stay shut on both sides.
// `.env` is left to the config names above, which are re-opened inside the cell's own HOME on
// purpose; a grader's copy of the hidden tasks is re-opened nowhere, so it goes last of all.
const HIDDEN_TASKS_DENY_RULES = `${runDataDenyRules([HIDDEN_TASKS_DENY_PATTERN]).join("\n")}
(deny file-write* (regex #"${HIDDEN_TASKS_DENY_PATTERN}"))`;

/**
 * One profile text for both cells.
 *
 * The two cells were emitted by two hand-written rule orders. They now share a base
 * (`allow default`) and differ only in what each may reach, so the duplication bought nothing and
 * cost a defect: the authoring branch re-carved the repository out after its scratch grant and the
 * workshop branch did not, which left every key-shaped name in a repository hosted under the OS
 * temp tree readable from the workshop. One order, stated once, is what keeps that from recurring.
 *
 * The order matters because SBPL takes the last matching rule:
 *
 *   base → close home and host writes → platform/scratch grants → close the repository →
 *   the policy's own grants → final cross-cell, measured-evidence and hidden-task denies.
 *
 * The remaining differences are passed per cell: the workshop imports the platform
 * profile and names the Mach services a confined verifier may ask for, and reads host platform
 * directories through the derived grant; the authoring session writes `/dev` and denies the
 * workshop tree. Both are passed as values rather than as a second copy of the order.
 */
function profileText(
  policy: CandidateAccessPolicy,
  mode: IsolationMode,
  extraReadPaths: readonly string[],
): string {
  const sb = JSON.stringify;
  const ruleText = (rule: IsolationRule) => `  (${rule.kind} ${sb(rule.path)})`;
  const readRules = [
    ...policy.allow.read,
    ...(mode === "read" ? [] : policy.allow.write),
    ...extraReadPaths.map((path): IsolationRule => ({ kind: "literal", path, id: "spawned-command" })),
  ];
  const writeRules = mode === "read" ? [] : policy.allow.write;
  // Raw #"..." emission avoids JSON double-escaping the SBPL regex backslashes.
  const regexOf = (pattern: string) => `(regex #"${pattern}")`;
  const regexRule = (pattern: string) => `  ${regexOf(pattern)}`;
  const privateKeyDenyRules = `(deny file-read*\n${BUILDER_PRIVATE_KEY_DENY_GLOB_STEMS.map(globStemToSbplRegex).map(regexRule).join("\n")})`;
  const configRegexes = [
    ...BUILDER_CONFIG_DENY_GLOB_STEMS.map(globStemToSbplRegex),
    `^${sbplRegexEscape(policy.repoRoot)}/\\.git(/|$)`,
  ];
  const configDenyBlocks = `(deny file-read*\n${configRegexes.map(regexRule).join("\n")})\n(deny file-write*\n${configRegexes.map(regexRule).join("\n")})`;
  const measured = policy.measuredNamePrefixes.map(sbplRegexEscape).join("|");
  const measuredRegex = `^${sbplRegexEscape(policy.epochDir)}/(.*/)?(${measured})[^/]*(/.*)?$`;
  const measuredDenyRules = `(deny file-read* file-read-metadata ${regexOf(measuredRegex)})\n(deny file-write* ${regexOf(measuredRegex)})`;
  const workshop = policy.profile === "isolated-workshop";
  const { outer: outerScratch, inner: innerScratch } = splitScratchRoots(policy);
  const block = (head: string, lines: readonly string[]) =>
    lines.length === 0 ? "" : `(${head}\n${lines.join("\n")})\n`;
  // The workshop asks the platform for its toolchain and its services; the authoring session has
  // the host's own and needs neither.
  const prelude = workshop
    ? `(import "${SEATBELT_BASELINE}")\n(allow process*)\n${SYSTEM_SERVICE_RULES}\n`
    : "";
  const platformGrant = workshop ? block("allow file-read*", workshopReadRules().map(ruleText)) : "";
  const scratchGrant = [...outerScratch.map(ruleText), ...(workshop ? [] : ['  (subpath "/dev")'])];
  const readable = [...readRules, ...innerScratch];
  const writable = [...writeRules, ...innerScratch];
  const finalDenies = [
    block(
      "deny file-read* file-read-metadata",
      policy.readDenyRoots.map((root) => `  (subpath ${sb(root)})`),
    ),
    block(
      "deny file-write*",
      policy.writeDenyRoots.map((root) => `  (subpath ${sb(root)})`),
    ),
    `${measuredDenyRules}\n${HIDDEN_TASKS_DENY_RULES}`,
  ].join("");
  // The cell's own HOME and caches come after the name denies, and that order is what gives the
  // cell its exemption from them: a cell writes its own `.env` and its own `auth.json` as ordinary
  // runtime state, and only a neighbour's copy is the secret. The names are still shut everywhere
  // else, the cell's own tree included, because the own-tree grant above is emitted before them.
  const cellHomeGrant = block(
    "allow file-read* file-write*",
    policy.cellRuntimeRoots.map((root) => `  (subpath ${sb(root)})`),
  );
  return `(version 1)
(allow default)
${prelude}${METADATA_EVERYWHERE}
${block(
  "deny file-read* file-write*",
  OPERATOR_HOME_ROOTS.map((root) => `  (subpath ${sb(root)})`),
)}(deny file-write* (subpath "/"))
${platformGrant}${block("allow file-read* file-write*", scratchGrant)}(deny file-read* (subpath ${sb(policy.repoRoot)}))
(deny file-write* (subpath ${sb(policy.repoRoot)}))
${privateKeyDenyRules}
${traversalMetadataRules(readable.map((rule) => rule.path)).join("\n")}
${block("allow file-read*", [...readable.map(ruleText), '  (literal "/dev/null")'])}${block("allow file-write*", [...writable.map(ruleText), '  (literal "/dev/null")'])}${policy.network === "deny" ? "(deny network*)" : "(allow network*)"}
${configDenyBlocks}
${cellHomeGrant}${finalDenies}`.trimEnd();
}

export function candidateIsolationProfile(
  policy: CandidateAccessPolicy,
  mode: IsolationMode,
  extraReadPaths: readonly string[] = [],
): CandidateIsolationProfile {
  const profile = profileText(policy, mode, extraReadPaths);
  return { profile, profileDigest: sha256(profile) };
}
