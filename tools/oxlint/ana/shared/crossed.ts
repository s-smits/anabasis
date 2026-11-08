/**
 * Which arguments of a call are each named for another position's parameter, read the same way by
 * the per-file rule `ana/no-transposed-argument` and the whole-tree scan `tree/crossed-argument`.
 *
 * An argument names a parameter when its words begin or end with the parameter's words
 * (`sourcePath` names `source`). An argument points at another position when it names that
 * position's parameter, names no other parameter of the call and does not name its own. A crossing
 * is a cycle of such pointers: two arguments swapped, or three or more rotated (`f(b, c, a)` for
 * `f(a, b, c)`). One argument pointing elsewhere is a coincidence, and so is a chain of pointers
 * that never closes; an argument whose pointer leads into a cycle is not part of it. A crossing
 * among parameters one of whose names names another's (`path` and `basePath`) is not reported,
 * since neither name then decides.
 */

/** The lower-case words of a camel-case or snake-case name. */
function wordsOf(name: string): string[] {
  return name
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase()
    .split(" ")
    .filter((word) => word !== "");
}

/** Whether a name's words begin or end with a parameter's words: `sourcePath` fits `source`. */
function fits(name: string, parameter: string): boolean {
  const have = wordsOf(name);
  const want = wordsOf(parameter);
  if (want.length === 0 || want.length > have.length) return false;
  const offset = have.length - want.length;
  return want.every((word, k) => have[k] === word) || want.every((word, k) => have[offset + k] === word);
}

/** The one other position whose parameter an argument names, or null. */
function pointerOf(name: string | null, own: string | null, params: readonly (string | null)[]) {
  if (name === null || own === null || fits(name, own)) return null;
  const named = params.flatMap((param, j) => (param !== null && fits(name, param) ? [j] : []));
  return named.length === 1 ? (named[0] ?? null) : null;
}

/**
 * The crossings of a call: each a list of argument positions in order, where the argument at each
 * position names the parameter of the next and the last names the first's.
 */
export function crossings(names: readonly (string | null)[], params: readonly (string | null)[]): number[][] {
  const pointers = names.map((name, i) => pointerOf(name, params[i] ?? null, params));
  const found: number[][] = [];
  const seen = new Set<number>();
  for (let start = 0; start < pointers.length; start += 1) {
    const cycle: number[] = [];
    let at: number | null = start;
    while (at !== null && !seen.has(at) && !cycle.includes(at)) {
      cycle.push(at);
      at = pointers[at] ?? null;
    }
    for (const one of cycle) seen.add(one);
    const back = at === null ? -1 : cycle.indexOf(at);
    const crossing = back === -1 ? [] : cycle.slice(back);
    const crossed = crossing.map((i) => params[i] ?? "");
    const nested = crossed.some((one, i) => crossed.some((other, j) => i !== j && fits(one, other)));
    if (crossing.length > 1 && !nested) found.push(crossing);
  }
  return found;
}
