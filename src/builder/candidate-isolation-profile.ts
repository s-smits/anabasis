/**
 * The OS half of the Builder isolation: one policy value in, one Seatbelt profile out.
 *
 * `candidate-isolation.ts` defines the policy; this file expresses it in SBPL. Seatbelt takes the
 * last matching rule, so each rule's position matters as much as its presence.
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

/** The Seatbelt profile text the sandbox is given and the digest evidence cites. */
interface CandidateIsolationProfile {
  profile: string;
  profileDigest: string;
}

/**
 * Both profiles allow metadata reads everywhere, including paths whose contents remain denied.
 *
 * Loaders and `getcwd` stat every ancestor of the path they open, so an unstattable ancestor would
 * make a granted file unusable. Contents stay protected: opening a denied file or listing a denied
 * directory is still refused.
 */
const METADATA_EVERYWHERE = '(allow file-read-metadata (subpath "/"))';

/** Top-level directories holding people's data rather than the platform: the two home roots and
 *  removable or network mounts. */
const NON_PLATFORM_ROOTS = new Set(["Users", "home", "Volumes", "net"]);

/** Escapes a path for use as a literal inside an SBPL regex. */
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
 * The host's platform directories, derived from the filesystem root so a newly installed platform
 * directory needs no list entry. The home roots stay out, keeping user files, credentials and
 * other campaigns' trees unreadable; the secret and repository denies still follow these allows.
 */
function platformReadRoots(): string[] {
  try {
    return readdirSync("/")
      .filter((name) => !NON_PLATFORM_ROOTS.has(name))
      .map((name) => `/${name}`)
      .sort();
  } catch {
    // An unreadable root grants nothing extra, so the policy narrows rather than widens.
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
 * A repository checked out under a temp scratch root sits inside that grant, which would re-allow
 * the repository. Outer roots are granted before the repository is carved out, inner ones after.
 */
function splitScratchRoots(policy: CandidateAccessPolicy) {
  const insideRepo = (root: string) => posixContainsPath(root, policy.repoRoot);
  const rule = (path: string): IsolationRule => ({ kind: "subpath", path, id: "host-scratch" });
  return {
    outer: policy.scratchWriteRoots.filter((root) => !insideRepo(root)).map(rule),
    inner: policy.scratchWriteRoots.filter(insideRepo).map(rule),
  } satisfies { outer: IsolationRule[]; inner: IsolationRule[] };
}

// Hidden tasks are denied last of all, so nothing re-opens them. The Built Harness's wider
// run-data list does not apply: the Builder authors under `/campaigns/`, and `/domains/` is an
// ordinary package path segment.
const HIDDEN_TASKS_DENY_RULES = `${runDataDenyRules([HIDDEN_TASKS_DENY_PATTERN]).join("\n")}
(deny file-write* (regex #"${HIDDEN_TASKS_DENY_PATTERN}"))`;

/**
 * One profile text, in one rule order, for both cells. SBPL takes the last matching rule:
 *
 *   base → close home and host writes → platform/scratch grants → close the repository →
 *   the policy's own grants → final cross-cell, measured-evidence and hidden-task denies.
 *
 * The workshop also imports the platform profile, names the Mach services a confined verifier may
 * use and reads host platform directories; the authoring session writes `/dev`.
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
  // The cell's own HOME and caches follow the config-name denies, so the cell may write its own
  // `.env` and `auth.json`; those names stay shut everywhere else.
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
