#!/usr/bin/env bun
/**
 * Traces which seats import changed files and names their wall tests: `seat-view.ts [--base <rev>]
 * [--file <path>]...`. Rule 3 keeps Builder and solver messages byte-identical when protected exam
 * facts change; this follows the gate's `importsOf` from each seat's owners and prints the shortest
 * import chain, the relevant wall tests and their test command. By default it compares the working
 * tree, untracked files included, with the merge base of HEAD's upstream, else `origin/main`; the
 * import graph always comes from the working tree.
 */
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { gitMaybe, gitText } from "#src/meta/git.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { importsOf, lines } from "#tools/runtime/gate.ts";

type Seat = "Builder" | "solver" | "Examiner" | "Referee";

/** One test that proves what the wall keeps from a seat: its file, and its `describe` or `it` name.
 */
interface WallTest {
  readonly file: string;
  readonly name: string;
}

interface SeatEntry {
  readonly owners: readonly string[];
  readonly tests: readonly WallTest[];
}

interface Reach {
  readonly seat: Seat;
  readonly files: readonly { readonly file: string; readonly chain: readonly string[] }[];
  readonly tests: readonly WallTest[];
  readonly testsChanged: readonly string[];
}

type ImportsOf = (file: string) => readonly string[];

const reaching = (count: number) => `${plural(count, "changed file")} ${count === 1 ? "reaches" : "reach"}`;

export const SEATS = {
  Builder: {
    owners: [
      "src/builder/prompt.ts",
      "src/builder/tools.ts",
      "src/builder/session.ts",
      "tools/campaign/campaign-actions.ts",
      "tools/campaign/campaign-status.ts",
      "tools/campaign/campaign-terms.ts",
      "tools/campaign/harness-builder.ts",
    ],
    tests: [
      { file: "test/builder.test.ts", name: "what crosses to the Builder" },
      {
        file: "test/builder-led.test.ts",
        name: "tells the Builder the same whichever held-out task was won",
      },
      { file: "test/wall-practice.test.ts", name: "what practice tells the Builder" },
      {
        file: "test/wall-practice.test.ts",
        name: "is one value whichever task the other harness bettered by the objective, every answer valid",
      },
      {
        file: "test/handover.test.ts",
        name: "tells each comparison as its tally and its reading, with no task",
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
        name: "opens a session with the last comparison, then the tasks, then the refusals, naming no harness, no answer and no verdict of the author's work",
      },
      {
        file: "test/examiner-record.test.ts",
        name: "tells its tally from the reference's side, every, some and none of its solves valid, the tasks set aside and its own solves set against each other",
      },
      {
        file: "test/examiner-record.test.ts",
        name: "says the reference was promoted and how many tasks were held before then, and at an opening alone the drafts the gate has refused since",
      },
      {
        file: "test/examiner.test.ts",
        name: "has a shell in a walled home of its own, closed to the repository, and is told how the exam is entered",
      },
    ],
  },
  Referee: {
    owners: ["src/audit/auditor.ts", "src/audit/draft-audit.ts"],
    tests: [
      {
        file: "test/review.test.ts",
        name: "handles wall timeouts, provider errors, and kill cancellations cleanly",
      },
    ],
  },
} satisfies Record<Seat, SeatEntry>;

function importsIn(root: string): ImportsOf {
  return (file) => importsOf(root, file);
}

/** Every file the owners reach, with the shortest chain of imports from an owner to it, the owner
 *  first and the file last. */
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

export function absentFrom(root: string): string[] {
  return Object.values(SEATS).flatMap((entry): string[] => [
    ...entry.owners.filter((owner) => !existsSync(join(root, owner))),
    ...entry.tests.flatMap(({ file, name }) => {
      if (!existsSync(join(root, file))) return [file];
      return readFileSync(join(root, file), "utf8").includes(`"${name}"`) ? [] : [`${file}: "${name}"`];
    }),
  ]);
}

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

function changedSince(root: string, base: string): string[] {
  return [
    ...new Set([
      ...lines(gitText(root, "diff", "--name-only", base)),
      ...lines(gitText(root, "ls-files", "--others", "--exclude-standard")),
    ]),
  ].toSorted();
}

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
