/**
 * Lands a pull request, with every open one beneath it, on main, after proving each commit the
 * landing would publish where it sits.
 *
 *   bun run land -- <pull request> [--sanitize | --merge] [--jobs N]
 *
 * A push gates only what it adds: a commit whose patch the remote already held is a replay, and the
 * pre-push hook leaves it alone. So this is where every commit along the top's first parents above
 * main is proved over its own checkout: the static steps and its nearby tests, and the whole gate on
 * the top's head (`tools/runtime/gate.ts`), each pass already recorded skipped. The stack is read
 * from GitHub as v2's stack-pr reads it, each pull request's base the head of the one beneath it, and
 * the bottom must be based on main. Each head must contain the one beneath it and the bottom main's
 * head, so the last merge leaves main at exactly the top's tree, which is the tree the whole gate
 * read.
 *
 * Without a flag nothing is written to GitHub. `--sanitize` posts each commit's verdict as the
 * status `ana/commit` and stops: that is how a stack shows it is ready. `--merge` posts the same, and
 * also wants `ci.yml` passed on the top's head, since only it proves the Linux isolation on a clean
 * runner. No pull request push starts that run (since 19 October, `ci.yml`); when none exists and
 * `ci.yml` takes `workflow_dispatch`, `--merge` dispatches one before gating, so it runs meanwhile,
 * and waits for it after. No pull request merges before that run has passed. A failed run is not dispatched again, since nothing about its head changed. Then, on heads
 * read again, it posts `ana/stack-gate` on every head and merges the pull requests bottom-up through
 * GitHub, each pinned to its gated head, so each ends Merged; a local merge pushed to main left 98
 * pull requests open on 21 September 2026. The repository does not delete a merged branch, so
 * GitHub does not retarget the next pull request itself, and each is based on main just before its
 * merge. A merge that does not go through sets the status of every head left open back to pending.
 * A landing GitHub holds as one of its own stacks merges whole instead, through the stack's
 * asynchronous merge of everything up to the top, which commits all or nothing: GitHub refuses the
 * pull request's own merge for a stack's member (HTTP 403), and on 14 October that left stack 160,
 * #150 to #166, open after every one of its 64 commits had passed.
 *
 * A failure names the commit and the pull request it sits on. Its fix goes into that commit, the
 * pull requests above it are replayed on it (stack-pr, section 8), and a second landing runs only
 * what the replay moved. `--jobs N` gates up to N commits at once; the top's whole gate runs alone.
 */
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { parseArgs, runtimeProcess } from "../../src/meta/process.ts";
import { decodeOutput, runSync } from "../../src/meta/subprocess.ts";
import { plural } from "../../src/meta/text.ts";
import { addedLine, changesSource, git, gitSays, type Proof, proveCommits, short } from "./gate.ts";

/** An open pull request, in the fields `gh pr list --json` names. */
export interface Pull {
  readonly number: number;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly headRefOid: string;
  readonly isDraft: boolean;
}

interface Landing {
  readonly trunk: string;
  readonly trunkSha: string;
  /** The open pull requests the landing merges, bottom to top; the last is the one named. */
  readonly pulls: readonly Pull[];
}

interface Answer {
  readonly ok: boolean;
  readonly out: string;
  readonly err: string;
}

const COMMIT_CONTEXT = "ana/commit";
const STACK_CONTEXT = "ana/stack-gate";
const CI_WORKFLOW = "ci.yml";
/** ANA_CI_POLL_MS shortens it for the tests that walk a run from queued to completed. */
const CI_POLL_MS = Number(runtimeProcess.env.ANA_CI_POLL_MS) || 20_000;
/** `ci.yml`'s jobs stop at 45 minutes; the rest is the macOS runner's queue. */
const CI_WAIT_MS = 75 * 60_000;
/** GitHub answers `mergeable: null` while it computes a pull request's mergeability after its base
 *  moved, and a merge asked for meanwhile is refused. */
const MERGEABLE_POLL_MS = 2000;
const MERGEABLE_WAIT_MS = 2 * 60_000;
/** A stack's merge is queued on GitHub's side and read back until it ends; stack 160's took a
 *  second. ANA_CI_POLL_MS shortens the poll for the tests as for `ci.yml`. */
const STACK_POLL_MS = Number(runtimeProcess.env.ANA_CI_POLL_MS) || MERGEABLE_POLL_MS;
const STACK_WAIT_MS = 10 * 60_000;
const USAGE = "usage: bun run land -- <pull request> [--sanitize | --merge] [--jobs N]";

class Refusal extends Error {}

const say = (line: string): void => console.log(`land: ${line}`);
const numbers = (pulls: readonly Pull[]): string => pulls.map((pull) => `#${String(pull.number)}`).join(", ");
// `{owner}/{repo}` is gh's own placeholder for the repository the working directory's remote names.
const api = (path: string): string => `repos/{owner}/{repo}/${path}`;

function gh(root: string, args: readonly string[]): Answer {
  const result = runSync(["gh", ...args], { cwd: root });
  return {
    ok: result.exitCode === 0,
    out: decodeOutput(result.stdout).trim(),
    err: decodeOutput(result.stderr).trim(),
  };
}

export function ghOrThrow(root: string, args: readonly string[]): string {
  const answer = gh(root, args);
  if (!answer.ok) throw new Error(`gh ${args.join(" ")}: ${answer.err}`);
  return answer.out;
}

/** Every open pull request of the repository `root`'s remote names, as GitHub lists them now. */
export const openPulls = (root: string): Pull[] =>
  parseJsonAs<Pull[]>(
    ghOrThrow(root, [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "number,headRefName,baseRefName,headRefOid,isDraft",
    ]),
  );

/** The pull request named and every open one beneath it, bottom to top, read from GitHub. */
function readLanding(root: string, target: number): Landing {
  const open = openPulls(root);
  const named = open.find((pull) => pull.number === target);
  if (named === undefined) throw new Refusal(`#${String(target)} is not an open pull request.`);
  const pulls = [named];
  const byHead = new Map(open.map((pull) => [pull.headRefName, pull]));
  for (let below = byHead.get(named.baseRefName); below !== undefined && !pulls.includes(below); ) {
    pulls.unshift(below);
    below = byHead.get(below.baseRefName);
  }
  // SAFETY: `pulls` starts with the named pull request and only grows.
  const bottom = pulls[0] as Pull;
  const trunk = ghOrThrow(root, [
    "repo",
    "view",
    "--json",
    "defaultBranchRef",
    "--jq",
    ".defaultBranchRef.name",
  ]);
  if (bottom.baseRefName !== trunk) {
    throw new Refusal(
      `#${String(bottom.number)} (${bottom.headRefName}) is based on ${bottom.baseRefName}, which is neither ${trunk} ` +
        `nor an open pull request's head. Base it on what it stacks on, and land again.`,
    );
  }
  const trunkSha = git(root, ["ls-remote", "origin", `refs/heads/${trunk}`]).split("\t")[0] ?? "";
  git(root, ["fetch", "-q", "origin", trunkSha, ...pulls.map((pull) => pull.headRefOid)]);
  return { trunk, trunkSha, pulls };
}

/** The last merge has the top's tree only when each head contains the one beneath it, down to the
 *  trunk's current head. */
function checkChain(root: string, landing: Landing): void {
  let below = { name: `${landing.trunk}'s head`, sha: landing.trunkSha };
  for (const pull of landing.pulls) {
    if (!gitSays(root, ["merge-base", "--is-ancestor", below.sha, pull.headRefOid])) {
      throw new Refusal(
        `#${String(pull.number)} (${pull.headRefName}) does not contain ${below.name} ${short(below.sha)}. Replay ` +
          `it and every pull request above it on what is beneath it, push them together, and land again.`,
      );
    }
    below = { name: `#${String(pull.number)}'s head`, sha: pull.headRefOid };
  }
}

function postStatus(root: string, sha: string, context: string, state: string, description: string): boolean {
  return gh(root, [
    "api",
    "-X",
    "POST",
    api(`statuses/${sha}`),
    "-f",
    `state=${state}`,
    "-f",
    `context=${context}`,
    "-f",
    `description=${description}`,
    "--silent",
  ]).ok;
}

/** The newest `ci.yml` run on `sha` that a later one did not cancel, as its status, conclusion, id
 *  and link; null when there is none; undefined when GitHub did not answer, which is never read as
 *  none. */
function ciRun(root: string, sha: string): string[] | null | undefined {
  const read = gh(root, [
    "run",
    "list",
    "--workflow",
    CI_WORKFLOW,
    "--commit",
    sha,
    "--json",
    "status,conclusion,databaseId,url",
    "--jq",
    String.raw`[.[] | select(.conclusion != "cancelled")] | first // empty | [.status, .conclusion, .databaseId, .url] | map(tostring) | join("\t")`,
  ]);
  if (!read.ok) return undefined;
  return read.out === "" ? null : read.out.split("\t");
}

/** Dispatches `ci.yml` on the top's head unless a run is already there. */
function startCi(root: string, top: Pull): void {
  const head = `#${String(top.number)}'s head ${short(top.headRefOid)}`;
  const ci = ciRun(root, top.headRefOid);
  if (ci === undefined) {
    throw new Refusal(`GitHub did not list ${CI_WORKFLOW}'s runs on ${head}. Land again.`);
  }
  if (ci !== null) return;
  const workflow = runSync(["git", "show", `${top.headRefOid}:.github/workflows/${CI_WORKFLOW}`], {
    cwd: root,
  });
  if (!/^[^#\n]*\bworkflow_dispatch\b/mu.test(decodeOutput(workflow.stdout))) {
    throw new Refusal(
      `no ${CI_WORKFLOW} run exists on ${head}, and ${CI_WORKFLOW} there takes no workflow_dispatch to start one. ` +
        `Land again once a run exists.`,
    );
  }
  ghOrThrow(root, ["workflow", "run", CI_WORKFLOW, "--ref", top.headRefName]);
  say(`dispatched ${CI_WORKFLOW} on ${head}; it runs while the commits are gated here.`);
}

async function awaitCi(root: string, top: Pull): Promise<void> {
  const deadline = Date.now() + CI_WAIT_MS;
  let ci = ciRun(root, top.headRefOid);
  while (ci?.[0] !== "completed" && Date.now() < deadline) {
    await Bun.sleep(CI_POLL_MS);
    ci = ciRun(root, top.headRefOid) ?? ci;
  }
  const [status, conclusion, id, url] = ci ?? [];
  const head = `#${String(top.number)}'s head ${short(top.headRefOid)}`;
  if (conclusion === "success") {
    say(`${CI_WORKFLOW} passed on ${head}: ${url ?? ""}`);
    return;
  }
  throw new Refusal(
    status === "completed"
      ? `${CI_WORKFLOW} ended ${conclusion ?? ""} on ${head}: ${url ?? ""}. Fix the commit it names, or run ` +
          `gh run rerun ${id ?? ""} if the runner was at fault, and land again.`
      : `${CI_WORKFLOW} on ${head} has not finished: ${url ?? "no run has started"}. Land again once it has.`,
  );
}

/** Whether GitHub calls the pull request mergeable, once it has finished computing it. */
async function mergeable(root: string, pull: Pull): Promise<boolean> {
  const deadline = Date.now() + MERGEABLE_WAIT_MS;
  for (;;) {
    const read = gh(root, ["api", api(`pulls/${String(pull.number)}`), "--jq", ".mergeable"]);
    if (read.out === "true" || read.out === "false" || Date.now() >= deadline) return read.out === "true";
    await Bun.sleep(MERGEABLE_POLL_MS);
  }
}

/** The open native stack GitHub holds the top in, or undefined where there is none or GitHub did
 *  not say: a member of a stack that is merged alone is refused (HTTP 403), so a stack the read
 *  missed still merges nothing. The stack merges everything up to the top, so its members up to
 *  the top have to be the landing's pull requests, bottom to top. */
function stackOf(root: string, landing: Landing): number | undefined {
  // SAFETY: a landing holds at least the pull request it was named by.
  const top = landing.pulls.at(-1) as Pull;
  const read = gh(root, [
    "api",
    api(`stacks?pull_request=${String(top.number)}`),
    "--jq",
    String.raw`map(select(.open)) | first // empty | "\(.number) \(.pull_requests | map(.number) | join(","))"`,
  ]);
  if (!read.ok || read.out === "") return undefined;
  const [stack = "", listed = ""] = read.out.split(" ");
  const members = listed.split(",");
  const upTo = members.slice(0, members.indexOf(String(top.number)) + 1);
  if (upTo.join() !== landing.pulls.map((pull) => String(pull.number)).join()) {
    throw new Refusal(
      `GitHub's stack ${stack} holds #${members.join(", #")}, and the chain of bases up to #${String(top.number)} ` +
        `holds ${numbers(landing.pulls)}. Make them agree, and land again.`,
    );
  }
  return Number(stack);
}

/** Merges a stack through the top whole, as GitHub's asynchronous merge does, all or nothing, and
 *  reads it back until it ends. `refused` means nothing merged; `unsure` that something may have,
 *  or merged to a tree other than the top's, which is the one the gate read: that merge takes no
 *  head to pin. */
async function mergeStack(
  root: string,
  landing: Landing,
  stack: number,
): Promise<"merged" | "refused" | "unsure"> {
  // SAFETY: a landing holds at least the pull request it was named by.
  const top = landing.pulls.at(-1) as Pull;
  const path = api(`pulls/${String(top.number)}/merge-async`);
  const fields = String.raw`[.status, .details.uuid // "", .details.sha // "", .details.message // ""] | join("\t")`;
  const name = `stack ${String(stack)}`;
  const asked = gh(root, [
    "api",
    "-X",
    "PUT",
    path,
    "-f",
    "merge_method=merge",
    "-f",
    "merge_action=direct_merge",
    "--jq",
    fields,
  ]);
  if (!asked.ok) {
    console.error(`land: GitHub did not merge ${name}: ${asked.err}`);
    return "refused";
  }
  let [status = "", uuid = "", sha = "", message = ""] = asked.out.split("\t");
  const deadline = Date.now() + STACK_WAIT_MS;
  while (status === "pending" || status === "enqueued") {
    if (uuid === "" || Date.now() >= deadline) {
      const why =
        uuid === ""
          ? "named no merge to read back"
          : `had not ended after ${String(STACK_WAIT_MS / 60_000)} minutes`;
      console.error(
        `land: GitHub's merge of ${name} ${why}; the statuses stand. Read ${landing.trunk} and the stack before ` +
          `anything lands.`,
      );
      return "unsure";
    }
    await Bun.sleep(STACK_POLL_MS);
    const read = gh(root, ["api", `${path}/${uuid}`, "--jq", fields]);
    if (read.ok) [status = "", , sha = "", message = ""] = read.out.split("\t");
  }
  if (status !== "merged") {
    console.error(`land: GitHub did not merge ${name}: its merge ended ${status}: ${message}`);
    return "refused";
  }
  if (
    sha !== "" &&
    gitSays(root, ["fetch", "-q", "origin", sha]) &&
    gitSays(root, ["diff", "--quiet", sha, top.headRefOid])
  ) {
    say(
      `${numbers(landing.pulls)} merged into ${landing.trunk} as ${name}, at ${short(top.headRefOid)}: ${short(sha)}.`,
    );
    return "merged";
  }
  console.error(
    `land: ${name} merged into ${landing.trunk} as ${sha === "" ? "a commit GitHub did not name" : short(sha)}, ` +
      `whose tree is not the tree of ${short(top.headRefOid)} that the gate read. Read ${landing.trunk} before ` +
      `anything lands on it.`,
  );
  return "unsure";
}

/** Posts the required status on every head, then merges the pull requests bottom-up, each at
 *  exactly its gated head. A pull request that does not merge stops the landing and takes the status
 *  back from every head still open. */
async function merge(root: string, target: number, landing: Landing): Promise<boolean> {
  const again = readLanding(root, target);
  checkChain(root, again);
  const heads = landing.pulls.map((pull) => pull.headRefOid);
  if (again.pulls.map((pull) => pull.headRefOid).join() !== heads.join()) {
    throw new Refusal("a pull request's head moved while its commits were gated. Land again.");
  }
  const stack = stackOf(root, landing);
  const revoke = (from: number): void => {
    for (const sha of heads.slice(from)) {
      postStatus(root, sha, STACK_CONTEXT, "pending", "Waiting for bun run land");
    }
  };
  const proved = "every commit passed on its own; the top passed the whole gate here and ci.yml on GitHub";
  if (!heads.every((sha) => postStatus(root, sha, STACK_CONTEXT, "success", proved))) {
    revoke(0);
    throw new Error(`the ${STACK_CONTEXT} status could not be posted on every head`);
  }
  if (stack !== undefined) {
    const ended = await mergeStack(root, landing, stack);
    if (ended === "refused") {
      revoke(0);
      console.error(
        `land: nothing merged; ${numbers(landing.pulls)} ${landing.pulls.length === 1 ? "is" : "are"} open.`,
      );
    }
    return ended === "merged";
  }
  for (const [index, pull] of landing.pulls.entries()) {
    const stop = (why: string): false => {
      revoke(index);
      const merged = landing.pulls.slice(0, index);
      const left = `${numbers(landing.pulls.slice(index))} ${index === landing.pulls.length - 1 ? "is" : "are"} open`;
      console.error(`land: GitHub did not merge #${String(pull.number)}: ${why}`);
      console.error(
        `land: ${merged.length === 0 ? "nothing merged" : `${numbers(merged)} merged`}; ${left}.`,
      );
      return false;
    };
    if (pull.baseRefName !== landing.trunk) {
      const based = gh(root, [
        "api",
        "-X",
        "PATCH",
        api(`pulls/${String(pull.number)}`),
        "-f",
        `base=${landing.trunk}`,
        "--silent",
      ]);
      if (!based.ok) return stop(`it could not be based on ${landing.trunk}: ${based.err}`);
    }
    if (!(await mergeable(root, pull))) return stop("GitHub does not call it mergeable.");
    const merged = gh(root, [
      "api",
      "-X",
      "PUT",
      api(`pulls/${String(pull.number)}/merge`),
      "-f",
      "merge_method=merge",
      "-f",
      `sha=${pull.headRefOid}`,
      "--jq",
      ".sha",
    ]);
    if (!merged.ok) return stop(merged.err);
    say(
      `#${String(pull.number)} merged into ${landing.trunk} at ${short(pull.headRefOid)}: ${short(merged.out)}.`,
    );
  }
  return true;
}

/** Where the fix for a failed commit goes, and how a second landing finds it. */
function recipe(root: string, landing: Landing, commit: string): void {
  const at = short(commit);
  const index = landing.pulls.findIndex((pull) =>
    gitSays(root, ["merge-base", "--is-ancestor", commit, pull.headRefOid]),
  );
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

async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      merge: { type: "boolean", default: false },
      sanitize: { type: "boolean", default: false },
      jobs: { type: "string", default: "1" },
    },
    allowPositionals: true,
  });
  const target = Number(positionals[0]);
  const jobs = Number(values.jobs);
  if (
    !Number.isInteger(target) ||
    target <= 0 ||
    positionals.length !== 1 ||
    !Number.isInteger(jobs) ||
    jobs <= 0
  ) {
    console.error(USAGE);
    return 2;
  }
  const root = git(runtimeProcess.cwd(), ["rev-parse", "--show-toplevel"]);
  try {
    const landing = readLanding(root, target);
    checkChain(root, landing);
    // SAFETY: readLanding's chain ends with the named pull request.
    const top = landing.pulls.at(-1) as Pull;
    const draft = landing.pulls.find((pull) => pull.isDraft);
    if (values.merge && draft !== undefined) {
      throw new Refusal(`#${String(draft.number)} is a draft, and it would merge in this landing.`);
    }
    if (values.merge) startCi(root, top);
    // Each commit the landing publishes along the top's first parents, with the pass it needs.
    const proofs = addedLine(root, [top.headRefOid], [landing.trunkSha], say).map(
      (commit): Proof => ({
        commit,
        pass: commit === top.headRefOid ? "whole" : changesSource(root, commit) ? "static" : null,
      }),
    );
    say(
      `${numbers(landing.pulls)} onto ${landing.trunk} ${short(landing.trunkSha)}: ${plural(proofs.length, "commit")}.`,
    );
    const reach = values.merge || values.sanitize;
    const failed = await proveCommits(root, proofs, {
      who: "land",
      jobs,
      say,
      mark: (commit, state, description) => {
        if (reach) postStatus(root, commit, COMMIT_CONTEXT, state, description);
      },
    });
    if (failed !== null) {
      recipe(root, landing, failed.commit);
      console.error(
        `land: ${short(failed.commit)} FAILS ${failed.step} ON ITS OWN. Nothing was merged. Log: ${failed.log}`,
      );
      return 1;
    }
    if (!values.merge) {
      const shown = reach ? `each shows ${COMMIT_CONTEXT} on GitHub` : "--sanitize shows it on GitHub";
      say(`every commit passed; ${shown}. bun run land -- ${String(target)} --merge also merges.`);
      return 0;
    }
    await awaitCi(root, top);
    return (await merge(root, target, landing)) ? 0 : 1;
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    console.error(`land: ${error.message} Nothing was merged.`);
    return 1;
  }
}

if (import.meta.main) runtimeProcess.exit(await main(Bun.argv.slice(2)));
