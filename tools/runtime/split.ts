/**
 * Divides a stack at a pull request and, once it has merged, moves what stands above onto the
 * trunk, so a stack can land in parts. `land --merge` leaves those above holding the old trunk, and
 * a rebase can need commits redone by hand and loses their passes. So each commit above the merged
 * head is copied with only its parents changed (same tree, author, dates and message, written as
 * objects, touching no worktree), keeping the trees `contentKey` (`tools/runtime/gate.ts`)
 * remembers a pass by. A trunk whose tree moved past the merged head is refused. Without `--yes`
 * nothing moves; on a pull request still open the copy runs against a throwaway merge commit.
 * Members are read from the chain of bases, so a second run finishes what a first could not.
 *
 *   bun run split -- <pull request> [--yes]
 */
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { errorMessage } from "../../src/meta/runtime-values.ts";
import { runSync, runTextSyncOrThrow } from "../../src/meta/subprocess.ts";
import { argsOr, git, gitSays, lines, short } from "./gate.ts";
import {
  api,
  beneath,
  chainAbove,
  ghOrThrow,
  openPulls,
  type Pull,
  STACK_MEMBERS,
  stackHolding,
  trunkOf,
} from "./pulls.ts";
import { leasedPush } from "./restack.ts";

const USAGE = "usage: bun run split -- <pull request> [--yes]";

interface Cut {
  readonly state: string;
  readonly headRefName: string;
  readonly headRefOid: string;
}

/** Latin-1 reads each byte as one character and writes it back, so a name or message in another
 *  encoding survives, where UTF-8 text would replace what it cannot read. */
function copies(root: string, commits: readonly string[], from: string, onto: string): Map<string, string> {
  const copied = new Map([[from, onto]]);
  for (const commit of commits) {
    const { stdout } = runSync(["git", "cat-file", "commit", commit], { cwd: root });
    const raw = Buffer.from(stdout).toString("latin1");
    const end = raw.indexOf("\n\n");
    const parents = raw
      .slice(0, end)
      .replaceAll(/^parent (\S+)$/gmu, (_, parent: string) => `parent ${copied.get(parent) ?? parent}`);
    const made = runTextSyncOrThrow(["git", "hash-object", "-t", "commit", "-w", "--stdin"], {
      cwd: root,
      input: Buffer.from(parents + raw.slice(end), "latin1"),
    });
    copied.set(commit, made.trim());
  }
  return copied;
}

/** Makes `members` one native stack on `base`, bottom first, dissolving the native stack that holds
 *  the bottom first; a lone pull request needs none. Members come from the chain of bases, which no
 *  step here moves, so a run cut short is finished by the next. */
function relink(root: string, members: readonly Pull[], base: string): void {
  const [bottom] = members;
  if (bottom === undefined) return;
  const query = api(`stacks?pull_request=${String(bottom.number)}`);
  const [stack = ""] = ghOrThrow(root, ["api", query, "--jq", STACK_MEMBERS]).split(" ");
  if (stack !== "") ghOrThrow(root, ["stack", "unstack", stack]);
  if (members.length < 2) return;
  const numbers = members.map((pull) => String(pull.number));
  ghOrThrow(root, ["stack", "link", "--base", base, ...numbers]);
  console.log(`Linked ${numbers.map((number) => `#${number}`).join(" ")} on ${base}.`);
}

function divide(root: string, number: number): void {
  const open = openPulls(root);
  const cut = open.find((pull) => pull.number === number);
  const above = cut === undefined ? [] : chainAbove(open, cut);
  if (cut === undefined || above.length === 0) {
    throw new Error(`no open pull request is based on #${String(number)}'s head.`);
  }
  relink(root, [...beneath(open, cut), cut], trunkOf(root));
  relink(root, above, cut.headRefName);
}

/** Prints the copy, and with `yes` pushes it; a refused push throws Git's own text, so the operator
 *  sees which lease failed. */
function split(root: string, number: number, yes: boolean): void {
  const {
    state,
    headRefName,
    headRefOid: head,
  } = parseJsonAs<Cut>(
    ghOrThrow(root, ["pr", "view", String(number), "--json", "state,headRefName,headRefOid"]),
  );
  if (yes && state === "OPEN") {
    divide(root, number);
    return;
  }
  const merged = state === "MERGED";
  if (!merged && yes) throw new Error(`#${String(number)} is ${state}: nothing moves.`);
  const trunk = trunkOf(root);
  const open = openPulls(root).filter((pull) => pull.number !== number);
  git(root, ["fetch", "-q", "origin", trunk, head, ...open.map((pull) => pull.headRefOid)]);
  const holding = open.filter((pull) =>
    gitSays(root, ["merge-base", "--is-ancestor", head, pull.headRefOid]),
  );
  if (holding.length === 0) throw new Error(`no open pull request stands on #${String(number)}.`);
  const trunkHead = git(root, ["rev-parse", `origin/${trunk}`]);
  const onto = merged
    ? trunkHead
    : git(root, ["commit-tree", `${head}^{tree}`, "-p", trunkHead, "-p", head, "-m", "the merge to come"]);
  if (!gitSays(root, ["diff", "--quiet", onto, head])) {
    throw new Error(
      `${trunk} at ${short(onto)} holds another tree than #${String(number)}'s head, so a copy would keep no pass. ` +
        `Replay these by hand (stack-pr, section 8).`,
    );
  }
  const range = [...holding.map((pull) => pull.headRefOid), "--not", head, onto];
  const joined = lines(git(root, ["rev-list", "--merges", ...range]));
  if (joined[0] !== undefined) throw new Error(`${short(joined[0])} is a merge; replay these by hand.`);
  const commits = lines(git(root, ["rev-list", "--reverse", "--topo-order", ...range]));
  const copied = copies(root, commits, head, onto);
  const moved = holding.map((pull) => ({ pull, to: copied.get(pull.headRefOid) ?? pull.headRefOid }));
  for (const { pull, to } of moved) {
    console.log(`#${String(pull.number)} ${pull.headRefName} ${short(pull.headRefOid)} -> ${short(to)}`);
  }
  console.log(`${String(commits.length)} commits copied onto ${short(onto)}, every tree as it was.`);
  if (!yes) {
    console.log("Nothing moved without --yes.");
    return;
  }
  git(root, leasedPush(moved, "no-verify"));
  console.log(`Pushed ${String(moved.length)} branches.`);
  const rebased = open.map((pull) =>
    holding.includes(pull) && pull.baseRefName === headRefName ? { ...pull, baseRefName: trunk } : pull,
  );
  for (const pull of rebased.filter((each, at) => each !== open[at])) {
    ghOrThrow(root, ["pr", "edit", String(pull.number), "--base", trunk]);
    console.log(`#${String(pull.number)} is based on ${trunk}.`);
  }
  relink(root, stackHolding(rebased, holding[0]?.number ?? number) ?? [], trunk);
  console.log("bun run land -- <top> --sanitize shows the passes again on the new heads.");
}

function main(argv: readonly string[]): number {
  const parsed = argsOr(argv, USAGE, { yes: { type: "boolean", default: false } });
  if (parsed === null) return 2;
  const { values, positionals } = parsed;
  const number = Number(positionals[0]);
  if (positionals.length !== 1 || !Number.isInteger(number) || number <= 0) {
    console.error(USAGE);
    return 2;
  }
  try {
    split(git(runtimeProcess.cwd(), ["rev-parse", "--show-toplevel"]), number, values.yes);
    return 0;
  } catch (error) {
    console.error(`split: ${errorMessage(error)}`);
    return 1;
  }
}

if (import.meta.main) runtimeProcess.exit(main(Bun.argv.slice(2)));
