/**
 * Divides a stack at a pull request, and moves what stands above it onto the trunk once it has merged,
 * so that a stack can land in parts.
 *
 *   bun run split -- <pull request> [--yes]
 *
 * `bun run land -- <pull request> --merge` merges a stack up to the one named, through GitHub's
 * partial stack merge, and leaves those above it open. It merges with a merge commit, so none of
 * them holds the trunk's new head and `land` refuses them until they are replayed. On 22 October
 * #343 merged beside a chain that then needed 26 commits replayed, three by hand, and a rebase moves
 * branches that other worktrees have checked out. On 5 November the operator asked to land #616 to
 * #631 ahead of the 12 pull requests above them with the passes those had earned intact, and #643
 * and #644 were divided by hand, since a landing's members must be its native stack's.
 *
 * So this copies each commit above the merged head with only its parents changed: the same tree,
 * author, dates and message, written as objects, touching no worktree and with no conflict possible.
 * The merge commit's tree is the merged head's, which `land` checks as it merges, so every copy keeps
 * the tree and the parent's tree that `contentKey` (`tools/runtime/gate.ts`) remembers a pass by, and
 * `land --sanitize` finds them all where it runs from a tree with the same CI gate. A trunk whose tree
 * has moved past the merged head would change every tree, so it is refused rather than proved anew
 * without anyone asking.
 *
 * What stands on the pull request is every other open head that holds its head, read from Git alone:
 * `land` moves the bottom's base to the trunk as it merges, so a chain of bases no longer reaches the
 * merged branch, and a head that does not hold it has nothing to copy, whatever its base says.
 *
 * Without `--yes` nothing moves. On a pull request still open, the same copy runs against a merge
 * commit made for the purpose, which no ref holds, so a split can be read before its merge.
 *
 * With `--yes` on a pull request still open, the native stack it is in becomes two: up to it on the
 * trunk, and above it on its branch, each head and base as it was. No branch moves, so every pass stands.
 *
 * With `--yes` after the merge, every branch moves in one atomic push under a lease on the head GitHub
 * listed, a pull request still based on the merged branch moves to the trunk, and the native stack above
 * is linked again on the trunk. A commit already on the trunk's head copies to itself, so a second run
 * finishes what the first could not. The push skips the pre-push hook, since every tree was checked
 * before and a copy changes none (operator, 5 November); `land --sanitize` shows the passes on the new heads.
 */
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { parseArgs, runtimeProcess } from "../../src/meta/process.ts";
import { errorMessage } from "../../src/meta/runtime-values.ts";
import { runSync, runTextSyncOrThrow } from "../../src/meta/subprocess.ts";
import { git, gitSays, lines, short } from "./gate.ts";
import { api, ghOrThrow, openPulls, STACK_MEMBERS, trunkOf } from "./pulls.ts";

/** The pull request a stack is split above, as `gh pr view --json` gives it. */
interface Cut {
  readonly state: string;
  readonly headRefName: string;
  readonly headRefOid: string;
}

/** A copy of each commit with its parents mapped, `from` becoming `onto`: the same bytes otherwise.
 *  Latin-1 reads each byte as one character and writes it back, so a name or a message in another
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

/** The open native stack `number` is in, and its open members bottom first, or null. */
function nativeStack(root: string, number: number) {
  const read = ghOrThrow(root, ["api", api(`stacks?pull_request=${String(number)}`), "--jq", STACK_MEMBERS]);
  if (read === "") return null;
  const [stack = "", members = ""] = read.split(" ");
  return { stack, members: members.split(",") };
}

/** Makes `members` one native stack on `base`, bottom first; a lone pull request needs none. */
function link(root: string, members: readonly string[], base: string): void {
  if (members.length < 2) return;
  ghOrThrow(root, ["stack", "link", "--base", base, ...members]);
  console.log(`Linked ${members.map((member) => `#${member}`).join(" ")} on ${base}.`);
}

/** The native stack `number` is in as two, with it on top of the lower. No branch or base moves. */
function divide(root: string, number: number, branch: string): void {
  const native = nativeStack(root, number);
  const at = native?.members.indexOf(String(number)) ?? -1;
  const above = native?.members.slice(at + 1) ?? [];
  if (native === null || at < 0 || above.length === 0) {
    throw new Error(`no native stack holds pull requests above #${String(number)}.`);
  }
  ghOrThrow(root, ["stack", "unstack", native.stack]);
  link(root, native.members.slice(0, at + 1), trunkOf(root));
  link(root, above, branch);
}

/** Prints the copy, and with `yes` pushes it. A refused push throws Git's own text, the rejection of
 *  each branch, which `main` prints: the operator has to see which lease failed. */
function split(root: string, number: number, yes: boolean): void {
  const {
    state,
    headRefName,
    headRefOid: head,
  } = parseJsonAs<Cut>(
    ghOrThrow(root, ["pr", "view", String(number), "--json", "state,headRefName,headRefOid"]),
  );
  if (yes && state === "OPEN") {
    divide(root, number, headRefName);
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
  const native = nativeStack(root, holding[0]?.number ?? number);
  git(root, [
    "push",
    "--no-verify",
    "--atomic",
    ...moved.map(({ pull }) => `--force-with-lease=${pull.headRefName}:${pull.headRefOid}`),
    "origin",
    ...moved.map(({ pull, to }) => `${to}:refs/heads/${pull.headRefName}`),
  ]);
  console.log(`Pushed ${String(moved.length)} branches.`);
  for (const { pull } of moved.filter((each) => each.pull.baseRefName === headRefName)) {
    ghOrThrow(root, ["pr", "edit", String(pull.number), "--base", trunk]);
    console.log(`#${String(pull.number)} is based on ${trunk}.`);
  }
  if (native !== null) {
    ghOrThrow(root, ["stack", "unstack", native.stack]);
    link(root, native.members, trunk);
  }
  console.log("bun run land -- <top> --sanitize shows the passes again on the new heads.");
}

function main(argv: readonly string[]): number {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { yes: { type: "boolean", default: false } },
    allowPositionals: true,
  });
  const number = Number(positionals[0]);
  if (positionals.length !== 1 || !Number.isInteger(number) || number <= 0) {
    console.error("usage: bun run split -- <pull request> [--yes]");
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
