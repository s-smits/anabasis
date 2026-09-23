/**
 * Whether the files a continuation says it changed actually moved.
 *
 * A continuation can declare a repair to the reference solve across three rounds while the file
 * keeps one hash throughout, and nothing notices, because EXPERIMENT.json's prose is otherwise
 * never read against the snapshot. Intent still changes no score — this only refuses a declaration
 * the accepted bytes contradict, and the author resolves it in the same session by naming what
 * moved.
 */

import { BATTERY_FILES, type FingerprintEvidence } from "../claim/fingerprint.ts";
import { AGENT_DIR, CORRECTNESS_MODEL_DIR } from "../meta/bundle-layout.ts";

/** A bundle-relative path with a source or data suffix, as the prose spells it. Deliberately
 *  narrow: a sentence about "the evaluator" names no file and is read as naming nothing. */
const PATH_TOKEN = /[A-Za-z0-9._\-/]*[A-Za-z0-9._-]\.(?:ts|tsx|json|md|ya?ml)\b/g;

type NamedFile = { path: string; state: "moved" | "unmoved" | "unresolved" };

/** Every distinct path-shaped token in the proposal's own text, in the order it names them. */
function namedPaths(change: string): string[] {
  const seen = new Set<string>();
  for (const match of change.matchAll(PATH_TOKEN)) {
    const path = match[0].replace(/^\.\//, "").replace(/^\/+/, "");
    if (path.length > 0) seen.add(path);
  }
  return [...seen];
}

/** The hash a bundle's file list carries for `path`, or null when the bundle does not carry it. */
function hashIn(files: readonly { path: string; sha256: string }[], path: string): string | null {
  return files.find((file) => file.path === path)?.sha256 ?? null;
}

/** Resolve one named path against both trees. A path neither bundle carries under either spelling
 *  is `unresolved`: the prose may be naming a workspace note, and an absent file proves nothing. */
function resolve(path: string, adopted: FingerprintEvidence, candidate: FingerprintEvidence): NamedFile {
  const leaf = path.split("/").pop() ?? path;
  // tasks.json and controls.json sit outside correctnessModelFiles; one hash covers the pair.
  if (BATTERY_FILES.some((name) => name === leaf)) {
    return { path, state: adopted.taskSetHash === candidate.taskSetHash ? "unmoved" : "moved" };
  }
  for (const [prefix, before, after] of [
    [AGENT_DIR, adopted.agentFiles, candidate.agentFiles],
    [CORRECTNESS_MODEL_DIR, adopted.correctnessModelFiles, candidate.correctnessModelFiles],
  ] as const) {
    const inner = path.startsWith(prefix) ? path.slice(prefix.length) : path;
    const [was, is] = [hashIn(before, inner), hashIn(after, inner)];
    if (was === null && is === null) continue;
    return { path, state: was === is ? "unmoved" : "moved" };
  }
  return { path, state: "unresolved" };
}

/** The refusal detail when the proposal names bundle files and none of them moved, or null. A
 *  single moved file settles it: prose that names an unchanged file for context is not a false
 *  declaration, and the author is not asked to describe the change without naming anything. */
export function unmovedChangeDetail(
  change: string,
  adopted: FingerprintEvidence,
  candidate: FingerprintEvidence,
): string | null {
  const named = namedPaths(change).map((path) => resolve(path, adopted, candidate));
  const unmoved = named.flatMap((file) => (file.state === "unmoved" ? [file.path] : []));
  if (unmoved.length === 0 || named.some((file) => file.state === "moved")) return null;
  return `The change names ${unmoved.join(", ")}, and every one of them is byte-identical to the adopted product. Make the change in the bytes, or rewrite the change to name what this candidate actually moved; submit again in this session.`;
}
