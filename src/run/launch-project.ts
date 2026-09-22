/**
 * Which campaign tree a run's evidence joins.
 *
 * The id is derived, not chosen: the same one-line request under the same context always names
 * the same project, and two different requests never share a tree. Omitting `--project` always
 * creates a fresh id; only an explicit one may continue existing state.
 */

import { hashJsonBytes } from "../meta/json-runtime.ts";
import { assertExternalPathSegment } from "../meta/path-segment.ts";
import { recordedProjects } from "./project-registry.ts";

type ProjectOrigin = "operator" | "created";

export type ProjectIdentity = {
  id: string;
  /** This invocation's prompt + admitted-context revision; never a path key. */
  requestDigest: string;
  origin: ProjectOrigin;
};

/** Words that appear in most requests and would therefore name most projects the same. */
const GENERIC = new Set([
  "build",
  "building",
  "harness",
  "harnesses",
  "task",
  "tasks",
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "please",
  "agent",
  "solver",
]);

const STEM_LIMIT = 48;

function digestRequest(prompt: string, contextDigest: string): string {
  return hashJsonBytes({ prompt, contextDigest });
}

/** The readable half of the id: the first four words that say something about the domain. The
 *  length cut can land on a separator, so the stem is trimmed before the digest is joined on. */
function stem(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !GENERIC.has(word))
    .slice(0, 4);
  return (words.length === 0 ? "request" : words.join("-")).slice(0, STEM_LIMIT).replace(/-+$/, "");
}

function projectId(prompt: string, digest: string): string {
  return `${stem(prompt)}-${digest.slice(0, 8)}`;
}

export function slugForDirectInput(prompt: string, contextDigest: string): string {
  return projectId(prompt, digestRequest(prompt, contextDigest));
}

/** The next id this request can own: one past the highest ordinal its base has ever carried, never
 *  the first gap. Two concurrent identical requests end up on separate trees, and a trashed campaign
 *  never hands its id to an unrelated run whose notes would then name two projects. */
function freshProject(
  repoRoot: string,
  prompt: string,
  digest: string,
): Pick<ProjectIdentity, "id" | "origin"> {
  const base = projectId(prompt, digest);
  // The base is lowercase words, hyphens and hex, so it needs no escaping.
  const suffix = new RegExp(`^${base}-([1-9]\\d*)$`);
  const ordinals = recordedProjects(repoRoot).map((name) =>
    name === base ? 1 : Number(suffix.exec(name)?.[1] ?? 0),
  );
  const ordinal = Math.max(0, ...ordinals);
  return { id: ordinal === 0 ? base : `${base}-${ordinal + 1}`, origin: "created" };
}

/** Resolve project identity without writing. The caller holds the registry lock beside the shared
 *  registry, which is what makes the ordinal above decide between concurrent launches from any
 *  worktree. */
export function selectProject(
  repoRoot: string,
  prompt: string,
  contextDigest: string,
  explicit?: string,
): ProjectIdentity {
  const requestDigest = digestRequest(prompt, contextDigest);
  const chosen =
    explicit === undefined
      ? freshProject(repoRoot, prompt, requestDigest)
      : { id: explicit, origin: "operator" as const };
  assertExternalPathSegment("project", chosen.id);
  return { ...chosen, requestDigest };
}
