/**
 * The OS half of the Builder isolation: one policy value in, one Seatbelt profile out.
 *
 * `candidate-isolation.ts` defines the policy and checks the paths a capability requests; this file
 * expresses that same policy in SBPL, so the two layers deny one thing for one reason. Rule order
 * decides the result, because Seatbelt takes the last matching rule rather than the most specific
 * one, which means the position of every grant and every denial below carries as much of the policy
 * as its presence does. Moving a block is therefore a change to what the Builder may reach, even
 * when the block itself is untouched.
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
  verifierTempSiblingDenyRules,
} from "../verify/wall-policy.ts";

/** The Seatbelt profile text and the identity it was derived under. Both travel together, because
 *  the text is what the sandbox is actually given and the digest is what the evidence cites, and a
 *  row that named one without the other could not be checked against the wall that ran. */
interface CandidateIsolationProfile {
  profile: string;
  profileDigest: string;
}

/**
 * Both profiles allow metadata reads everywhere, including paths whose contents remain denied.
 *
 * A grant on a path does not by itself make that path reachable. `getcwd`, the dynamic loader,
 * every CommandLineTools shim and the runtime's module resolver stat each directory above the file
 * they open, so a single unstattable ancestor fails the call before the granted file is ever
 * touched. Denying `/Users` that way left the Builder able to write
 * `correctness-model/evaluator.ts` and unable to run a line of it.
 *
 * Existence is not what these walls protect. `file-read-data` still refuses to open any denied file
 * and to enumerate any denied directory, so the most a confined session gains here is confirmation
 * of a path it could already name.
 */
const METADATA_EVERYWHERE = '(allow file-read-metadata (subpath "/"))';

/** Top-level directories holding people's data rather than the platform: the two home roots and
 *  removable or network mounts. Everything else at the filesystem root is host-owned platform
 *  material the workshop may read, which is what lets the grant below be derived rather than
 *  listed. */
const NON_PLATFORM_ROOTS = new Set(["Users", "home", "Volumes", "net"]);

/** Treats a path as a literal inside an SBPL regex by escaping every metacharacter it happens to
 *  carry, so the `census.json` prefix denies that name and not `censusXjson`. */
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
 * A fixed list needed a new entry whenever a session met another platform directory, and each of
 * those additions followed a failed attempt to read an interpreter, a trust store or a toolchain —
 * which is to say the list was always one incident behind the hosts it ran on. Deriving the grant
 * from the root directory makes a newly installed platform directory readable without anyone
 * maintaining the names.
 *
 * It is not a grant of everything. The two home roots stay out, which keeps the user's own files
 * and credentials unreadable and, with them, every other campaign's generated tree — a peer
 * checkout of this same system is the thing a run-data leak comes from. The workspace and epoch
 * paths are still readable through the policy's own rules, and the private-key, repository and
 * config-name denies all run after these allows, so this grant is a floor and not a ceiling.
 */
function platformReadRoots(): string[] {
  try {
    return readdirSync("/")
      .filter((name) => !NON_PLATFORM_ROOTS.has(name))
      .map((name) => `/${name}`)
      .sort();
  } catch {
    // An unreadable filesystem root leaves the policy with its own rules alone, so the failure
    // narrows the profile rather than widening it.
    return [];
  }
}

/** The workshop's host-platform reads: the derived root grant plus the one literal that tells the
 *  cell which developer toolchain the host selected. */
function workshopReadRules(): IsolationRule[] {
  return [
    ...platformReadRoots().map((path): IsolationRule => ({ kind: "subpath", path, id: "toolchain" })),
    { kind: "literal", path: "/private/var/db/xcode_select_link", id: "toolchain" } satisfies IsolationRule,
  ];
}

/**
 * The scratch roots split by whether they sit inside the repository.
 *
 * An SBPL subpath grant cannot be subtracted from, and Darwin's ambient temp is a scratch root, so
 * a repository checked out under `/private/var/folders` or `/tmp` sits inside one. Emitting all the
 * scratch grants in a single block therefore re-allowed the whole repository the platform grant had
 * just carved out, every key-shaped name in it included. A repository under `/Users` is outside
 * every scratch root and never shows this, so the fault is invisible except on a checkout that
 * lives in the OS temp tree — which is where the fixture repository lives.
 *
 * The split is what fixes it: an outer root is granted before the repository is carved out again,
 * an inner one after, so a repository inside a scratch root is closed by the carve-out and a
 * scratch cell inside the repository is reopened by its own grant.
 */
function splitScratchRoots(policy: CandidateAccessPolicy) {
  const insideRepo = (root: string) => posixContainsPath(root, policy.repoRoot);
  const rule = (path: string): IsolationRule => ({ kind: "subpath", path, id: "host-scratch" });
  return {
    outer: policy.scratchWriteRoots.filter((root) => !insideRepo(root)).map(rule),
    inner: policy.scratchWriteRoots.filter(insideRepo).map(rule),
  } satisfies { outer: IsolationRule[]; inner: IsolationRule[] };
}

// The one run-data name every wall denies, emitted last of all so that no later grant reopens it.
//
// The wider `RUN_DATA_DENY_PATTERNS` list the Built Harness takes cannot be used here, because two
// of its entries name the Builder's own working world: `/campaigns/` is exactly where a Builder
// authors, so denying it leaves a cell unable to stat its own tree, and the `/domains/` entry is
// narrowed to a slug and a bundle root precisely because a bare `/domains/` also matches a
// third-party package path such as `sympy/polys/domains`. A peer checkout is a different threat for
// a Builder than for a Built Harness in any case: the Builder writes the correctness model rather
// than being graded by it.
//
// Hidden expectations are the exception that has to stay shut on both sides, since only the
// protected verifier owns their use. `.env` is left to the config-name denies below, which the
// cell's own HOME grant deliberately reopens for the cell's own copy; a grader's copy of the hidden
// tasks is reopened nowhere, which is why this block goes after everything.
const HIDDEN_TASKS_DENY_RULES = `${runDataDenyRules([HIDDEN_TASKS_DENY_PATTERN]).join("\n")}
(deny file-write* (regex #"${HIDDEN_TASKS_DENY_PATTERN}"))`;

// The product's own trees sit in the temporary directory both cells may otherwise write. A verifier
// cell holds a check's tool output, which is protected verifier detail; the tool cache store is what
// a later verification starts from; Built scratch and a host session's CLI state belong to other
// sessions. So every one of them is shut after every grant, whichever TMPDIR the launch froze.
const VERIFIER_TEMP_DENY_RULES = verifierTempSiblingDenyRules().join("\n");

/**
 * One profile text, in one rule order, for both cells.
 *
 * The two cells were once emitted by two hand-written rule orders. They share a base of
 * `allow default` and differ only in what each may reach, so the duplication bought nothing and
 * cost a defect: the authoring branch re-carved the repository out after its scratch grant and the
 * workshop branch did not, which left every key-shaped name in a repository hosted under the OS
 * temp tree readable from the workshop. Stating the order once is what keeps that from recurring.
 *
 * The order is the policy, because SBPL takes the last matching rule:
 *
 *   base → close home and host writes → platform/scratch grants → close the repository →
 *   the policy's own grants → final cross-cell, measured-evidence, hidden-task and verifier
 *   temp-tree denies.
 *
 * What remains different between the cells is passed in as values rather than as a second copy of
 * that order: the workshop imports the platform profile, names the Mach services a confined
 * verifier may ask for, and reads host platform directories through the derived grant, while the
 * authoring session writes `/dev` and carries the workshop tree in its own read denies.
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
  // SBPL regexes are emitted raw as #"..." rather than through `sb`, because JSON quoting would
  // double every backslash the pattern carries and the rule would then match nothing.
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
  // The workshop asks the platform for its toolchain and its Mach services, because it runs
  // installed tools it did not bring; the authoring session runs the host's own and needs neither.
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
    `${measuredDenyRules}\n${HIDDEN_TASKS_DENY_RULES}\n${VERIFIER_TEMP_DENY_RULES}`,
  ].join("");
  // The cell's own HOME and caches are granted after the config-name denies, and that order is
  // exactly what gives the cell its exemption from them: a cell writes its own `.env` and its own
  // `auth.json` as ordinary runtime state, and only a neighbour's copy of those names is a secret.
  // The names stay shut everywhere else, the cell's own source tree included, because the grant
  // over that tree is emitted before the denies rather than after them.
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
