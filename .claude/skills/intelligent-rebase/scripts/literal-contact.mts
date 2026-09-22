/**
 * Contact the import graph cannot see: both sides changed a line carrying the same literal.
 *
 * The coupling scan reads imports, so it is blind in exactly the places this repository keeps its
 * couplings: an env variable name, a record field both a writer and a reader spell, a backend kind
 * string, a threshold key in a JSON or YAML policy file, a fixture path. Two sides can agree to
 * disagree about any of those without sharing one import.
 *
 * The method is deliberately small. Take the lines each side added or removed, pull the quoted
 * strings, the leading `key:` of each line and every SCREAMING_SNAKE token out of them, and
 * intersect the two sets, keeping the tokens shaped like an identity. A literal both sides moved is
 * a lead; a literal one side moved is not.
 * It reads text, so it covers every file type either side touched — `.json`, `.yaml`, `.md`, `.mts`
 * and source alike — and it knows nothing about meaning: a shared `"claude"` may be two unrelated
 * uses. Confirm each row in source, as with every other row this skill prints.
 */

import { hasText } from "#src/meta/text.ts";

export type Change = { before: string; after: string };
export type Row = { token: string; a: string[]; b: string[] };

const QUOTED = /"([^"\n]{2,80})"|'([^'\n]{2,80})'/g;
const SHOUTED = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const LEADING_KEY = /^[\s"'-]*([A-Za-z_$][\w.$-]{3,60})\s*[:=]/;
const NUMERIC = /^[\d.\-+eE]+$/;
const SEPARATED = /[._\-/]/;
const INNER_CAPS = /[a-z][A-Z]/;
const ALL_CAPS = /^[A-Z0-9_]+$/;
const MIN_LENGTH = 4;
const SPECIFIER = /^(?:\.{1,2}\/|@[a-z])/;
const MAX_SPREAD = 8;

/**
 * An identity carries a separator, an internal capital, or is all caps. A bare lowercase word is a
 * word however long it is: measured on origin/main against b7d9be2a9, admitting words of eight
 * characters or more let `evidence`, `hardware`, `returned`, `reasoning`, `campaign`, `provider` and
 * `controller` through, and every one of them was two changes using the same English, not the same
 * identity. The cost is that a bare kind string such as "claude" is dropped with them. A module
 * specifier is dropped for a different reason: it is an import edge, and the graph scores it already.
 */
function keep(token: string): boolean {
  if (token.length < MIN_LENGTH || NUMERIC.test(token) || !/[A-Za-z]/.test(token)) return false;
  // `../meta/path.ts` and `@ana/agent-bundle` are import edges, which the graph above already scores
  if (SPECIFIER.test(token)) return false;
  return SEPARATED.test(token) || INNER_CAPS.test(token) || ALL_CAPS.test(token);
}

function tokensIn(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(QUOTED)) out.push(m[1] ?? m[2] ?? "");
  for (const m of line.matchAll(SHOUTED)) out.push(m[0]);
  const key = LEADING_KEY.exec(line);
  if (hasText(key?.[1])) out.push(key[1]);
  return out.filter(keep);
}

/**
 * Lines present on one endpoint and not the other, in either direction: a literal a change removed
 * is as much a contact as one it added. Set arithmetic, so a line duplicated within a file counts
 * once, which is the right resolution for asking which literals moved.
 */
export function changedTokens(files: Map<string, Change>): Map<string, Set<string>> {
  const byToken = new Map<string, Set<string>>();
  for (const [file, { before, after }] of files) {
    const b = new Set(before.split("\n"));
    const a = new Set(after.split("\n"));
    const moved = [...a].filter((l) => !b.has(l)).concat([...b].filter((l) => !a.has(l)));
    for (const line of moved) {
      for (const token of tokensIn(line)) {
        byToken.set(token, (byToken.get(token) ?? new Set()).add(file));
      }
    }
  }
  return byToken;
}

/**
 * Literals both sides moved, narrowest contact first.
 *
 * Width is the wrong way round here. Measured on origin/main against b7d9be2a9, the widest rows were
 * `evidence`, `non-result`, `unaccepted` and `versions`, each carried by one file on one side and
 * fourteen to nineteen on the other: that is the repository's vocabulary, not a contact between two
 * changes. One file on each side is the row worth reading, so it goes first, and a token spread over
 * more than `MAX_SPREAD` files is dropped as vocabulary.
 */
export function literalContact(a: Map<string, Change>, b: Map<string, Change>): Row[] {
  const left = changedTokens(a);
  const right = changedTokens(b);
  const rows: Row[] = [];
  for (const [token, aFiles] of left) {
    const bFiles = right.get(token);
    if (!bFiles || aFiles.size + bFiles.size > MAX_SPREAD) continue;
    rows.push({ token, a: [...aFiles].sort(), b: [...bFiles].sort() });
  }
  return rows.sort(
    (x, y) => x.a.length + x.b.length - (y.a.length + y.b.length) || y.token.length - x.token.length,
  );
}
