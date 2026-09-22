/**
 * Names one side removed that the other side still uses.
 *
 * The import graph answers "do these two changes touch". It cannot answer "does the composition
 * still resolve", because a rename leaves nothing to conflict over: A renames an export, B writes
 * new code against the old name, every three-way merge is clean, and the break appears in typecheck
 * one push cycle later. That is the gap this skill already named as the one that has bitten
 * (2026-08-17, PR #267: `repairOwner: "oracle"` and a `grader/oracle.ts#solve` fixture path, one
 * cycle each), with a manual grep as its remedy.
 *
 * A grep is the wrong instrument on its own: a local variable of the same name reads exactly like a
 * broken import. So each row is ranked by the evidence behind it, and only an import carried at the
 * other side's own tip is called a break:
 *
 *   6  the other side imports that name from that exact file, or reaches it through a namespace
 *      import of it — the composition does not resolve
 *   3  the remover added the name back in another of its own files, and the other side names it
 *      without importing it from either — a move to follow, not a break
 *   2  the other side names it with no import from that file — a comment, a string, a local of the
 *      same name, or a re-export chain this scan cannot see
 *
 * Within a band, a use the other side *introduced* outranks one it merely carried: new code written
 * against an interface that is about to disappear is the case no reviewer is watching for.
 *
 * What is still missed: a name reached through a re-export chain, through a computed key, or from a
 * file neither side changed. Every row remains a lead to confirm in source.
 */

import { hasText } from "#src/meta/text.ts";

export type Names = Map<string, Set<string>>;
export type Texts = Map<string, string>;

/** One file's imports at one revision: which file each name came from, and each `* as` alias. */
export type ImportView = { named: Map<string, string[]>; namespaces: Map<string, string> };
export type Imports = Map<string, ImportView>;

export type Break = { severity: number; kind: string; detail: string };

export const BREAK = 6;
export const MOVED = 3;
export const MENTION = 2;

function word(name: string): RegExp {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}\\b`);
}

/** The alias, if the user file imports `* as alias` from `file` and writes `alias.name`. */
function viaNamespace(view: ImportView | undefined, file: string, name: string, text: string): string | null {
  for (const [alias, target] of view?.namespaces ?? []) {
    if (target === file && new RegExp(`\\b${alias}\\.${name}\\b`).test(text)) return alias;
  }
  return null;
}

/**
 * `removed`/`added` are the remover's own export deltas; `before`/`after` are the other side's
 * changed files at its two endpoints, and `imports` is what those files import at `after`. The other
 * side's endpoints are what matter: a use present in both is code the rebase carries, a use present
 * only in `after` is code it wrote.
 */
export function danglingRefs(input: {
  remover: string;
  user: string;
  removed: Names;
  added: Names;
  before: Texts;
  after: Texts;
  imports: Imports;
}): Break[] {
  const movedTo = new Map<string, string>();
  for (const [file, names] of input.added) for (const n of names) movedTo.set(n, file);

  const out: Break[] = [];
  for (const [file, removed] of input.removed) {
    for (const name of removed) {
      const re = word(name);
      const moved = movedTo.get(name);
      const rows: { severity: number; kind: string; where: string; fresh: boolean }[] = [];
      for (const [userFile, after] of input.after) {
        // the same file on both sides is already a severity 5 contact; it needs no second row
        if (userFile === file || !re.test(after)) continue;
        const view = input.imports.get(userFile);
        const byName = (view?.named.get(name) ?? []).includes(file);
        const alias = byName ? null : viaNamespace(view, file, name, after);
        const fresh = !re.test(input.before.get(userFile) ?? "");
        const where = `${userFile}${fresh ? " (new)" : ""}`;
        if (byName || hasText(alias)) {
          rows.push({
            severity: BREAK,
            kind: hasText(alias) ? `reached through ${alias}` : "imported by name",
            where,
            fresh,
          });
          continue;
        }
        rows.push({ severity: hasText(moved) ? MOVED : MENTION, kind: "named, not imported", where, fresh });
      }
      if (rows.length === 0) continue;

      // one row per name and evidence band: a reader repairs the name, not each file separately
      for (const severity of [BREAK, MOVED, MENTION]) {
        const band = rows.filter((r) => r.severity === severity);
        if (band.length === 0) continue;
        const fresh = band.some((r) => r.fresh);
        const how = [...new Set(band.map((r) => r.kind))].join(", ");
        const left = hasText(moved) ? `${name}: ${file} → ${moved}` : `${name} left ${file}`;
        const imports = fresh ? "newly imports it" : "imports it";
        const verb = severity === BREAK ? imports : "names it";
        out.push({
          severity,
          kind:
            severity === BREAK
              ? `${hasText(moved) ? "moved export still imported from the old file" : "removed export"} ${input.remover}→${input.user} (${how})`
              : `${hasText(moved) ? "moved export" : "removed export"} ${input.remover}→${input.user}`,
          detail: `${left}; ${input.user} ${verb} in ${band.map((r) => r.where).join(", ")}`,
        });
      }
    }
  }
  return out.sort((x, y) => y.severity - x.severity);
}

/**
 * A file that lost one export and gained another in the same change is usually a rename, which is
 * worth printing even when nothing downstream references it yet: it tells the reader which name the
 * rest of the stack is about to be measured against.
 */
export function renameHints(removed: Names, added: Names): string[] {
  const hints: string[] = [];
  for (const [file, gone] of removed) {
    const fresh = added.get(file);
    if (fresh === undefined || fresh.size === 0 || gone.size === 0) continue;
    hints.push(`${file}: ${[...gone].join(", ")} → ${[...fresh].join(", ")}`);
  }
  return hints;
}
