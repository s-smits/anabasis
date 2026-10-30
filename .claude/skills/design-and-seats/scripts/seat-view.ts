#!/usr/bin/env bun
/**
 * Which seats' messages a change can reach, and which wall tests prove them.
 *
 *   bun .claude/skills/design-and-seats/scripts/seat-view.ts [--base <rev>] [--file <path>]...
 *
 * Rule 3 asks that changing a hidden value, a check, or which held-out task a harness other than the
 * reference won leave every message a Builder or a solver reads byte-identical, and that a pull
 * request touching such a message say how it checked this. Whether a diff touches one is a question
 * of the import graph: a Builder reads what `src/builder/` and the campaign tools compose, and they
 * read the kernel's folds. This script reads the graph from the tree at each seat's owners (`SEATS`),
 * names every changed file that one of them imports at any depth, with the shortest chain of imports
 * from an owner, the wall tests that seat has, and the `bun run test` line that runs them.
 *
 * The changed files are those of the working tree against `--base` (default: the merge base of HEAD
 * with its upstream, else with `origin/main`), untracked ones included, or the files `--file`
 * names, as `--file=<path>` once each (`git diff-tree --name-only -r <commit>` gives a commit's).
 * The graph is always the working tree's, read by the CI gate's own reader (`importsOf`,
 * `tools/runtime/gate.ts`). Import reach over-states message reach: a file a seat's owner imports
 * can change what the seat reads, and most of the kernel does for every seat, so the chain printed
 * beside each file is the lead to read. It also misses what reaches a seat without an import: a
 * worker spawned by its path, a file a harness or a home holds, the log. Only the seats' owners and
 * their wall tests are a hand-kept table, and the script refuses to run when one of them has left
 * the tree, so the table cannot go stale in silence. The Referee has no wall test of its own: its
 * view is fixed by what `src/referee/referee.ts` hands it, and `test/review.test.ts` is its owning
 * file.
 *
 * It reads no log, so it prints no hidden value. Written on 30 October, when `AGENTS.md` sections 1
 * to 3 moved to the skill `design-and-seats`.
 */
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { gitMaybe, gitText } from "#src/meta/git.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { importsOf, lines } from "#tools/runtime/gate.ts";

/** A model seat whose messages the wall governs (`AGENTS.md` section 3). */
type Seat = "Builder" | "solver" | "Examiner" | "Referee";

/** One test that proves what the wall keeps from a seat: its file, and its `describe` or `it` name. */
interface WallTest {
  readonly file: string;
  readonly name: string;
}

interface SeatEntry {
  /** The modules that compose what the seat reads: its prompt, its tools and its session. */
  readonly owners: readonly string[];
  readonly tests: readonly WallTest[];
}

/** What a seat is reached by: each changed file it imports, with the chain from an owner to it. */
interface Reach {
  readonly seat: Seat;
  readonly files: readonly { readonly file: string; readonly chain: readonly string[] }[];
  readonly tests: readonly WallTest[];
  /** Changed files that are this seat's own wall tests. */
  readonly testsChanged: readonly string[];
}

type ImportsOf = (file: string) => readonly string[];

/** "1 changed file reaches", "2 changed files reach". */
const reaching = (count: number) => `${plural(count, "changed file")} ${count === 1 ? "reaches" : "reach"}`;

/** Each seat's owners and wall tests, read from the tree at 060cddcf6 (30 October). */
export const SEATS = {
  Builder: {
    owners: [
      "src/builder/prompt.ts",
      "src/builder/tools.ts",
      "src/builder/session.ts",
      "tools/d2/campaign-actions.ts",
      "tools/d2/harness-builder.ts",
    ],
    tests: [
      { file: "test/builder.test.ts", name: "what crosses to the Builder" },
      {
        file: "test/builder-led.test.ts",
        name: "tells the Builder the same whichever held-out task was won",
      },
      {
        file: "test/reports.test.ts",
        name: "releases the same tasks whichever held-out task the new harness bettered by the objective",
      },
      {
        file: "test/reports.test.ts",
        name: "releases the same tasks whichever held-out task the new harness won where the reference answered neither",
      },
      {
        file: "test/decide.test.ts",
        name: "practice: the allowance and released tasks stay the same whichever objective task the new harness won",
      },
      {
        file: "test/handover.test.ts",
        name: "tells each comparison as its tally and its reading, with no task and no other count",
      },
    ],
  },
  solver: {
    owners: ["src/solver/prompt.ts", "src/solver/run.ts"],
    tests: [
      {
        file: "test/solver-prompt.test.ts",
        name: "is the task's public part, as the first message and as files in the home with the answer's format",
      },
      {
        file: "test/solve-sandbox.test.ts",
        name: "denies the repository and whole operator home, reopening only explicit runtimes",
      },
    ],
  },
  Examiner: {
    owners: ["src/examiner/session.ts", "src/examiner/draft.ts"],
    tests: [
      {
        file: "test/examiner-record.test.ts",
        name: "opens a session with the lines and then the measurement, naming no harness, no answer and no verdict of the author's work",
      },
      {
        file: "test/examiner-record.test.ts",
        name: "measures the reference across the exam in the last comparison it stood in, never one between two other harnesses",
      },
      {
        file: "test/examiner-record.test.ts",
        name: "after a promotion, tells nothing that the replaced reference's task admissions read",
      },
      {
        file: "test/examiner.test.ts",
        name: "has a shell in a walled home of its own, closed to the repository, and is told how the exam is entered",
      },
    ],
  },
  Referee: {
    owners: ["src/referee/referee.ts"],
    tests: [
      {
        file: "test/review.test.ts",
        name: "the Referee ends a reading at its wall, and says so in the finding",
      },
    ],
  },
} satisfies Record<Seat, SeatEntry>;

/** The repository files each file imports, read as the CI gate's `--static` pass reads them. */
export function importsIn(root: string): ImportsOf {
  return (file) => importsOf(root, file);
}

/** Every file the owners reach at any depth, with the shortest chain of imports from an owner to it,
 *  the owner first and the file last. */
function reachOf(owners: readonly string[], graph: ImportsOf): Map<string, readonly string[]> {
  const chains = new Map<string, readonly string[]>(owners.map((owner) => [owner, [owner]]));
  let layer = [...owners];
  while (layer.length > 0) {
    const next: string[] = [];
    for (const file of layer) {
      const chain = chains.get(file) ?? [file];
      for (const child of graph(file).filter((each) => !chains.has(each))) {
        chains.set(child, [...chain, child]);
        next.push(child);
      }
    }
    layer = next;
  }
  return chains;
}

/** For each seat, the changed files it reaches and the changed files that are its own wall tests. */
export function seatsOf(changed: readonly string[], graph: ImportsOf): Reach[] {
  return Object.entries(SEATS).map(([seat, entry]): Reach => {
    const chains = reachOf(entry.owners, graph);
    const testFiles = new Set(entry.tests.map(({ file }) => file));
    return {
      // SAFETY: `Object.entries` over `SEATS`, whose keys are exactly the members of `Seat`.
      seat: seat as Seat,
      files: changed.flatMap((file) => {
        const chain = chains.get(file);
        return chain === undefined ? [] : [{ file, chain }];
      }),
      tests: entry.tests,
      testsChanged: changed.filter((file) => testFiles.has(file)),
    };
  });
}

/** The owners and wall tests the table names that the tree at `root` no longer holds. */
export function absentFrom(root: string): string[] {
  return Object.values(SEATS).flatMap((entry): string[] => [
    ...entry.owners.filter((owner) => !existsSync(join(root, owner))),
    ...entry.tests.flatMap(({ file, name }) => {
      if (!existsSync(join(root, file))) return [file];
      return readFileSync(join(root, file), "utf8").includes(`"${name}"`) ? [] : [`${file}: "${name}"`];
    }),
  ]);
}

/** What is said of `reaches` over `changed`: a block a seat reached, the files no seat reaches, and
 *  the test line. */
export function seatLines(changed: readonly string[], reaches: readonly Reach[]): string[] {
  const touched = reaches.filter((reach) => reach.files.length > 0 || reach.testsChanged.length > 0);
  const reached = new Set(touched.flatMap((reach) => reach.files.map(({ file }) => file)));
  const blocks = reaches.flatMap((reach) => {
    if (!touched.includes(reach)) return [`${reach.seat}: no changed file reaches what it reads`];
    return [
      `${reach.seat}: ${reaching(reach.files.length)} what it reads`,
      ...reach.files.map(({ file, chain }) =>
        chain.length === 1
          ? `  ${file}  (an owner)`
          : `  ${file}  ${plural(chain.length - 1, "import")} from ${chain.join(" > ")}`,
      ),
      ...reach.testsChanged.map((file) => `  ${file}  (its wall test changed)`),
      ...reach.tests.map(({ file, name }) => `  wall test: ${file} "${name}"`),
    ];
  });
  const rest = changed.filter((file) => !reached.has(file));
  const folders = [
    ...Map.groupBy(rest, (file) => (file.includes("/") ? file.slice(0, file.indexOf("/")) : ".")),
  ]
    .map(([folder, files]) => `${folder} ${String(files.length)}`)
    .join(", ");
  const files = [...new Set(touched.flatMap((reach) => reach.tests.map(({ file }) => file)))];
  return [
    ...blocks,
    `${reaching(rest.length)} no seat${rest.length === 0 ? "" : `, by folder: ${folders}`}`,
    ...(files.length === 0
      ? ["run: no wall test is owed"]
      : [
          "Rule 3: say in the pull request how the change keeps these messages byte-identical.",
          `run: bun run test -- ${files.join(" ")}`,
        ]),
  ];
}

/** The files the working tree changed since `base`, untracked ones included. */
function changedSince(root: string, base: string): string[] {
  return [
    ...new Set([
      ...lines(gitText(root, "diff", "--name-only", base)),
      ...lines(gitText(root, "ls-files", "--others", "--exclude-standard")),
    ]),
  ].toSorted();
}

/** The merge base of HEAD with its upstream, else with `origin/main`. */
function defaultBase(root: string): string {
  const upstream = gitMaybe(root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
  const base = gitMaybe(root, "merge-base", "HEAD", upstream ?? "origin/main");
  if (base === null) throw new CommandFailure("found no merge base with its upstream: pass --base");
  return base;
}

if (import.meta.main) {
  await runCommand(
    {
      name: "seat-view",
      usage: "seat-view.ts [--base <rev>] [--file <path>]...",
      options: { base: "text", file: "list" },
    },
    (args: CommandArgs) => {
      const root = gitText(runtimeProcess.cwd(), "rev-parse", "--show-toplevel");
      const absent = absentFrom(root);
      if (absent.length > 0) {
        throw new CommandFailure(
          `the seats' table names what the tree no longer holds: ${absent.join("; ")}`,
        );
      }
      const named = args.list("file");
      const base = named.length > 0 ? null : (args.value("base") ?? defaultBase(root));
      const changed = base === null ? [...named] : changedSince(root, base);
      console.log(
        base === null
          ? "files named"
          : `against ${base.slice(0, 9)}: ${String(changed.length)} changed files`,
      );
      console.log(seatLines(changed, seatsOf(changed, importsIn(root))).join("\n"));
    },
  );
}
