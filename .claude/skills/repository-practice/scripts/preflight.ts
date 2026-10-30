#!/usr/bin/env bun
/**
 * What a change owes before a commit or a pull request, read from its diff.
 *
 *   bun .claude/skills/repository-practice/scripts/preflight.ts [--base <rev> | --commit <rev>]
 *
 * With no option it reads the working tree against HEAD, untracked files included; `--base` reads
 * the working tree against another revision (the stack's previous head, say), and `--commit` reads
 * one recorded commit against its first parent. It prints, in order:
 *
 *  - whether the change is documentation alone, by the gate's own documentation set
 *    (`DOCUMENTATION`), in which case the static steps have nothing to read;
 *  - the test files one import away, chosen by the gate's own walk (`nearbyTests` at `NEAR.root`,
 *    `tools/runtime/gate.ts`), as a `bun run test -- ...` line;
 *  - whether `bun run ui:gate` is owed because `packages/ui` or what installs and lints it changed
 *    (`UI_ROOT`, `UI_SETUP`); a root file the UI imports still brings in its build and nearby UI tests
 *    under the gate (`uiStep`), which this does not walk;
 *  - each area of `tools/runtime/moments.ts` the change enters, with that area's own sentence, so the
 *    rule 3 wall tests for a seat's message, a replay for a measurement reader or a rehearsal for a
 *    campaign command are named by their one owner;
 *  - each changed authored file over 800 nonblank lines or with a function over 115
 *    (`sourceTextFindings`, `tools/loc/source-policy.ts`), measured on the text as it stands rather
 *    than after formatting;
 *  - in changed Markdown, outside code, quotation marks, links and paths, the slips of `AGENTS.md` section 13 that a
 *    pattern can see: an em dash, a word the section bans, a relative date, an exclamation mark, and a
 *    short list of American spellings;
 *  - the tree's own facts, each from its owner: the hooks (`git config core.hooksPath`), whether a run
 *    may start here (`treeFault`), and with `--stack` where the branch sits on the open stack, or the
 *    stacks' tops (`told` of `stack-pr/scripts/stack.ts`, over `openPulls`, which asks GitHub);
 *  - a suggested `importance:` label and category, from the paths alone and checked against
 *    `CATEGORIES` (`tools/runtime/land.ts`). It is a suggestion: the definitions in `AGENTS.md`
 *    section 11 and the operator decide.
 *
 * `--commit` reads each file as that commit holds it, and walks imports over today's test files, so
 * for an old commit the tests it names approximate what that commit's static pass chose.
 *
 * Written on 30 October, when `AGENTS.md` moved its account of sections 9 to 14 into this skill: a
 * session about to commit had to read the gate, the moments table, the size policy and the label set
 * to know what its change owed, and each of those already had one owner to ask.
 */
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { gitMaybe, gitOutput, gitText } from "#src/meta/git.ts";
import { told as stackTold } from "#skills/stack-pr/scripts/stack.ts";
import { treeFault } from "#tools/d2/campaign.ts";
import { AUTHORED_ROOTS, sourceTextFindings } from "#tools/loc/source-policy.ts";
import {
  changedSince,
  DOCUMENTATION,
  lines,
  NEAR,
  nearbyTests,
  parentOf,
  TEST_FILE,
  UI_ROOT,
  UI_SETUP,
} from "#tools/runtime/gate.ts";
import { CATEGORIES, openPulls } from "#tools/runtime/land.ts";
import { momentsOf } from "#tools/runtime/moments.ts";

/** The diff a preflight reads: every changed path, those beyond the documentation set, and the
 *  revision whose files are read (null for the working tree). */
export interface Change {
  readonly all: readonly string[];
  readonly code: readonly string[];
  readonly at: string | null;
}

interface ProseFinding {
  readonly path: string;
  readonly line: number;
  readonly kind: string;
  readonly text: string;
}

interface Area {
  readonly id: string;
  readonly said: string;
  readonly files: string[];
}

/** What a change owes, as facts; `told` renders it. */
export interface Owed {
  readonly changed: number;
  readonly documentationOnly: boolean;
  readonly tests: readonly string[];
  readonly ui: readonly string[];
  readonly areas: readonly Area[];
  readonly size: readonly string[];
  readonly prose: readonly ProseFinding[];
  readonly category: { readonly label: string; readonly counts: Readonly<Record<string, number>> };
  readonly importance: { readonly label: string; readonly why: string };
}

const USAGE = "preflight.ts [--base <rev> | --commit <rev>] [--stack]";
/** Section 13's slips that a pattern can see, each with what it reports. */
const PROSE: readonly (readonly [string, RegExp])[] = [
  ["em dash", /—/u],
  ["banned word", /\b(?:robust|bulletproof|10x)\b/iu],
  ["relative date", /\b(?:yesterday|tomorrow|tonight|last (?:week|month|night)|next (?:week|month))\b/iu],
  ["exclamation mark", /\w!(?:\s|$)/u],
  [
    "American spelling",
    /\b(?:behaviors?|colors?|analyz(?:e|ed|es|ing)|cent(?:er|ered)|favor(?:s|ed|ite)?|label(?:ed|ing)|model(?:ed|ing)|optimiz(?:e|ed|es|ing|ation)|organiz(?:e|ed|ation)|summariz(?:e|ed)|recogniz(?:e|ed)|catalogs?)\b/iu,
  ],
];
/** What a prose scan leaves out of a line: inline code, a quotation (a banned word cited as banned),
 *  a Markdown link, which names a file, and a bare path. */
const QUOTED = /`[^`]*`|"[^"]*"|\[[^\]]*\]\([^)]*\)|\S*\/\S*/gu;
/** How many lines of one file's slips of one kind are named. */
const SHOWN = 5;
/** Paths to the category whose description names them, first match wins (`gh label list`, 30
 *  October). A test file is left out of the vote: it takes the subject of what it tests. */
const CATEGORY_OF: readonly (readonly [RegExp, string])[] = [
  [/^(?:AGENTS\.md|README\.md|docs\/)|\.md$/u, "docs"],
  [/^src\/kernel\/(?:log|task|trace|reports)\.ts$|^tools\/wri\/|^packages\/ui\//u, "log"],
  [/^tools\/d2\/(?:close|host)\.ts$|^src\/agent\/session\.ts$/u, "economy"],
  [
    /^src\/kernel\/(?:compare|size|condition)\.ts$|^src\/campaign\/(?:comparison|round|admission)\.ts$|^tools\/d2\/checkpoint\.ts$/u,
    "comparison",
  ],
  [/^src\/campaign\/(?:climb|decide|ground)\.ts$|^tools\/d2\/promote\.ts$/u, "climb"],
  [/^src\/(?:builder|harness)\/|^tools\/d2\/campaign-actions\.ts$/u, "harness"],
  [/^src\/examiner\/|^tools\/d1b\/|^tools\/d2\/(?:prepare|exam)\.ts$/u, "supply"],
  [
    /^src\/referee\/|^src\/kernel\/(?:verify|acceptance)\.ts$|^tools\/c\/|^tools\/d2\/settle\.ts$/u,
    "verdicts",
  ],
  [/^src\/(?:solver|agent|wall|tools)\/|^src\/kernel\/solve\.ts$|^vendor\//u, "solve"],
  [/^src\/campaign\/|^tools\/d2\//u, "climb"],
  [/^tools\/runs\//u, "runs"],
  [/^tools\/runtime\/|^\.githooks\/|^\.github\//u, "landing"],
  [/^tools\/(?:oxlint|loc)\/|^biome\.json$|^\.oxlintrc\.json$/u, "quality"],
];
/** The categories that name a subject only where no other does: prose beside code is the code's. */
const FALLBACK = new Set(["docs", "misc"]);
/** The categories whose change may bear on comparison validity, so I1 is worth asking about. */
const VALIDITY = new Set(["comparison", "verdicts"]);

/** The diff of one commit against its first parent, or of the working tree against `base`. */
export function changeOf(
  root: string,
  from: { readonly commit: string } | { readonly base: string },
): Change {
  if ("commit" in from) {
    const range = [parentOf(root, from.commit), from.commit];
    return {
      all: lines(gitText(root, "diff", "--name-only", ...range)),
      code: lines(gitText(root, "diff", "--name-only", ...range, "--", ".", ...DOCUMENTATION)),
      at: from.commit,
    };
  }
  return {
    all: [
      ...new Set([
        ...lines(gitText(root, "diff", "--name-only", from.base)),
        ...lines(gitText(root, "ls-files", "--others", "--exclude-standard")),
      ]),
    ],
    code: [...changedSince(root, from.base)],
    at: null,
  };
}

/** A file's text in the change, or null where the change deleted it. */
function textOf(root: string, at: string | null, file: string): string | null {
  if (at === null) return existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : null;
  try {
    return gitOutput(root, "show", `${at}:${file}`);
  } catch {
    // The commit deleted the file, so there is nothing to measure.
    return null;
  }
}

/** Section 13's visible slips in one Markdown text, outside fenced code and what `QUOTED` matches. */
export function proseFindings(path: string, text: string): ProseFinding[] {
  let fenced = false;
  return text.split("\n").flatMap((raw, index) => {
    if (raw.trimStart().startsWith("```")) {
      fenced = !fenced;
      return [];
    }
    if (fenced) return [];
    const bare = raw.replaceAll(QUOTED, "");
    return PROSE.flatMap(([kind, pattern]) => {
      const found = pattern.exec(bare);
      return found === null ? [] : [{ path, line: index + 1, kind, text: found[0] }];
    });
  });
}

const inside = (file: string, path: string): boolean => file === path || file.startsWith(`${path}/`);

/** The suggested labels: the category most changed files fall under, and an importance by the
 *  definitions of `AGENTS.md` section 11, read from the categories alone. */
export function labelsOf(files: readonly string[]): Pick<Owed, "category" | "importance"> {
  const counts: Record<string, number> = {};
  for (const file of files.filter((each) => !TEST_FILE.test(each))) {
    const kind = CATEGORY_OF.find(([pattern]) => pattern.test(file))?.[1] ?? "misc";
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  const subjects = Object.entries(counts).filter(([kind]) => !FALLBACK.has(kind));
  const ranked = (subjects.length > 0 ? subjects : Object.entries(counts)).toSorted((a, b) =>
    a[1] === b[1] ? a[0].localeCompare(b[0]) : b[1] - a[1],
  );
  const label = ranked[0]?.[0] ?? "misc";
  if (!CATEGORIES.has(label)) throw new CommandFailure(`category ${label} is not one land accepts`);
  const validity = Object.keys(counts).filter((kind) => VALIDITY.has(kind));
  const importance =
    validity.length > 0
      ? {
          label: "importance:I1",
          why: `it touches ${validity.join(", ")}: I1 if it protects comparison validity, else I2`,
        }
      : subjects.length === 0
        ? { label: "importance:I3", why: "documentation, skills or wording only" }
        : {
            label: "importance:I2",
            why: "a functional change with bounded impact, unless it blocks a release (I0)",
          };
  return { category: { label, counts }, importance };
}

/** What `change` owes, read in `root`. */
export function owedOf(root: string, change: Change): Owed {
  const tests = lines(gitText(root, "ls-files", "--cached", "--others", "--exclude-standard", "test")).filter(
    (file) => TEST_FILE.test(file),
  );
  const areas = new Map<string, Area>();
  for (const file of change.all) {
    for (const route of momentsOf({ file_path: file }, new Set())) {
      const area = areas.get(route.id) ?? { id: route.id, said: route.said, files: [] };
      area.files.push(file);
      areas.set(route.id, area);
    }
  }
  const authored = change.code.filter(
    (file) => /\.tsx?$/u.test(file) && AUTHORED_ROOTS.some((top) => inside(file, top)),
  );
  const markdown = change.all.filter((file) => file.endsWith(".md"));
  return {
    changed: change.all.length,
    documentationOnly: change.code.length === 0,
    tests: change.code.length === 0 ? [] : nearbyTests(root, new Set(change.code), tests, NEAR.root),
    ui: change.code.filter((file) => [UI_ROOT, ...UI_SETUP].some((path) => inside(file, path))),
    areas: [...areas.values()],
    size: authored.flatMap((file) => {
      const text = textOf(root, change.at, file);
      return text === null ? [] : sourceTextFindings(file, text).map((found) => `${file}: ${found.detail}`);
    }),
    prose: markdown.flatMap((file) => {
      const text = textOf(root, change.at, file);
      return text === null ? [] : proseFindings(file, text);
    }),
    ...labelsOf(change.all),
  };
}

/** One line for each file and kind of slip: the count, and the first lines with what matched. */
function proseLines(found: readonly ProseFinding[]): string[] {
  const groups = Map.groupBy(found, (each) => `${each.path}: ${each.kind}`);
  return [...groups].map(([group, each]) => {
    const shown = each.slice(0, SHOWN).map((one) => `${String(one.line)} "${one.text}"`);
    const more = each.length > SHOWN ? `, and ${String(each.length - SHOWN)} more` : "";
    return `prose: ${group} x${String(each.length)} (line ${shown.join(", ")}${more})`;
  });
}

/** The lines a preflight prints. */
export function told(owed: Owed): string[] {
  const counts = Object.entries(owed.category.counts)
    .map(([label, count]) => `${label} ${String(count)}`)
    .join(", ");
  return [
    `changed: ${String(owed.changed)} files${owed.documentationOnly ? ", documentation only: the static steps have nothing to read" : ""}`,
    owed.tests.length === 0
      ? "tests: no test file is one import from the change"
      : `tests (${String(owed.tests.length)}, as the static gate chooses): bun run test -- ${owed.tests.join(" ")}`,
    owed.ui.length === 0
      ? "ui: no file of packages/ui or its setup changed"
      : `ui: bun run ui:gate is owed (${owed.ui.join(", ")})`,
    ...owed.areas.map((area) => `area ${area.id} (${String(area.files.length)} files): ${area.said}`),
    owed.size.length === 0
      ? "size: no changed authored file over a ceiling"
      : `size: ${owed.size.join("; ")}`,
    ...(owed.prose.length === 0 ? ["prose: no section 13 slip a pattern can see"] : proseLines(owed.prose)),
    `labels (a suggestion): ${owed.importance.label} (${owed.importance.why}); ${owed.category.label} (by changed files: ${counts})`,
  ];
}

/** The facts about the tree a change is made in, each from its owner: whether the hooks are on
 *  (`git config core.hooksPath`, set by `bun run hooks:install`), whether a run may start here
 *  (`treeFault`, `tools/d2/campaign.ts`), and with `stack` where the branch sits on the open stack
 *  (`told`, `.claude/skills/stack-pr/scripts/stack.ts`, which asks GitHub). */
export function treeLines(root: string, stack: "stack" | "no-stack"): string[] {
  const hooks = gitMaybe(root, "config", "core.hooksPath");
  const fault = treeFault(root);
  const branch = gitMaybe(root, "symbolic-ref", "--short", "HEAD");
  const pulls = stack === "stack" ? openPulls(root) : [];
  const own = pulls.some((pull) => pull.headRefName === branch);
  return [
    hooks === ".githooks"
      ? "hooks: on (.githooks)"
      : `hooks: ${hooks ?? "unset"}, so a commit and a push go unchecked; run bun run hooks:install`,
    fault === null ? "tree: may hold a run or a simulation" : `tree: no run here: ${fault}`,
    ...(stack === "stack"
      ? stackTold(pulls, own ? branch : null)
          .filter((line) => own || line.startsWith("top:"))
          .map((line) => `stack: ${line}`)
      : []),
  ];
}

if (import.meta.main) {
  await runCommand(
    { name: "preflight", usage: USAGE, options: { base: "text", commit: "text", stack: "flag" } },
    (args: CommandArgs) => {
      const commit = args.value("commit");
      const base = args.value("base");
      if (commit !== null && base !== null) args.die("--base and --commit name two diffs; pass one");
      const root = gitText(runtimeProcess.cwd(), "rev-parse", "--show-toplevel");
      const change = changeOf(root, commit === null ? { base: base ?? "HEAD" } : { commit });
      const tree = treeLines(root, args.flag("stack") ? "stack" : "no-stack");
      console.log([...told(owedOf(root, change)), ...tree].join("\n"));
    },
  );
}
