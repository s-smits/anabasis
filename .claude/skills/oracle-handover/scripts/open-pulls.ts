#!/usr/bin/env bun
/**
 * Zip the open pull requests for an outside reader: each one's title, body and diff, and the code
 * one import from what they change.
 *
 *   bun .claude/skills/oracle-handover/scripts/open-pulls.ts <folder> [--diffs] [--max-mb 20]
 *
 * It writes `<folder>/pulls/`: a `README.md` that lists each chain of pull requests bottom first
 * (`chains`), and for each pull request a `.md` with what an Oracle document's `pr` part holds
 * (`pullTold`) and a `.diff` against the head beneath it, so that a stack's diffs read in order
 * amount to its top against the trunk. Beside them `code/<top>/` holds, as they stand at each
 * chain's top, the files the chain changed, the files one of those imports and the tests near them:
 * the gate's reading of one import (`importsOf`, `testsNear`, `tools/runtime/gate.ts`) over a scratch
 * checkout, as `ci-fixes` chooses its tests. A reviewer of a diff alone cannot see what a changed
 * line calls or which test holds it, and asks for both. `--diffs` leaves the code out.
 *
 * The folder is then closed as a bundle is (`zipped`, `bundle.ts`): scanned, zipped beside itself
 * and tested. Beside the zip, `<folder>.md` holds the same files as one text to paste (`pasted`):
 * the index, then each pull request under its title with its diff a heading a file, then each
 * chain's code a heading a file. A `REVIEW.md` and runs added afterwards close whole through `bundle.ts`. The
 * stack is GitHub's at this moment and other sessions move it, so make the zip after the last push
 * the question concerns.
 */
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { gitOutput, gitText } from "#src/meta/git.ts";
import { basename, extname, join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { onCheckout } from "#tools/runtime/ci-runs.ts";
import { DOCUMENTATION, importsOf, lines, short, testsNear, uiTestsNear } from "#tools/runtime/gate.ts";
import { beneath, chains, openPulls, type Pull, ranksOf } from "#tools/runtime/pulls.ts";
import { scanText } from "#tools/secrets/rules.ts";
import { madeLine, maxBytesOf, zipped } from "./bundle.ts";
import { pullTold, tokensOf, webOf } from "./document.ts";
import { fenced } from "./slice.ts";

interface Told {
  /** Where GitHub shows the repository. */
  readonly web: string;
  /** When GitHub was read. */
  readonly at: string;
  /** Pull request `number` in words, its title on the first line (`pullTold`). */
  readonly told: (number: string) => string;
  /** Whether the code beside the diffs is held too. */
  readonly code: boolean;
}

const nameOf = (pull: Pull): string => `${String(pull.number)}-${basename(pull.headRefName)}`;
const hash = (pull: Pull): string => `#${String(pull.number)}`;
const count = (n: number, noun: string): string => `${String(n)} ${noun}${n === 1 ? "" : "s"}`;

/** Copies under `held` in `into`, each at its own path, the files of `sha`'s tree among `changed`,
 *  the files one of those imports and the test files near the code among them (`code`, the gate's
 *  set, which leaves the documentation out), and returns their paths in `into` with a sentence on
 *  how many of each it holds. */
function codeBeside(
  repo: string,
  [into, held]: readonly [string, string],
  sha: string,
  { changed, code }: { readonly changed: ReadonlySet<string>; readonly code: ReadonlySet<string> },
): { said: string; written: string[] } {
  return onCheckout(repo, sha, (tree) => {
    // A changed path that is gone at this head, or is a link or a submodule there, has no text to hold.
    const there = [...changed].filter(
      (file) => existsSync(join(tree, file)) && lstatSync(join(tree, file)).isFile(),
    );
    const imported = new Set(
      there.flatMap((file) => importsOf(tree, file)).filter((file) => !changed.has(file)),
    );
    const tests = [...testsNear(tree, code), ...uiTestsNear(tree, code, "all")].filter(
      (file) => !changed.has(file) && !imported.has(file),
    );
    const files = [...there, ...imported, ...tests];
    for (const file of files) cpSync(join(tree, file), join(into, held, file));
    return {
      said: `the ${count(there.length, "file")} the chain changed that it still has, the ${count(imported.size, "other")} one of them imports, and the ${count(tests.length, "other test file")} near them`,
      written: files.map((file) => join(held, file)),
    };
  });
}

/** One chain's section of the index, after writing each of its pull requests' `.md` and `.diff`
 *  under `into`, and the code beside them where `how.code` asks, with each file's path in `into`
 *  in the order it is read. */
function chainTold(repo: string, into: string, open: readonly Pull[], line: readonly Pull[], how: Told) {
  const [bottom, top] = [line[0], line.at(-1)];
  if (bottom === undefined || top === undefined) return { told: [], written: [] };
  const changed = new Set<string>();
  const code = new Set<string>();
  const rows = line.map((pull) => {
    const text = how.told(String(pull.number));
    const range = `${beneath(open, pull).at(-1)?.headRefOid ?? `origin/${pull.baseRefName}`}...${pull.headRefOid}`;
    for (const file of lines(gitText(repo, "diff", "--name-only", range))) changed.add(file);
    for (const file of lines(gitText(repo, "diff", "--name-only", range, "--", ".", ...DOCUMENTATION))) {
      code.add(file);
    }
    writeFileSync(join(into, `${nameOf(pull)}.md`), `# Pull request ${String(pull.number)}: ${text}\n`);
    writeFileSync(join(into, `${nameOf(pull)}.diff`), gitOutput(repo, "diff", range));
    const label = [
      ...ranksOf(pull).map((rank) => rank.slice("importance:".length)),
      ...(pull.isDraft ? ["draft"] : []),
    ];
    const title = (text.split("\n")[0] ?? "").replaceAll("|", String.raw`\|`);
    return `| [${hash(pull)}](${how.web}/pull/${String(pull.number)}) | ${title} | \`${short(pull.headRefOid)}\` | ${label.join(", ")} | \`${nameOf(pull)}.md\`, \`.diff\` |`;
  });
  const held = `code/${String(top.number)}`;
  const beside = how.code ? codeBeside(repo, [into, held], top.headRefOid, { changed, code }) : null;
  const told = [
    `## On \`${bottom.baseRefName}\`: ${line.length === 1 ? hash(top) : `${hash(bottom)} to ${hash(top)}`}`,
    ["| pull request | title | head | labels | files |", "| --- | --- | --- | --- | --- |", ...rows].join(
      "\n",
    ),
    ...(beside === null
      ? []
      : [
          `\`${held}/\` holds the code beside these diffs as it stands at ${hash(top)}'s head, each file under its own path: ${beside.said}. A test is near by the gate's rule: one import from a changed file beyond the documentation, three for a UI test, or its text names such a file that no test imports. A file that imports a changed one and is no test is not held.`,
        ]),
  ];
  const own = line.flatMap((pull) => [`${nameOf(pull)}.md`, `${nameOf(pull)}.diff`]);
  return { told, written: [...own, ...(beside?.written ?? [])] };
}

/** Markdown `text` with each heading outside a fenced block one level lower. */
const lowered = (text: string): string => {
  let fence = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*(?:```|~~~)/u.test(line)) fence = !fence;
      return !fence && /^#{1,5} /u.test(line) ? `#${line}` : line;
    })
    .join("\n");
};

/** The folder `into` that `pullsInto` wrote as one markdown text to paste, each file of `written` in
 *  its order under a heading of its own: the index, then each pull request (its text, its headings
 *  one level lower, then its diff), then each chain's code, one file a heading. */
export function pasted(into: string, written: readonly string[]): string {
  const parts = written.map((file, index) => {
    const text = readFileSync(join(into, file), "utf8").trim();
    const name = file.replace(/\.(?:md|diff)$/u, "");
    const [, held = "", path = ""] = /^(code\/\d+)\/(.*)$/u.exec(file) ?? [];
    if (held !== "") {
      const first = !(written[index - 1] ?? "").startsWith(`${held}/`);
      const opening = first
        ? `# The code at #${held.slice("code/".length)}'s head\n\nEach file as it stands there, under its path in the repository.\n\n`
        : "";
      const lang = extname(path) === ".md" ? "markdown" : extname(path).slice(1);
      return `${opening}## \`${path}\`\n\n${fenced(text, lang)}`;
    }
    if (file === "README.md") return text;
    if (file.endsWith(".md")) return lowered(text);
    // One heading a changed file, named by its path after the change, before that file's part of the diff.
    const files = text.split(/^(?=diff --git )/mu).map((part) => {
      const after = /^diff --git a\/.* b\/(.*)$/mu.exec(part)?.[1] ?? "";
      return `#### \`${after}\`\n\n${fenced(part, "diff")}`;
    });
    return [`### The diff of pull request ${name.split("-")[0] ?? name}`, ...files].join("\n\n");
  });
  return `${parts.join("\n\n")}\n`;
}

/** Writes the open pull requests `open` of checkout `repo` under the new folder `into`, and returns
 *  each file's path in it in the order it is read, `README.md` first. Refuses where none is open. */
export function pullsInto(repo: string, into: string, open: readonly Pull[], how: Told): string[] {
  if (open.length === 0) throw new CommandFailure("no pull request is open");
  mkdirSync(into, { recursive: true });
  const { stacks, sides } = chains(open);
  const each = [...stacks, ...sides.map((side) => [side])].map((line) =>
    chainTold(repo, into, open, line, how),
  );
  const readme = [
    `# The open pull requests of ${how.web}`,
    `GitHub listed ${count(open.length, "open pull request")} at ${how.at}. Each table is one chain of them, bottom first. A pull request's \`.md\` holds its title, head, base, state, body and changed files as GitHub shows them, and its \`.diff\` is read against the head beneath it, or against its base branch for the bottom one, so a chain's diffs read in order amount to its top against that base. A chain whose base is another pull request's branch forks off the middle of a stack.`,
    ...each.flatMap((chain) => chain.told),
  ];
  writeFileSync(join(into, "README.md"), `${readme.join("\n\n")}\n`);
  return ["README.md", ...each.flatMap((chain) => chain.written)];
}

if (import.meta.main) {
  await runCommand(
    {
      name: "open-pulls",
      usage: "open-pulls.ts <folder> [--diffs] [--max-mb 20]",
      options: { diffs: "flag", "max-mb": "int" },
      positionals: 1,
    },
    (args: CommandArgs) => {
      const repo = gitText(runtimeProcess.cwd(), "rev-parse", "--show-toplevel");
      const dir = resolve(args.positionals[0] ?? "");
      const into = join(dir, "pulls");
      if (existsSync(into)) throw new CommandFailure(`${into} is there already: name another folder`);
      const open = openPulls(repo);
      // After the listing, so that every head it names is here to be read.
      gitText(repo, "fetch", "-q", "origin");
      const written = pullsInto(repo, into, open, {
        web: webOf(repo),
        at: new Date().toISOString(),
        told: (number) => pullTold(repo, number),
        code: !args.flag("diffs"),
      });
      console.log(`${into}: ${count(open.length, "open pull request")}`);
      console.log(madeLine(zipped(dir, maxBytesOf(args))));
      // Beside the zip, not in it, so the zip does not hold everything twice; scanned as the zip was.
      const text = pasted(into, written);
      const hits = scanText(`${dir}.md`, text).map((hit) => `  line ${String(hit.line)}: ${hit.what}`);
      if (hits.length > 0) {
        throw new CommandFailure(`a credential-shaped line, so no .md:\n${hits.join("\n")}`);
      }
      writeFileSync(`${dir}.md`, text);
      console.log(`${dir}.md  about ${tokensOf(text).toLocaleString("en-GB")} o200k tokens`);
    },
  );
}
