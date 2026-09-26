/**
 * Which published branch a run's commit came from. The source identity answers what ran; this
 * answers which pull request that was, so a reader can tell whether the PR has moved since
 * without searching every open branch for the sha. No capture at module load, so the launcher
 * and the runs reader can import it without hashing their own checkout.
 */
import { parseJsonAs } from "../meta/json-runtime.ts";
import { isBoolean, isNumber, isRecord, isString } from "../meta/json-shape.ts";
import { errorMessage } from "../meta/runtime-values.ts";

/** One open pull request of the stack a run was launched from. */
export type StackEdge = { pr: number; branch: string; head: string; base: string };

/**
 * As the launcher read GitHub before it forked the run's worktree. `stack` runs from the pull
 * request carrying the commit down to the one based on `main`, is empty when no open pull request
 * carries it, and is null when GitHub could not be read; `atHead` says whether the commit was that
 * pull request's head or an earlier commit of it.
 */
export type SourceRef = { requested: string; main: string; atHead: boolean; stack: StackEdge[] | null };

/** The environment variable the launcher passes the reference through, so a source that predates
 *  it ignores it instead of refusing an unknown fullrun flag. */
export const SOURCE_REF_ENV = "ANA_SOURCE_REF";

const SHA = /^[0-9a-f]{40}$/;

function stackEdge(value: unknown): StackEdge | null {
  if (!isRecord(value)) return null;
  const { pr, branch, head, base } = value;
  return isNumber(pr) &&
    Number.isInteger(pr) &&
    pr > 0 &&
    isString(branch) &&
    isString(base) &&
    isString(head) &&
    SHA.test(head)
    ? { pr, branch, head, base }
    : null;
}

/**
 * A recorded reference, or null when there is none. A value that is present but malformed, or that
 * names a head other than the commit it was launched on, throws: an opening would otherwise record
 * a false account of where the run came from.
 */
export function sourceRefOf(value: unknown, commit: string | undefined): SourceRef | null {
  if (value === undefined || value === null) return null;
  const listed = isRecord(value) && Array.isArray(value.stack) ? value.stack : [];
  const edges = listed.flatMap((row) => stackEdge(row) ?? []);
  const stack = isRecord(value) && value.stack === null ? null : edges;
  if (
    !isRecord(value) ||
    (stack !== null && (!Array.isArray(value.stack) || edges.length !== listed.length)) ||
    !isString(value.requested) ||
    !isString(value.main) ||
    !SHA.test(value.main) ||
    !isBoolean(value.atHead) ||
    (value.atHead && stack?.[0]?.head !== commit)
  ) {
    throw new Error(`the source reference does not describe the launched commit ${commit ?? "(unknown)"}`);
  }
  return { requested: value.requested, main: value.main, atHead: value.atHead, stack };
}

/** The reference the launcher handed this process, or null when it was launched without one. */
export function launchSourceRef(text: string | undefined, commit: string | undefined): SourceRef | null {
  if (text === undefined || text === "") return null;
  try {
    return sourceRefOf(parseJsonAs<unknown>(text), commit);
  } catch (error) {
    throw new Error(`${SOURCE_REF_ENV}: ${errorMessage(error)}: ${text}`, { cause: error });
  }
}

/** One line naming where the launched commit came from. `now` answers a branch's head as it stands
 *  today, so a pull request that has moved since the launch says so. */
export function describeSourceRef(
  ref: SourceRef,
  now: (branch: string) => string | null = () => null,
): string {
  if (ref.stack === null) return `requested ${ref.requested}; GitHub was unreadable at launch`;
  const top = ref.stack[0];
  if (top === undefined) {
    return `requested ${ref.requested}; no open pull request carried it (main ${ref.main.slice(0, 9)})`;
  }
  const chain = ref.stack.map((edge) => `#${edge.pr}`).toReversed();
  const at = ref.atHead ? "its head" : `an earlier commit (head then ${top.head.slice(0, 9)})`;
  const current = now(top.branch);
  const moved =
    current === null
      ? ""
      : current === top.head
        ? ", unmoved since"
        : `, since moved to ${current.slice(0, 9)}`;
  return `PR #${top.pr} ${top.branch} at ${at}${moved}; stack main → ${chain.join(" → ")}`;
}
