/**
 * Lands a pull request, with every open one beneath it, on main, after proving each commit the landing
 * would publish where it sits; passes are remembered by tree. Without a flag nothing is written to
 * GitHub. A moved parent is replayed first (`restack`) and a moved head stops the proofs.
 *
 *   bun run land -- [<pull request> | latest] [--auto] [--watch] [--whole] [--sanitize [--from <pull request>] | --merge [--alone] [--tag vX.Y.Z]] [--jobs N]
 *
 * With no pull request named it lands the stack holding the oldest open one (`firstStack`); `latest`
 * follows the highest-numbered top. `--auto` lands the new top where one was stacked meanwhile
 * (`topAbove`), `--watch` lands again each time the stack moves until the pull request closes, and
 * `--whole` runs the whole CI gate on the top's head. `--sanitize` posts each commit's verdict and
 * `mergeable`; `--from` proves only from that pull request up and posts no `mergeable`, since no head
 * has every commit proved. `--merge` refuses a draft and also wants `ci.yml` passed on the top's head,
 * since only it proves the Linux isolation on a clean runner; it then posts `ana/stack-gate` and
 * merges the native stack, and `--tag` cuts that release at the merge commit. Proofs spread over the
 * check hosts, up to `--jobs N` at once.
 *
 * Ruleset 25824510 on main, with no bypass actors, requires `ana/stack-gate`, which only `--merge`
 * posts (`STACK_CONTEXT`). The one gap: a token with admin rights can post that status by hand.
 */
import { runtimeProcess } from "../../src/meta/process.ts";
import { decodeOutput, runSync } from "../../src/meta/subprocess.ts";
import { plural, textOr } from "../../src/meta/text.ts";
import { CI_WORKFLOW, ciRun, failedFiles, FIXES, fixesFor } from "./ci-runs.ts";
import { doubledLines } from "./doubled.ts";
import {
  chainAbove,
  api,
  beneath,
  firstStack,
  form,
  latestTop,
  gh,
  ghOrThrow,
  MERGEABLE_CONTEXT,
  openPulls,
  ranksOf,
  postStatus,
  type Pull,
  statusBoard,
  type Board,
  STACK_MEMBERS,
  stackStart,
  type StatusState,
  trunkOf,
} from "./pulls.ts";
import {
  addedLine,
  argsOr,
  changesSource,
  failedLine,
  git,
  gitSays,
  type Proof,
  proveCommits,
  short,
} from "./gate.ts";
import type { Place } from "../runs/host-config.ts";
import { claimOf, follow, holdAlone, placesOf, sayingPulls, watching, whereToProve } from "./landing.ts";
import { movedFrom, movesOf, pushMoves, Unreplayable } from "./restack.ts";

interface Landing {
  readonly trunk: string;
  readonly trunkSha: string;
  readonly pulls: readonly Pull[];
  readonly top: Pull;
  /** The bottom of each other open chain on the trunk with another pull request above it, which
   *  `--merge` refuses without `--alone`. */
  readonly beside: readonly Pull[];
  readonly open: readonly Pull[];
}

interface Mode {
  readonly kind: "proving" | "sanitizing" | "merging";
  readonly auto: boolean;
  readonly alone: boolean;
  readonly topPass: "whole" | "static";
  readonly places: readonly Place[];
  readonly tag: string | null;
  readonly from: number | null;
}

const COMMIT_CONTEXT = "ana/commit";
const STACK_CONTEXT = "ana/stack-gate";
const CI_CONTEXT = "ci.yml";
const CI_POLL_MS = Number(runtimeProcess.env.ANA_CI_POLL_MS) || 20_000;
/** `ci.yml`'s jobs stop at 45 minutes; the rest is the macOS runner's queue. */
const CI_WAIT_MS = 75 * 60_000;
const CI_FAILED = String.raw`.jobs[] | select(.conclusion == "failure") | "\(.name): \([.steps[] | select(.conclusion == "failure") | .name] | join(", "))"`;
const CI_UNTAKEN = String.raw`[.jobs[] | select(.conclusion != "success")] | select(length > 0 and all(.steps | length == 0)) | "no runner took " + (map(.name) | join(", "))`;
const CI_TAIL = 40;
const MOVES = 3;
const STACK_POLL_MS = Number(runtimeProcess.env.ANA_CI_POLL_MS) || 2000;
const STACK_WAIT_MS = 10 * 60_000;
export const CATEGORIES = new Set([
  "exam",
  "verdicts",
  "supply",
  "harness",
  "comparison",
  "climb",
  "solve",
  "economy",
  "runs",
  "log",
  "investigation",
  "landing",
  "quality",
  "docs",
]);
const USAGE =
  "usage: bun run land -- [<pull request> | latest] [--auto] [--watch] [--whole] [--sanitize [--from <pull request>] | --merge [--alone] [--tag vX.Y.Z]] [--jobs N]";
const TAG = /^v\d+\.\d+\.\d+$/u;

class Refusal extends Error {}
/** Passes are remembered by tree, so landing again costs only the moved commits. */
class Moved extends Refusal {}

const say = (line: string): void => console.log(`land: ${line}`);
const numbers = (pulls: readonly Pull[]): string => pulls.map((pull) => `#${String(pull.number)}`).join(", ");

function oldestStack(root: string): number {
  const line = firstStack(openPulls(root));
  if (line.length < 2) throw new Refusal("no stacked pull request is open. Name one to land.");
  return line.at(-1)?.number ?? 0;
}

const topAbove = (open: readonly Pull[], from: Pull): Pull => chainAbove(open, from).at(-1) ?? from;

function readLanding(root: string, target: number, open: readonly Pull[]): Landing {
  const named = open.find((pull) => pull.number === target);
  if (named === undefined) throw new Refusal(`#${String(target)} is not an open pull request.`);
  const pulls = [...beneath(open, named), named];
  const bottom = pulls[0] ?? named;
  const trunk = trunkOf(root);
  if (bottom.baseRefName !== trunk) {
    throw new Refusal(
      `#${String(bottom.number)} (${bottom.headRefName}) is based on ${bottom.baseRefName}, which is neither ${trunk} ` +
        `nor an open pull request's head. Where what it stood on has landed, replay the stack onto it with ` +
        `\`bun .claude/skills/stack-pr/scripts/republish.ts --onto-main ${String(target)} --yes\`; otherwise base ` +
        `it on what it stacks on, and land again.`,
    );
  }
  const trunkSha = git(root, ["ls-remote", "origin", `refs/heads/${trunk}`]).split("\t")[0] ?? "";
  git(root, ["fetch", "-q", "origin", trunkSha, ...pulls.map((pull) => pull.headRefOid)]);
  const beside = open.filter(
    (pull) =>
      pull.baseRefName === trunk &&
      !pulls.includes(pull) &&
      open.some((above) => above.baseRefName === pull.headRefName),
  );
  return { trunk, trunkSha, pulls, top: named, beside, open };
}

function checkLabels(landing: Landing): void {
  const faults = landing.pulls.flatMap((pull) => {
    const ranks = ranksOf(pull);
    const said = [
      ...(ranks.length === 1 ? [] : [ranks.length === 0 ? "no importance label" : ranks.join(" and ")]),
      ...(pull.labels.some(({ name }) => CATEGORIES.has(name)) ? [] : ["no category label"]),
    ];
    return said.length === 0 ? [] : [`#${String(pull.number)} carries ${said.join(", and ")}`];
  });
  if (faults.length > 0) {
    throw new Refusal(
      `${faults.join("; ")}. Give each pull request exactly one of importance:I0 to importance:I3 and ` +
        `at least one of ${[...CATEGORIES].join(", ")} (gh pr edit <number> --add-label <label>), ` +
        `and land again.`,
    );
  }
}

function checkChain(root: string, landing: Landing): void {
  let below = { name: `${landing.trunk}'s head`, sha: landing.trunkSha };
  for (const pull of landing.pulls) {
    if (!gitSays(root, ["merge-base", "--is-ancestor", below.sha, pull.headRefOid])) {
      throw new Refusal(
        `#${String(pull.number)} (${pull.headRefName}) does not contain ${below.name} ${short(below.sha)}; ` +
          "--sanitize or --merge replays it.",
      );
    }
    below = { name: `#${String(pull.number)}'s head`, sha: pull.headRefOid };
  }
  const repeating = doubledLines(root, landing.open, (pull) => landing.pulls.includes(pull));
  if (repeating.length > 0) throw new Refusal(`${repeating.join(" ")} Land again.`);
}

function startCi(root: string, top: Pull): void {
  const head = `#${String(top.number)}'s head ${short(top.headRefOid)}`;
  const ci = ciRun(root, top.headRefOid);
  if (ci === undefined) {
    throw new Refusal(`GitHub did not list ${CI_WORKFLOW}'s runs on ${head}. Land again.`);
  }
  if (ci !== null) {
    const [status = "", conclusion, id = "", url, at] = ci;
    const untaken =
      conclusion === "failure" ? gh(root, ["run", "view", id, "--json", "jobs", "--jq", CI_UNTAKEN]).out : "";
    if (untaken !== "") {
      ghOrThrow(root, ["run", "rerun", id, "--failed"]);
      say(
        `${CI_WORKFLOW} run ${id} failed on ${head} where ${untaken}; its failed jobs run again: ${url ?? ""}`,
      );
      return;
    }
    say(
      `${CI_WORKFLOW} run ${id} of ${at ?? "an earlier landing"} is already on ${head}, ${textOr(conclusion, status)}; its verdict stands: ${url ?? ""}`,
    );
    return;
  }
  const workflow = runSync(["git", "show", `${top.headRefOid}:.github/workflows/${CI_WORKFLOW}`], {
    cwd: root,
  });
  if (!/^[^#\n]*\bworkflow_dispatch\b/mu.test(decodeOutput(workflow.stdout))) {
    throw new Refusal(
      `no ${CI_WORKFLOW} run exists on ${head}, and ${CI_WORKFLOW} there takes no workflow_dispatch to start one. ` +
        `Land again once a run exists.`,
    );
  }
  const fixes = /^\s+ui_tests:/mu.test(decodeOutput(workflow.stdout)) ? fixesFor(root, top, say) : null;
  const inputs = fixes === null ? [] : ["-f", `tests=${fixes.tests}`, "-f", `ui_tests=${fixes.uiTests}`];
  ghOrThrow(root, ["workflow", "run", CI_WORKFLOW, "--ref", top.headRefName, ...inputs]);
  const what =
    fixes === null ? CI_WORKFLOW : `${FIXES}, ${plural(fixes.count, "test file")} since ${fixes.since},`;
  say(`dispatched ${what} on ${head}; it runs while the commits are gated here.`);
}

async function awaitCi(root: string, top: Pull): Promise<void> {
  const deadline = Date.now() + CI_WAIT_MS;
  let ci = ciRun(root, top.headRefOid);
  const show = (state: StatusState, description: string): void => {
    postStatus(root, top.headRefOid, { context: CI_CONTEXT, state, description, link: ci?.[3] });
  };
  if (ci?.[0] !== "completed") show("pending", "waiting for the ci.yml run that bun run land started");
  while (ci?.[0] !== "completed" && Date.now() < deadline) {
    await Bun.sleep(CI_POLL_MS);
    ci = ciRun(root, top.headRefOid) ?? ci;
  }
  const [status, conclusion, id = "", url, , title = "ci"] = ci ?? [];
  const head = `#${String(top.number)}'s head ${short(top.headRefOid)}`;
  const name = title === FIXES ? `${CI_WORKFLOW}'s ${FIXES}` : CI_WORKFLOW;
  if (conclusion === "success") {
    show("success", `${name} run ${id} passed on this head`);
    say(`${name} passed on ${head}: ${url ?? ""}`);
    return;
  }
  show(
    status === "completed" ? "failure" : "pending",
    `${name} run ${id} ${textOr(conclusion, "has not finished")}`,
  );
  if (status !== "completed") {
    throw new Refusal(
      `${CI_WORKFLOW} on ${head} has not finished: ${url ?? "no run has started"}. Land again once it has.`,
    );
  }
  const steps = gh(root, ["run", "view", id, "--json", "jobs", "--jq", CI_FAILED]).out;
  const fetched = gh(root, ["run", "view", id, "--log-failed"]);
  const failed = fetched.ok ? fetched.out : `gh could not fetch the failed jobs' log: ${fetched.err}`;
  const logs = git(root, ["rev-parse", "--path-format=absolute", "--git-path", "ana-gate"]);
  const log = `${logs}/land-ci-${short(top.headRefOid)}.log`;
  await Bun.write(log, `${failed}\n`);
  if (steps !== "") console.error(steps);
  console.error(failed.split("\n").slice(-CI_TAIL).join("\n"));
  const files = failedFiles(failed);
  if (files.length > 0) console.error(`land: failed test files: ${files.join(" ")}`);
  throw new Refusal(
    `${CI_WORKFLOW} ended ${conclusion ?? ""} on ${head}: ${url ?? ""}. Its failed jobs' log: ${log}. Fix the ` +
      `commit it names, or run gh run rerun ${id} if the runner was at fault, and land again.`,
  );
}

function stackOf(root: string, pulls: readonly Pull[], unlinked: "link" | "say"): number | null {
  const chain = pulls.map((pull) => String(pull.number));
  const [bottom = ""] = chain;
  const top = chain.at(-1) ?? "";
  for (let linked = false; ; linked = true) {
    const read = gh(root, ["api", api(`stacks?pull_request=${bottom}`), "--jq", STACK_MEMBERS]);
    if (!read.ok) {
      throw new Refusal(`GitHub did not say which stack #${bottom} is in: ${read.err} Land again.`);
    }
    const [stack = "", listed = "", closed = ""] = read.out.split(" ");
    const members = listed === "" ? [] : listed.split(",");
    const linking = ["stack", "link", ...(closed === "" ? [] : closed.split(",")), ...chain];
    const link = `gh ${linking.join(" ")}`;
    const upTo = members.slice(0, members.indexOf(top) + 1);
    if (upTo.join(",") === chain.join(",")) return Number(stack);
    if (read.out === "" && chain.length === 1) return null;
    if (linked && read.out === "") throw new Refusal(`${link} left them in no stack. Land again.`);
    if (linked || !members.every((member, index) => member === chain[index])) {
      throw new Refusal(
        `GitHub's stack ${stack} holds #${members.join(", #")}, and the chain of bases up to #${top} ` +
          `holds ${numbers(pulls)}. A link never reorders a stack: run gh stack unstack ${stack}, then ${link}, ` +
          `and land again.`,
      );
    }
    if (unlinked === "say") {
      say(`${numbers(pulls)} are not one stack on GitHub; --sanitize or --merge runs ${link}.`);
      return null;
    }
    const made = gh(root, linking);
    if (!made.ok) throw new Refusal(`${link} was refused: ${made.err} Land again.`);
    say(`linked ${numbers(pulls)} into one stack on GitHub: ${link}.`);
  }
}

/** Where `bun run split` divided the chain, each native stack is linked as GitHub holds it, lowest
 *  first (`stackStart` of the chain, then beneath each stack found), and all are proved; an upper
 *  one is not merged, since GitHub would merge it onto the branch beneath instead of the trunk. */
function linkStacks(root: string, landing: Landing, mode: Mode): void {
  const { pulls, top } = landing;
  const starts: number[] = [];
  for (let end = pulls.length; end > 0; ) {
    end = stackStart(root, pulls.slice(0, end));
    starts.unshift(end);
  }
  const bottoms = starts.map((start) => `#${String(pulls[start]?.number)}`);
  if (starts.length > 1 && mode.kind === "merging") {
    throw new Refusal(
      `GitHub's stack holding #${String(top.number)} starts at ${bottoms.at(-1) ?? ""}: land the stacks beneath first.`,
    );
  }
  if (starts.length > 1) {
    say(`GitHub holds ${numbers(pulls)} as native stacks from ${bottoms.join(", ")}; proving them all.`);
  }
  for (const [index, start] of starts.entries()) {
    stackOf(root, pulls.slice(start, starts[index + 1]), mode.kind === "proving" ? "say" : "link");
  }
}

async function mergeStack(
  root: string,
  landing: Landing,
  stack: number | null,
): Promise<{ readonly ended: "merged" | "refused" | "unsure"; readonly sha: string }> {
  const { top } = landing;
  const path = api(`pulls/${String(top.number)}/merge-async`);
  const fields = String.raw`[.status, .details.uuid // "", .details.sha // "", .details.message // ""] | join("\t")`;
  const name = stack === null ? `#${String(top.number)}` : `stack ${String(stack)}`;
  const merging = form({ merge_method: "merge", merge_action: "direct_merge", sha: top.headRefOid });
  const asked = gh(root, ["api", "-X", "PUT", path, ...merging, "--jq", fields]);
  if (!asked.ok) {
    console.error(`land: GitHub did not merge ${name}: ${asked.err}`);
    return { ended: "refused", sha: "" };
  }
  let [status = "", uuid = "", sha = "", message = ""] = asked.out.split("\t");
  const deadline = Date.now() + STACK_WAIT_MS;
  while (status === "pending" || status === "enqueued") {
    if (status === "enqueued" || uuid === "" || Date.now() >= deadline) {
      const why =
        status === "enqueued"
          ? "went into the merge queue"
          : uuid === ""
            ? "named no merge to read back"
            : `had not ended after ${String(STACK_WAIT_MS / 60_000)} minutes`;
      console.error(
        `land: GitHub's merge of ${name} ${why}, so it is not read as landed. Read ${landing.trunk} and the ` +
          `stack before anything lands.`,
      );
      return { ended: "unsure", sha: "" };
    }
    await Bun.sleep(STACK_POLL_MS);
    const read = gh(root, ["api", `${path}/${uuid}`, "--jq", fields]);
    if (read.ok) [status = "", , sha = "", message = ""] = read.out.split("\t");
  }
  if (status !== "merged") {
    console.error(`land: GitHub did not merge ${name}: its merge ended ${status}: ${message}`);
    return { ended: "refused", sha };
  }
  if (
    sha !== "" &&
    gitSays(root, ["fetch", "-q", "origin", sha]) &&
    gitSays(root, ["diff", "--quiet", sha, top.headRefOid])
  ) {
    say(
      `${numbers(landing.pulls)} merged into ${landing.trunk} as ${name}, at ${short(top.headRefOid)}: ${short(sha)}.`,
    );
    return { ended: "merged", sha };
  }
  console.error(
    `land: ${name} merged into ${landing.trunk} as ${sha === "" ? "a commit GitHub did not name" : short(sha)}, ` +
      `whose tree is not the tree of ${short(top.headRefOid)} that the gate read. Read ${landing.trunk} before ` +
      `anything lands on it.`,
  );
  return { ended: "unsure", sha };
}

function checkListed(root: string, target: number, landing: Landing): void {
  const open = openPulls(root);
  if (placesOf(open) !== placesOf(landing.open)) checkCurrent(root, target, landing, open);
}

function checkCurrent(root: string, target: number, landing: Landing, open: readonly Pull[]): void {
  const again = readLanding(root, target, open);
  if (movedFrom(again.open, landing.pulls) !== -1 || again.trunkSha !== landing.trunkSha) {
    throw new Moved("a pull request's head or the trunk moved while its commits were gated.");
  }
  checkChain(root, again);
}

function restack(root: string, target: number, landing: Landing, mode: Mode): Landing {
  if (mode.kind === "proving") return landing;
  const above = chainAbove(landing.open, landing.top);
  if (above.length > 0) git(root, ["fetch", "-q", "origin", ...above.map((pull) => pull.headRefOid)]);
  let moves: ReturnType<typeof movesOf>;
  try {
    moves = movesOf(root, [...landing.pulls, ...above], landing.trunkSha);
  } catch (error) {
    if (!(error instanceof Unreplayable)) throw error;
    throw new Refusal(`${error.message}, push it, and land again.`);
  }
  if (moves.length === 0) return landing;
  const said = moves.map(
    ({ pull, to }) => `#${String(pull.number)} ${short(pull.headRefOid)} -> ${short(to)}`,
  );
  say(`replaying what moved beneath: ${said.join(", ")}.`);
  const refused = pushMoves(root, moves, say);
  if (refused !== null) throw new Moved(`the restacked heads were not pushed (${refused}).`);
  return readLanding(root, target, openPulls(root));
}

async function merge(root: string, target: number, landing: Landing): Promise<string | null> {
  checkCurrent(root, target, landing, openPulls(root));
  const heads = landing.pulls.map((pull) => pull.headRefOid);
  const stack = stackOf(root, landing.pulls, "link");
  const gated = (sha: string, state: StatusState, description: string): boolean =>
    postStatus(root, sha, { context: STACK_CONTEXT, state, description });
  const revoke = (): void => {
    for (const sha of heads) gated(sha, "pending", "Waiting for bun run land");
  };
  const proved = "every commit passed on its own; the top passed the whole gate here and ci.yml on GitHub";
  if (!heads.every((sha) => gated(sha, "success", proved))) {
    revoke();
    throw new Error(`the ${STACK_CONTEXT} status could not be posted on every head`);
  }
  const { ended, sha } = await mergeStack(root, landing, stack);
  if (ended !== "merged") {
    revoke();
    const open = `${numbers(landing.pulls)} ${landing.pulls.length === 1 ? "is" : "are"} open`;
    if (ended === "refused") console.error(`land: nothing merged; ${open}.`);
    return null;
  }
  // A pull request left on the top's branch would sit on a merged branch that no landing reads as
  // a bottom, so its base moves to the trunk; a failed read is said, since the merge has gone
  // through.
  let above: readonly Pull[] = [];
  try {
    above = openPulls(root).filter((pull) => pull.baseRefName === landing.top.headRefName);
  } catch (error) {
    say(`could not list the open pull requests (${String(error)}); move any on the top's branch.`);
  }
  for (const { number } of above) {
    const ok = gh(root, ["pr", "edit", String(number), "--base", landing.trunk]).ok;
    say(
      `#${String(number)} ${ok ? "is based on" : "could not be moved; run gh pr edit --base"} ${landing.trunk}.`,
    );
  }
  return sha;
}

function release(root: string, mode: Mode, sha: string): number {
  if (mode.tag === null) return 0;
  const args = ["release", "create", mode.tag, "--target", sha, "--title", mode.tag, "--generate-notes"];
  const made = gh(root, args);
  if (made.ok) {
    say(`released ${mode.tag} at ${short(sha)}: ${made.out}`);
    return 0;
  }
  console.error(
    `land: merged, and GitHub refused the release: ${made.err}. Cut it with: gh ${args.join(" ")}`,
  );
  return 1;
}

const holding = (root: string, landing: Landing, commit: string): number =>
  landing.pulls.findIndex((pull) => gitSays(root, ["merge-base", "--is-ancestor", commit, pull.headRefOid]));

function recipe(root: string, landing: Landing, commit: string): void {
  const at = short(commit);
  const index = holding(root, landing, commit);
  const holder = landing.pulls[index];
  const name = holder === undefined ? "" : `#${String(holder.number)} (${holder.headRefName})`;
  const above = landing.pulls.slice(index + 1);
  console.error(
    `land: the fix belongs in ${at}, on ${name}, not in a commit on top. In a checkout of its head:`,
  );
  console.error(`land:   git commit --fixup=${at}`);
  console.error(`land:   GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash ${at}~1`);
  if (above.length > 0) {
    console.error(
      `land: then replay ${numbers(above)} on it, bottom-up, and push them together (stack-pr, section 8).`,
    );
  }
  console.error(`land: the commits below ${at} keep their ids and their passes. Land again.`);
}

const moved = (root: string, top: Pull): boolean => topAbove(openPulls(root), top).number !== top.number;

function movedUnder(root: string, landing: Landing, under: readonly string[]): Moved | null {
  const from = movedFrom(openPulls(root), landing.pulls);
  const pull = landing.pulls[from];
  if (pull === undefined || !under.some((commit) => holding(root, landing, commit) >= from)) return null;
  return new Moved(`#${String(pull.number)} moved under a commit being proved.`);
}

async function landTo(root: string, target: number, mode: Mode, board: Board): Promise<number | "moved"> {
  // The refusals no replay can change come before it, so a refused landing force-pushes nothing.
  const read = readLanding(root, target, openPulls(root));
  checkLabels(read);
  const drafts = read.pulls.filter((pull) => pull.isDraft);
  if (mode.kind === "merging" && drafts.length > 0) {
    throw new Refusal(`${numbers(drafts)}: no merge takes a draft (gh pr ready, or a ready top).`);
  }
  const [chain] = read.beside;
  if (mode.kind === "merging" && !mode.alone && chain !== undefined) {
    throw new Refusal(
      `#${String(chain.number)} (${chain.headRefName}) starts another chain on ${read.trunk}, which this merge ` +
        `would leave short of ${read.trunk}'s new head, so that every pull request on it has to be replayed. ` +
        `Put ${numbers(read.pulls)} on that chain's top, land that chain first, or name --alone to merge it anyway.`,
    );
  }
  const landing = restack(root, target, read, mode);
  checkChain(root, landing);
  const { top } = landing;
  linkStacks(root, landing, mode);
  if (mode.kind === "merging") startCi(root, top);
  const heads = landing.pulls.map((pull) => pull.headRefOid);
  const whole = mode.topPass === "whole" ? top.headRefOid : null;
  const lowest = mode.from === null ? 0 : landing.pulls.findIndex(({ number }) => number === mode.from);
  if (lowest < 0) throw new Refusal(`#${String(mode.from)} is not in ${numbers(landing.pulls)}.`);
  const proofs = addedLine(root, heads, [landing.pulls[lowest - 1]?.headRefOid ?? landing.trunkSha], say).map(
    (commit): Proof => ({
      commit,
      pass: commit === whole ? "whole" : changesSource(root, commit) ? "static" : null,
    }),
  );
  say(
    `${numbers(landing.pulls)} onto ${landing.trunk} ${short(landing.trunkSha)}: ${plural(proofs.length, "commit")}.`,
  );
  const reach = mode.kind !== "proving";
  if (reach) board.read(proofs.map(({ commit }) => commit));
  const mergeable = (pull: Pull, state: StatusState, description: string): void =>
    board.post(pull.headRefOid, { context: MERGEABLE_CONTEXT, state, description });
  const at = new Map(proofs.map((proof, index) => [proof.commit, index]));
  const passed = new Set<string>();
  const proving = new Set<string>();
  let settled = true;
  let green = lowest === 0 ? 0 : landing.pulls.length;
  let pending = landing.pulls.length;
  const greenUpTo = (): void => {
    const unproved = proofs.findIndex((proof) => !passed.has(proof.commit));
    const upTo = unproved === -1 ? proofs.length : unproved;
    for (let pull = landing.pulls[green]; pull !== undefined; pull = landing.pulls[green]) {
      if ((at.get(pull.headRefOid) ?? upTo) >= upTo) return;
      if (!settled) checkListed(root, target, landing);
      settled = true;
      mergeable(pull, "success", "every commit up to this head passed bun run land");
      green += 1;
    }
  };
  const watch = watching(Refusal, () =>
    movedUnder(
      root,
      landing,
      [...proving].filter((commit) => !passed.has(commit)),
    ),
  );
  const failed = await proveCommits(root, proofs, {
    who: "land",
    places: mode.places,
    stop: watch.signal,
    say: sayingPulls(proofs, landing.pulls.slice(lowest), say),
    mark: (commit, state, description) => {
      if (state === "pending") {
        checkListed(root, target, landing);
        proving.add(commit);
      }
      settled = state === "pending" || (settled && !proving.has(commit));
      if (!reach) return;
      board.post(commit, { context: COMMIT_CONTEXT, state, description });
      const from = state === "pending" ? Math.max(green, holding(root, landing, commit)) : pending;
      for (const pull of landing.pulls.slice(from, pending)) {
        mergeable(pull, "pending", "bun run land is proving it");
      }
      pending = Math.min(pending, from);
      if (state === "success") passed.add(commit);
      greenUpTo();
    },
  }).finally(watch.end);
  if (watch.signal.aborted) throw watch.signal.reason;
  if (failed !== null) {
    const said = failed.verdict
      ? `fails ${failed.step} on its own`
      : `got no verdict on ${failed.step}: land again`;
    for (const pull of reach ? landing.pulls.slice(holding(root, landing, failed.commit)) : []) {
      mergeable(pull, failed.verdict ? "failure" : "error", `${short(failed.commit)} ${said}`);
    }
    if (failed.verdict) recipe(root, landing, failed.commit);
    console.error(
      `land: ${failedLine(failed)}. Nothing was merged.${failed.verdict ? "" : " Land again."} Log: ${failed.log}`,
    );
    return 1;
  }
  if (mode.auto && moved(root, top)) return "moved";
  if (mode.kind !== "merging") {
    const shown = reach ? `each shows ${COMMIT_CONTEXT} on GitHub` : "--sanitize shows it on GitHub";
    say(`every commit passed; ${shown}. bun run land -- ${String(target)} --merge also merges.`);
    return 0;
  }
  await awaitCi(root, top);
  if (mode.auto && moved(root, top)) return "moved";
  const sha = await merge(root, target, landing);
  return sha === null ? 1 : release(root, mode, sha);
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = argsOr(argv, USAGE, {
    merge: { type: "boolean", default: false },
    sanitize: { type: "boolean", default: false },
    auto: { type: "boolean", default: false },
    watch: { type: "boolean", default: false },
    whole: { type: "boolean", default: false },
    alone: { type: "boolean", default: false },
    jobs: { type: "string" },
    tag: { type: "string" },
    from: { type: "string" },
  });
  if (parsed === null) return 2;
  const { values, positionals } = parsed;
  const latest = positionals[0] === "latest";
  const named = positionals[0] === undefined || latest ? null : Number(positionals[0]);
  const jobs = values.jobs === undefined ? undefined : Number(values.jobs);
  const from = values.from === undefined ? null : Number(values.from);
  if (
    (named !== null && (!Number.isInteger(named) || named <= 0)) ||
    positionals.length > 1 ||
    (jobs !== undefined && (!Number.isInteger(jobs) || jobs <= 0)) ||
    (values.tag !== undefined && (!values.merge || !TAG.test(values.tag))) ||
    (from !== null && (values.merge || !values.sanitize || !Number.isInteger(from) || from <= 0))
  ) {
    console.error(USAGE);
    return 2;
  }
  const root = git(runtimeProcess.cwd(), ["rev-parse", "--show-toplevel"]);
  const places = whereToProve(root, jobs, say);
  if (places === null) return 2;
  const mode: Mode = {
    kind: values.merge ? "merging" : values.sanitize ? "sanitizing" : "proving",
    auto: values.auto || named === null,
    alone: values.alone,
    topPass: values.whole || values.merge ? "whole" : "static",
    places,
    tag: values.tag ?? null,
    from,
  };
  const top = latest ? latestTop(openPulls(root)) : named;
  if (top === 0) {
    console.error("land: no pull request is open. Nothing was merged.");
    return 1;
  }
  const round = (): Promise<number> => landOnce(root, () => top ?? oldestStack(root), mode);
  return values.watch && mode.kind !== "merging" ? follow(root, top, say, round) : round();
}

async function landOnce(root: string, first: () => number, mode: Mode): Promise<number> {
  const board = statusBoard(root);
  let alone = (): void => undefined;
  try {
    // A release the merge could not take is refused before anything is gated.
    // `--exit-code` exits 2 where origin holds no such ref; any other failure says nothing of the tag.
    const tagged =
      mode.tag === null
        ? 2
        : runSync(["git", "ls-remote", "--exit-code", "--tags", "origin", mode.tag], { cwd: root }).exitCode;
    if (tagged === 0) throw new Refusal(`${String(mode.tag)} is already a tag on origin.`);
    if (tagged !== 2) throw new Refusal(`origin could not be asked whether it holds ${String(mode.tag)}.`);
    let target = first();
    alone = await holdAlone(root, say, undefined, claimOf(root, target, mode));
    for (let moves = 0; ; ) {
      if (mode.auto) {
        const open = openPulls(root);
        const wanted = target;
        const from = open.find((pull) => pull.number === wanted);
        if (from !== undefined) target = topAbove(open, from).number;
      }
      const ended = await landTo(root, target, mode, board).catch((error: unknown) => {
        if (!(error instanceof Moved)) throw error;
        if (moves >= MOVES) throw new Refusal(`${error.message} Land again once the stack stays still.`);
        moves += 1;
        say(`${error.message} Landing again on the heads as they stand.`);
        return "again" as const;
      });
      if (ended === "again") continue;
      if (ended !== "moved") return ended;
      say(`a pull request was stacked on #${String(target)} while it landed; landing the new top.`);
    }
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    console.error(`land: ${error.message} Nothing was merged.`);
    return 1;
  } finally {
    board.settle();
    alone();
  }
}

if (import.meta.main) runtimeProcess.exit(await main(Bun.argv.slice(2)));
