/**
 * Lands a pull request, with every open one beneath it, on main, after proving each commit the
 * landing would publish where it sits.
 *
 *   bun run land -- <pull request> [--sanitize | --merge] [--jobs N]
 *
 * A push runs no test: the pre-push hook runs every other step of the gate over the pushed head
 * (`tools/runtime/pre-push.ts`), so a pushed commit is unproved until it lands here. This is where
 * each landing head's first-parent line above main is proved over its own checkout: the static
 * steps and its nearby tests, and the whole gate, the full suite among it, on the top's head
 * (`tools/runtime/gate.ts`), each pass already recorded skipped. `--sanitize` runs that proof when
 * its author judges the stack ready, without merging. The stack is read
 * from GitHub as v2's stack-pr reads it, each pull request's base the head of the one beneath it, and
 * the bottom must be based on main. Each head must contain the one beneath it and the bottom main's
 * head, so the last merge leaves main at exactly the top's tree, which is the tree the whole gate
 * read.
 *
 * Without a flag nothing is written to GitHub. `--sanitize` posts each commit's verdict as the
 * status `ana/commit` and stops. It also posts the check `mergeable` on each pull request's head:
 * pending on every head before the first proof, then success on each head as soon as every commit
 * from the bottom to it has passed, so the stack turns green from the bottom up while the rest is
 * gated, and failure on the head that holds a failed commit and on each above it. A check belongs
 * to its commit, so a push leaves the new head without it and the pull request reads unproved again
 * (`mergeable.yml` marks it and the heads above it pending); a label would outlive the head it was
 * earned on (the operator, 27 October). That is how a stack shows it is ready. `--merge` posts the same, and
 * also wants `ci.yml` passed on the top's head, since only it proves the Linux isolation on a clean
 * runner. No pull request push starts that run (since 19 October, `ci.yml`); when none exists and
 * `ci.yml` takes `workflow_dispatch`, `--merge` dispatches one before gating, so it runs meanwhile,
 * and waits for it after. No pull request merges before that run has passed. A failed run is not dispatched again, since nothing about its head changed. Then, on heads
 * read again, it posts `ana/stack-gate` on every head and merges through GitHub, so each pull request
 * ends Merged; a local merge pushed to main left 98 pull requests open on 21 September 2026. The
 * merge is GitHub's asynchronous merge of the top, pinned to the top's gated head, which merges
 * everything beneath it in the native stack all or nothing: GitHub refuses the pull request's own
 * merge for a stack's member (HTTP 403), and on 14 October that left stack 160, #150 to #166, open
 * after every one of its 64 commits had passed. So a landing of several pull requests has to be one
 * native stack, its members up to the top the chain of bases (`gh stack link` makes one). Until 21
 * October a chain outside a stack was merged one pull request at a time, each retargeted to main
 * first; every landing since 14 October went through a stack. A merge that does not go through sets
 * the status of every head back to pending.
 *
 * A merge is refused before anything is gated where another open chain starts on main, a pull
 * request based there with another above it: the merge would leave that chain short of main's new
 * head, and every pull request on it would have to be replayed before it could land. On 22 October
 * #343 merged alone beside the chain #338 to #352, which then needed 26 commits replayed, three of
 * them by hand, before it could land. A lone pull request beside the landing is cheap to replay and
 * is left alone.
 *
 * Every pull request of the landing carries exactly one importance label, `importance:I0` to
 * `importance:I3`, which the operator ranks the stack by; since 25 October a title carries no "Ix:"
 * prefix in its place. A landing in which any lacks one or carries two is refused before anything is
 * gated, in every mode, so `--sanitize` too shows a stack that is not ready, and the refusal names
 * each such pull request (`checkImportance`).
 *
 * A failure names the commit and the pull request it sits on. Its fix goes into that commit, the
 * pull requests above it are replayed on it (stack-pr, section 8), and a second landing runs only
 * what the replay moved. `--jobs N` gates up to N commits at once; the top's whole gate runs alone.
 *
 * GitHub holds main to this command. Since 25 October the repository allows merge commits only,
 * and ruleset 25824510 on the default branch, with no bypass actors, refuses deleting main and any
 * non-fast-forward push to it (an author-identity fix rewrote main's history that day at 14:24Z),
 * and requires a pull request merged by the merge method with the status `ana/stack-gate`, which
 * only `--merge` posts (`STACK_CONTEXT`). `gh api repos/s-smits/anabasis/rulesets/25824510` reads
 * it. The one gap: a token with admin rights can post that status by hand.
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
  readonly labels: readonly { readonly name: string }[];
}

interface Landing {
  readonly trunk: string;
  readonly trunkSha: string;
  /** The open pull requests the landing merges, bottom to top; the last is the one named. */
  readonly pulls: readonly Pull[];
  /** The bottom of each other open chain on the trunk, with another pull request above it. */
  readonly beside: readonly Pull[];
}

interface Answer {
  readonly ok: boolean;
  readonly out: string;
  readonly err: string;
}

const COMMIT_CONTEXT = "ana/commit";
const MERGEABLE_CONTEXT = "mergeable";
const STACK_CONTEXT = "ana/stack-gate";
const CI_WORKFLOW = "ci.yml";
/** ANA_CI_POLL_MS shortens it for the tests that walk a run from queued to completed. */
const CI_POLL_MS = Number(runtimeProcess.env.ANA_CI_POLL_MS) || 20_000;
/** `ci.yml`'s jobs stop at 45 minutes; the rest is the macOS runner's queue. */
const CI_WAIT_MS = 75 * 60_000;
/** A stack's merge is queued on GitHub's side and read back until it ends; stack 160's took a
 *  second. ANA_CI_POLL_MS shortens the poll for the tests as for `ci.yml`. */
const STACK_POLL_MS = Number(runtimeProcess.env.ANA_CI_POLL_MS) || 2000;
const STACK_WAIT_MS = 10 * 60_000;
/** The labels that rank a pull request's importance; each of a landing carries exactly one. */
const IMPORTANCE = /^importance:I[0-3]$/u;
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
      "number,headRefName,baseRefName,headRefOid,isDraft,labels",
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
  const beside = open.filter(
    (pull) =>
      pull.baseRefName === trunk &&
      !pulls.includes(pull) &&
      open.some((above) => above.baseRefName === pull.headRefName),
  );
  return { trunk, trunkSha, pulls, beside };
}

/** The importance labels a pull request carries; a landing asks for exactly one. */
export const ranksOf = (pull: Pull): string[] =>
  pull.labels.map((label) => label.name).filter((name) => IMPORTANCE.test(name));

/** Refuses a landing in which a pull request carries no importance label, or more than one. */
function checkImportance(landing: Landing): void {
  const unranked = landing.pulls.flatMap((pull) => {
    const ranks = ranksOf(pull);
    if (ranks.length === 1) return [];
    return [
      `#${String(pull.number)} carries ${ranks.length === 0 ? "no importance label" : ranks.join(" and ")}`,
    ];
  });
  if (unranked.length > 0) {
    throw new Refusal(
      `${unranked.join("; ")}. Give each pull request exactly one of importance:I0 to importance:I3 ` +
        `(gh pr edit <number> --add-label importance:I2), and land again.`,
    );
  }
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

/** The open native stack GitHub holds the top in, or null for a landing of one pull request that is
 *  in none. The stack merges everything up to the top, so its members up to the top have to be the
 *  landing's pull requests, bottom to top; a landing of several outside a stack, or one GitHub did
 *  not say, is refused, since the top's merge would merge it alone into its base. */
function stackOf(root: string, landing: Landing): number | null {
  // SAFETY: a landing holds at least the pull request it was named by.
  const top = landing.pulls.at(-1) as Pull;
  const read = gh(root, [
    "api",
    api(`stacks?pull_request=${String(top.number)}`),
    "--jq",
    String.raw`map(select(.open)) | first // empty | "\(.number) \(.pull_requests | map(.number) | join(","))"`,
  ]);
  if (!read.ok) {
    throw new Refusal(`GitHub did not say which stack #${String(top.number)} is in: ${read.err} Land again.`);
  }
  if (read.out === "" && landing.pulls.length === 1) return null;
  if (read.out === "") {
    throw new Refusal(
      `${numbers(landing.pulls)} are in no stack on GitHub. Make them one, bottom to top, with ` +
        `gh stack link ${landing.pulls.map((pull) => String(pull.number)).join(" ")}, and land again.`,
    );
  }
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

/** Merges the top, with the stack beneath it, as GitHub's asynchronous merge does, all or nothing,
 *  pinned to the top's gated head, and reads it back until it ends. `refused` means nothing merged;
 *  `unsure` that something may have, went into a merge queue (a merge request ends there), or merged
 *  to a tree other than the top's, which is the one the gate read. */
async function mergeStack(
  root: string,
  landing: Landing,
  stack: number | null,
): Promise<"merged" | "refused" | "unsure"> {
  // SAFETY: a landing holds at least the pull request it was named by.
  const top = landing.pulls.at(-1) as Pull;
  const path = api(`pulls/${String(top.number)}/merge-async`);
  const fields = String.raw`[.status, .details.uuid // "", .details.sha // "", .details.message // ""] | join("\t")`;
  const name = stack === null ? `#${String(top.number)}` : `stack ${String(stack)}`;
  const asked = gh(root, [
    "api",
    "-X",
    "PUT",
    path,
    "-f",
    "merge_method=merge",
    "-f",
    "merge_action=direct_merge",
    "-f",
    `sha=${top.headRefOid}`,
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
    if (status === "enqueued" || uuid === "" || Date.now() >= deadline) {
      const why =
        status === "enqueued"
          ? "went into the merge queue"
          : uuid === ""
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

/** Refuses a proof whose chain has moved before its success is published. */
function checkCurrent(root: string, target: number, landing: Landing): void {
  const again = readLanding(root, target);
  checkChain(root, again);
  if (
    again.pulls.map((pull) => pull.headRefOid).join() !== landing.pulls.map((pull) => pull.headRefOid).join()
  ) {
    throw new Refusal("a pull request's head moved while its commits were gated. Land again.");
  }
}

/** Posts the required status on every head, then merges the top with the stack beneath it. A merge
 *  that does not go through takes the status back from every head. */
async function merge(root: string, target: number, landing: Landing): Promise<boolean> {
  checkCurrent(root, target, landing);
  const heads = landing.pulls.map((pull) => pull.headRefOid);
  const stack = stackOf(root, landing);
  const revoke = (): void => {
    for (const sha of heads) postStatus(root, sha, STACK_CONTEXT, "pending", "Waiting for bun run land");
  };
  const proved = "every commit passed on its own; the top passed the whole gate here and ci.yml on GitHub";
  if (!heads.every((sha) => postStatus(root, sha, STACK_CONTEXT, "success", proved))) {
    revoke();
    throw new Error(`the ${STACK_CONTEXT} status could not be posted on every head`);
  }
  const ended = await mergeStack(root, landing, stack);
  if (ended === "refused") {
    revoke();
    console.error(
      `land: nothing merged; ${numbers(landing.pulls)} ${landing.pulls.length === 1 ? "is" : "are"} open.`,
    );
  }
  return ended === "merged";
}

/** The index of the lowest pull request of the landing whose head holds `commit`. */
const holding = (root: string, landing: Landing, commit: string): number =>
  landing.pulls.findIndex((pull) => gitSays(root, ["merge-base", "--is-ancestor", commit, pull.headRefOid]));

/** Where the fix for a failed commit goes, and how a second landing finds it. */
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
    checkImportance(landing);
    checkChain(root, landing);
    // SAFETY: readLanding's chain ends with the named pull request.
    const top = landing.pulls.at(-1) as Pull;
    const draft = landing.pulls.find((pull) => pull.isDraft);
    if (values.merge && draft !== undefined) {
      throw new Refusal(`#${String(draft.number)} is a draft, and it would merge in this landing.`);
    }
    const [chain] = landing.beside;
    if (values.merge && chain !== undefined) {
      throw new Refusal(
        `#${String(chain.number)} (${chain.headRefName}) starts another chain on ${landing.trunk}, which this merge ` +
          `would leave short of ${landing.trunk}'s new head, so that every pull request on it has to be replayed. ` +
          `Put ${numbers(landing.pulls)} on that chain's top, or land that chain first.`,
      );
    }
    if (values.merge) {
      stackOf(root, landing);
      startCi(root, top);
    }
    // Each landing head's own line, including a lower head reached through a merge's other parent.
    const heads = landing.pulls.map((pull) => pull.headRefOid);
    const proofs = addedLine(root, heads, [landing.trunkSha], say).map(
      (commit): Proof => ({
        commit,
        pass: commit === top.headRefOid ? "whole" : changesSource(root, commit) ? "static" : null,
      }),
    );
    say(
      `${numbers(landing.pulls)} onto ${landing.trunk} ${short(landing.trunkSha)}: ${plural(proofs.length, "commit")}.`,
    );
    const reach = values.merge || values.sanitize;
    for (const pull of reach ? landing.pulls : []) {
      postStatus(
        root,
        pull.headRefOid,
        MERGEABLE_CONTEXT,
        "pending",
        "waiting for bun run land to prove every commit up to this head",
      );
    }
    // A pull request turns green as soon as every commit from the bottom to its head has passed,
    // so the stack shows its proof climbing while the commits above are still being gated.
    const at = new Map(proofs.map((proof, index) => [proof.commit, index]));
    const passed = new Set<string>();
    let green = 0;
    const greenUpTo = (): void => {
      const unproved = proofs.findIndex((proof) => !passed.has(proof.commit));
      const upTo = unproved === -1 ? proofs.length : unproved;
      for (let pull = landing.pulls[green]; pull !== undefined; pull = landing.pulls[green]) {
        if ((at.get(pull.headRefOid) ?? upTo) >= upTo) return;
        checkCurrent(root, target, landing);
        postStatus(
          root,
          pull.headRefOid,
          MERGEABLE_CONTEXT,
          "success",
          "every commit up to this head passed bun run land",
        );
        green += 1;
      }
    };
    const failed = await proveCommits(root, proofs, {
      who: "land",
      jobs,
      say,
      mark: (commit, state, description) => {
        if (!reach) return;
        postStatus(root, commit, COMMIT_CONTEXT, state, description);
        if (state === "success") passed.add(commit);
        greenUpTo();
      },
    });
    if (failed !== null) {
      for (const pull of reach ? landing.pulls.slice(holding(root, landing, failed.commit)) : []) {
        const description = `${short(failed.commit)} fails ${failed.step} on its own`;
        postStatus(root, pull.headRefOid, MERGEABLE_CONTEXT, "failure", description);
      }
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
