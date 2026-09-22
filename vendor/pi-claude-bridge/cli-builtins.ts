/** The CLI-owned builtin rule, held beside the vendored provider rather than inside it.
 *
 *  A builtin such as WebSearch executes inside the CLI's own loop and answers itself there, so it
 *  never becomes a pi tool call: lifting it into one would make pi's registry reject a tool that
 *  already ran. That also means the host sees no trace of it. Runs w28 and w30 declared
 *  `web-search:claude` for the Built slot with no way to show whether a single search happened,
 *  because the only record was the CLI's own transcript in the worker's config dir, deleted when
 *  the worker closed. `observer` is the interface that lets the host record the call as evidence.
 */
type BuiltinToolCall = { name: string; id: string; input: unknown };

export type BuiltinToolObserver = (call: BuiltinToolCall) => void;

/** True when the CLI owns this tool name, in which case the observer sees the call first. `call` is
 *  absent where the provider knows the name alone; the ownership answer does not depend on it. */
export function cliOwnedBuiltin(
  builtinTools: readonly string[] | undefined,
  observer: BuiltinToolObserver | undefined,
  name: string,
  call?: { id: string; input: unknown },
): boolean {
  if (!(builtinTools ?? []).includes(name)) return false;
  if (call !== undefined) observer?.({ name, id: call.id, input: call.input });
  return true;
}
