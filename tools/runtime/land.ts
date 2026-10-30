/**
 * Lands a pull request, with every open one beneath it, on main, after proving each commit the
 * landing would publish where it sits.
 *
 *   bun run land -- [<pull request>] [--auto] [--sanitize | --merge [--alone] [--tag vX.Y.Z]] [--jobs N]
 *
 * `--auto` follows the top: it lands the top of the longest chain above the pull request named, and
 * after the proof, and again after `ci.yml` before a merge, it reads the chain again and lands its
 * new top where one was stacked meanwhile (`topAbove`). Proofs are remembered by tree, so a moved
 * top costs only its new commits. Named without `--auto`, a landing stops at the pull request named,
 * and a pull request stacked above it during the run stays open. With no pull request named, it
 * lands the stack that holds the oldest stacked pull request, its bottom on main with another above
 * it, and follows its top (`oldestStack`; operator, 27 October). It never follows into another
 * chain on main.
 *
 * A plain push runs no step of the CI gate, and one with `ANA_PUSH_VERIFY=1` only the static steps
 * and nearby tests over the pushed head (`tools/runtime/pre-push.ts`), so a pushed commit is unproved
 * until it lands here. This is where
 * each landing head's first-parent line above main is proved over its own checkout: the static
 * steps and its nearby tests, and the whole CI gate, the full suite among it, on the top's head
 * (`tools/runtime/gate.ts`), each pass already recorded skipped. `--sanitize` runs that proof when
 * its author judges the stack ready, without merging. The stack is read
 * from GitHub as v2's stack-pr reads it, each pull request's base the head of the one beneath it, and
 * the bottom must be based on main. Each head must contain the one beneath it and the bottom main's
 * head, so the last merge leaves main at exactly the top's tree, which is the tree the whole CI gate
 * read.
 *
 * Without a flag nothing is written to GitHub. `--sanitize` posts each commit's verdict as the
 * status `ana/commit` and stops, posting no status GitHub already shows (`statusPoster`). It also
 * posts the check `mergeable` on each pull request's head: success on each head as soon as every
 * commit from the bottom to it has passed, so the stack turns green from the bottom up while the
 * rest is gated, and failure on the head that holds a failed
 * commit and on each above it. It posts pending only where a commit is proved afresh, on that commit
 * and on each head from the one holding it up, so a red an earlier landing left clears once its fix
 * is being proved: `mergeable.yml` marks a pushed head pending, and until 28 October a rerun set every
 * proved head back to pending before its remembered passes turned it green again, so an unchanged
 * stack read as reset. A check belongs
 * to its commit, so a push leaves the new head without it and the pull request reads unproved again
 * (`mergeable.yml` marks it and the heads above it pending); a label would outlive the head it was
 * earned on (the operator, 27 October). That is how a stack shows it is ready. A pull request opens as a
 * draft, and the same success moves a draft to Ready for review, so a draft is one no landing has
 * proved yet (the operator, 27 October). `--merge` posts the same, and
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
 * is left alone. `--alone` merges anyway, on the operator's word, and that chain is replayed after
 * (operator, 27 October).
 *
 * Every pull request of the landing carries exactly one importance label, `importance:I0` to
 * `importance:I3`, which the operator ranks the stack by; since 25 October a title carries no "Ix:"
 * prefix in its place. It also carries at least one category label, the subject the operator files
 * it under (`CATEGORIES`, mostly the investigation's lane groups); on 27 October four pull requests
 * were opened with none. A landing in which any lacks either, or carries two importance labels, is
 * refused before anything is gated, in every mode, so `--sanitize` too shows a stack that is not
 * ready, and the refusal names each such pull request (`checkLabels`).
 *
 * A failure names the commit and the pull request it sits on. Its fix goes into that commit, the
 * pull requests above it are replayed on it (stack-pr, section 8), and a second landing runs only
 * what the replay moved. A commit whose runner gave no verdict is marked with an error instead, and
 * the landing asks only to be run again. The chain is read again as each commit's proof starts and
 * before each pull request turns green where a commit was proved since, in full only where a pull
 * request opened, closed or moved (`checkListed`), so a head that moved is landed as it stands, its newer
 * commits with it, before a stale commit is proved, up to `MOVES` times. Until 29 October it was read
 * only as a pull request turned green, so a head pushed while its own commits were gated had its old
 * commits proved first, its old top's whole gate among them. `--jobs N` gates up to N commits at once; the
 * top's whole CI gate runs alone.
 *
 * `ci.yml` is waited for in the open: the top's head carries a status of that name, pending while
 * the run goes and linked to it, since a dispatched run shows on no pull request, and on 28 October
 * a landing that reused a passed run read as one that merged without CI. A failed run brings its
 * failed jobs and the tail of their log home beside the gate's logs, and the refusal names the run
 * to rerun where its runner was at fault. `--merge --tag vX.Y.Z` cuts that release at the merge
 * commit, with the notes GitHub writes from the merged pull requests (`release`); a tag origin
 * holds already is refused before anything is gated.
 *
 * GitHub holds main to this command. Since 25 October the repository allows merge commits only,
 * and ruleset 25824510 on the default branch, with no bypass actors, refuses deleting main and any
 * non-fast-forward push to it (an author-identity fix rewrote main's history that day at 14:24Z),
 * and requires a pull request merged by the merge method with the status `ana/stack-gate`, which
 * only `--merge` posts (`STACK_CONTEXT`). `gh api repos/s-smits/anabasis/rulesets/25824510` reads
 * it. The one gap: a token with admin rights can post that status by hand.
 */
import { parseArgs, runtimeProcess } from "../../src/meta/process.ts";
import { decodeOutput, runSync } from "../../src/meta/subprocess.ts";
import { plural } from "../../src/meta/text.ts";
import { doubledLines } from "./doubled.ts";
import { gh, ghOrThrow, openPulls, type Pull } from "./pulls.ts";
import {
  addedLine,
  changesSource,
  failedLine,
  git,
  gitSays,
  type Proof,
  proveCommits,
  short,
} from "./gate.ts";

interface Landing {
  readonly trunk: string;
  readonly trunkSha: string;
  /** The open pull requests the landing merges, bottom to top; the last is the one named. */
  readonly pulls: readonly Pull[];
  /** The bottom of each other open chain on the trunk, with another pull request above it. */
  readonly beside: readonly Pull[];
  /** Every open pull request, as the landing read them. */
  readonly open: readonly Pull[];
}

interface Mode {
  readonly merge: boolean;
  readonly sanitize: boolean;
  readonly auto: boolean;
  readonly alone: boolean;
  readonly jobs: number;
  /** The release `--merge --tag` cuts at the merge. */
  readonly tag: string | null;
}

/** A commit status as GitHub's statuses API takes it; `link` is the target its Details opens. */
interface Status {
  readonly context: string;
  readonly state: string;
  readonly description: string;
  readonly link?: string | undefined;
}

const COMMIT_CONTEXT = "ana/commit";
const MERGEABLE_CONTEXT = "mergeable";
const STACK_CONTEXT = "ana/stack-gate";
const CI_CONTEXT = "ci.yml";
const CI_WORKFLOW = "ci.yml";
/** ANA_CI_POLL_MS shortens it for the tests that walk a run from queued to completed. */
const CI_POLL_MS = Number(runtimeProcess.env.ANA_CI_POLL_MS) || 20_000;
/** `ci.yml`'s jobs stop at 45 minutes; the rest is the macOS runner's queue. */
const CI_WAIT_MS = 75 * 60_000;
/** Each failed job of a `ci.yml` run, with its failed steps, one line each. */
const CI_FAILED = String.raw`.jobs[] | select(.conclusion == "failure") | "\(.name): \([.steps[] | select(.conclusion == "failure") | .name] | join(", "))"`;
/** How many of a failed run's last log lines a refusal prints; the whole log is kept beside the gate's. */
const CI_TAIL = 40;
/** How many times a landing reads its chain again after a head moved, before it refuses. */
const MOVES = 3;
/** A stack's merge is queued on GitHub's side and read back until it ends; stack 160's took a
 *  second. ANA_CI_POLL_MS shortens the poll for the tests as for `ci.yml`. */
const STACK_POLL_MS = Number(runtimeProcess.env.ANA_CI_POLL_MS) || 2000;
const STACK_WAIT_MS = 10 * 60_000;
/** Each status a GraphQL reading of commits finds, as `statusPoster` spells a status it posts. */
const SHOWN = String.raw`.data.repository[] | select(. != null) | .oid as $sha | (.status.contexts // [])[] | [$sha, .context, (.state | ascii_downcase), .description] | join("\t")`;
/** The labels that rank a pull request's importance; each of a landing carries exactly one. */
const IMPORTANCE = /^importance:I[0-3]$/u;
/** Subject labels: each pull request in a landing needs at least one. */
export const CATEGORIES = new Set([
  "harness",
  "climb",
  "comparison",
  "solve",
  "supply",
  "verdicts",
  "economy",
  "log",
  "runs",
  "landing",
  "quality",
  "docs",
  "misc",
]);
const USAGE =
  "usage: bun run land -- [<pull request>] [--auto] [--sanitize | --merge [--alone] [--tag vX.Y.Z]] [--jobs N]";
const TAG = /^v\d+\.\d+\.\d+$/u;

class Refusal extends Error {}
/** A head moved while the landing was proved. Passes are remembered by tree, so landing again costs
 *  only the moved commits; until 28 October it refused, and someone had to start it again. */
class Moved extends Refusal {}

const say = (line: string): void => console.log(`land: ${line}`);
const numbers = (pulls: readonly Pull[]): string => pulls.map((pull) => `#${String(pull.number)}`).join(", ");
// `{owner}/{repo}` is gh's own placeholder for the repository the working directory's remote names.
const api = (path: string): string => `repos/{owner}/{repo}/${path}`;

const trunkOf = (root: string): string =>
  ghOrThrow(root, ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);

/** The top of the longest chain of open pull requests above `from`, each based on the head of the
 *  one beneath it; `from` itself where none is. Of two chains of one length the older wins. */
export function topAbove(open: readonly Pull[], from: Pull): Pull {
  const chain = (pull: Pull, seen: readonly Pull[]): Pull[] => {
    const above = open
      .filter((child) => child.baseRefName === pull.headRefName && !seen.includes(child))
      .toSorted((one, other) => one.number - other.number)
      .map((child) => chain(child, [...seen, child]));
    return [
      pull,
      ...above.reduce<Pull[]>((longest, each) => (each.length > longest.length ? each : longest), []),
    ];
  };
  // SAFETY: a chain starts with `from`.
  return chain(from, [from]).at(-1) as Pull;
}

/** The top of the stack that holds the oldest stacked pull request: a bottom on the trunk with
 *  another pull request above it. */
function oldestStack(root: string): number {
  const open = openPulls(root);
  const trunk = trunkOf(root);
  const [bottom] = open
    .filter(
      (pull) => pull.baseRefName === trunk && open.some((above) => above.baseRefName === pull.headRefName),
    )
    .toSorted((one, other) => one.number - other.number);
  if (bottom === undefined) {
    throw new Refusal(`no stacked pull request is open on ${trunk}. Name one to land.`);
  }
  return topAbove(open, bottom).number;
}

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
  const trunk = trunkOf(root);
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
  return { trunk, trunkSha, pulls, beside, open };
}

/** The importance labels a pull request carries; a landing asks for exactly one. */
export const ranksOf = (pull: Pull): string[] =>
  pull.labels.map((label) => label.name).filter((name) => IMPORTANCE.test(name));

/** Refuses a landing in which a pull request carries no importance label or more than one, or no
 *  category label. */
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

/** The last merge has the top's tree only when each head contains the one beneath it, down to the
 *  trunk's current head, and each pull request shows its own commits only when its head holds no
 *  other open one's off its chain (`doubled.ts`). */
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
  const repeating = doubledLines(root, landing.open, (pull) => landing.pulls.includes(pull));
  if (repeating.length > 0) throw new Refusal(`${repeating.join(" ")} Land again.`);
}

function postStatus(root: string, sha: string, { context, state, description, link }: Status): boolean {
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
    ...(link === undefined ? [] : ["-f", `target_url=${link}`]),
  ]).ok;
}

/** `postStatus`, passing over what GitHub shows already on `shas`, read in one GraphQL call: on 30
 *  October a landing over remembered passes posted 81 statuses one by one, about 0.6 s each, every
 *  one shown already, where one reading of the 64 commits took 0.9 s. Unread, every status is posted. */
function statusPoster(root: string, shas: readonly string[]): (sha: string, status: Status) => void {
  const objects = shas.map(
    (sha, index) =>
      `c${String(index)}: object(oid: "${sha}") { ... on Commit { oid status { contexts { context state description } } } }`,
  );
  const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${objects.join(" ")} } }`;
  const args = ["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "--jq", SHOWN];
  const read = shas.length === 0 ? null : gh(root, [...args, "-f", `query=${query}`]);
  const shown = new Set(read?.ok === true ? read.out.split("\n") : []);
  return (sha, status) => {
    const row = [sha, status.context, status.state, status.description].join("\t");
    if (!shown.has(row) && postStatus(root, sha, status)) shown.add(row);
  };
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
    "status,conclusion,databaseId,url,createdAt",
    "--jq",
    String.raw`[.[] | select(.conclusion != "cancelled")] | first // empty | [.status, .conclusion, .databaseId, .url, .createdAt] | map(tostring) | join("\t")`,
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
  if (ci !== null) {
    const [status, conclusion, id, url, at] = ci;
    say(
      `${CI_WORKFLOW} run ${id ?? ""} of ${at ?? "an earlier landing"} is already on ${head}, ${conclusion === undefined || conclusion === "" ? status : conclusion}; its verdict stands: ${url ?? ""}`,
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
  ghOrThrow(root, ["workflow", "run", CI_WORKFLOW, "--ref", top.headRefName]);
  say(`dispatched ${CI_WORKFLOW} on ${head}; it runs while the commits are gated here.`);
}

/** Waits for `ci.yml` on the top's head and shows its verdict there as the check `ci.yml`, linked to
 *  its run: a run `land` dispatches is no pull request's run, so GitHub lists it on no pull request,
 *  and on 28 October a merge after a passed run read as one made without CI. */
async function awaitCi(root: string, top: Pull): Promise<void> {
  const deadline = Date.now() + CI_WAIT_MS;
  let ci = ciRun(root, top.headRefOid);
  const show = (state: string, description: string): void => {
    postStatus(root, top.headRefOid, { context: CI_CONTEXT, state, description, link: ci?.[3] });
  };
  if (ci?.[0] !== "completed") show("pending", "waiting for the ci.yml run that bun run land started");
  while (ci?.[0] !== "completed" && Date.now() < deadline) {
    await Bun.sleep(CI_POLL_MS);
    ci = ciRun(root, top.headRefOid) ?? ci;
  }
  const [status, conclusion, id = "", url] = ci ?? [];
  const head = `#${String(top.number)}'s head ${short(top.headRefOid)}`;
  if (conclusion === "success") {
    show("success", `ci.yml run ${id} passed on this head`);
    say(`${CI_WORKFLOW} passed on ${head}: ${url ?? ""}`);
    return;
  }
  show(
    status === "completed" ? "failure" : "pending",
    `ci.yml run ${id} ${conclusion === undefined || conclusion === "" ? "has not finished" : conclusion}`,
  );
  if (status !== "completed") {
    throw new Refusal(
      `${CI_WORKFLOW} on ${head} has not finished: ${url ?? "no run has started"}. Land again once it has.`,
    );
  }
  // The failed jobs' own output, fetched here so the fix starts from it rather than from a link.
  const steps = gh(root, ["run", "view", id, "--json", "jobs", "--jq", CI_FAILED]).out;
  const fetched = gh(root, ["run", "view", id, "--log-failed"]);
  const failed = fetched.ok ? fetched.out : `gh could not fetch the failed jobs' log: ${fetched.err}`;
  const logs = git(root, ["rev-parse", "--path-format=absolute", "--git-path", "ana-gate"]);
  const log = `${logs}/land-ci-${short(top.headRefOid)}.log`;
  await Bun.write(log, `${failed}\n`);
  if (steps !== "") console.error(steps);
  console.error(failed.split("\n").slice(-CI_TAIL).join("\n"));
  throw new Refusal(
    `${CI_WORKFLOW} ended ${conclusion ?? ""} on ${head}: ${url ?? ""}. Its failed jobs' log: ${log}. Fix the ` +
      `commit it names, or run gh run rerun ${id} if the runner was at fault, and land again.`,
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
 *  to a tree other than the top's, which is the one the CI gate read. */
async function mergeStack(
  root: string,
  landing: Landing,
  stack: number | null,
): Promise<{ readonly ended: "merged" | "refused" | "unsure"; readonly sha: string }> {
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
        `land: GitHub's merge of ${name} ${why}; the statuses stand. Read ${landing.trunk} and the stack before ` +
          `anything lands.`,
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

/** The open pull requests by number, base and head, which say whether any of them moved. */
const placesOf = (pulls: readonly Pull[]): string =>
  pulls
    .map((pull) => `${String(pull.number)} ${pull.baseRefName} ${pull.headRefOid}`)
    .toSorted()
    .join("\n");

/** `checkCurrent`, read in full only where GitHub's one list of open pull requests, about 0.8 s,
 *  differs from the landing's; the full reading adds the trunk's head, two fetches and the doubled
 *  lines, about 3 s. On 30 October a landing of 17 pull requests, every pass remembered, read the
 *  chain in full 17 times before its first commit was proved afresh. */
function checkListed(root: string, target: number, landing: Landing): void {
  if (placesOf(openPulls(root)) !== placesOf(landing.open)) checkCurrent(root, target, landing);
}

/** Refuses a proof whose chain has moved before a commit's proof starts or a success is published. */
function checkCurrent(root: string, target: number, landing: Landing): void {
  const again = readLanding(root, target);
  checkChain(root, again);
  if (
    again.pulls.map((pull) => pull.headRefOid).join() !== landing.pulls.map((pull) => pull.headRefOid).join()
  ) {
    throw new Moved("a pull request's head moved while its commits were gated.");
  }
}

/** Posts the required status on every head, then merges the top with the stack beneath it, and
 *  gives the merge commit. A merge that does not go through takes the status back from every head. */
async function merge(root: string, target: number, landing: Landing): Promise<string | null> {
  checkCurrent(root, target, landing);
  const heads = landing.pulls.map((pull) => pull.headRefOid);
  const stack = stackOf(root, landing);
  const revoke = (): void => {
    const waiting = { context: STACK_CONTEXT, state: "pending", description: "Waiting for bun run land" };
    for (const sha of heads) postStatus(root, sha, waiting);
  };
  const proved = "every commit passed on its own; the top passed the whole gate here and ci.yml on GitHub";
  if (
    !heads.every((sha) =>
      postStatus(root, sha, { context: STACK_CONTEXT, state: "success", description: proved }),
    )
  ) {
    revoke();
    throw new Error(`the ${STACK_CONTEXT} status could not be posted on every head`);
  }
  const { ended, sha } = await mergeStack(root, landing, stack);
  if (ended === "refused") {
    revoke();
    console.error(
      `land: nothing merged; ${numbers(landing.pulls)} ${landing.pulls.length === 1 ? "is" : "are"} open.`,
    );
  }
  return ended === "merged" ? sha : null;
}

/** Cuts the release at the merge the landing made, with the notes GitHub writes from the pull
 *  requests it merged; they can be rewritten on the release afterwards. Until 28 October the release
 *  was a step by hand after each landing (run-improvement-campaign), taken from main's head rather
 *  than the gated merge (the operator, 28 October). */
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

/** Whether a pull request was stacked on the landing's top since it was read. */
const moved = (root: string, top: Pull): boolean => topAbove(openPulls(root), top).number !== top.number;

/** Proves, and with `--merge` merges, the landing up to `target`; `moved` where `--auto` found a
 *  new top before the landing ended. */
async function landTo(root: string, target: number, mode: Mode): Promise<number | "moved"> {
  const landing = readLanding(root, target);
  checkLabels(landing);
  checkChain(root, landing);
  // SAFETY: readLanding's chain ends with the named pull request.
  const top = landing.pulls.at(-1) as Pull;
  const [chain] = landing.beside;
  if (mode.merge && !mode.alone && chain !== undefined) {
    throw new Refusal(
      `#${String(chain.number)} (${chain.headRefName}) starts another chain on ${landing.trunk}, which this merge ` +
        `would leave short of ${landing.trunk}'s new head, so that every pull request on it has to be replayed. ` +
        `Put ${numbers(landing.pulls)} on that chain's top, land that chain first, or name --alone to merge it anyway.`,
    );
  }
  if (mode.merge) {
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
  const reach = mode.merge || mode.sanitize;
  const post = statusPoster(root, reach ? proofs.map(({ commit }) => commit) : []);
  // A pull request turns green as soon as every commit from the bottom to its head has passed,
  // so the stack shows its proof climbing while the commits above are still being gated.
  const at = new Map(proofs.map((proof, index) => [proof.commit, index]));
  const passed = new Set<string>();
  // The last reading of the open pull requests stands until a commit has been proved since: a
  // remembered verdict takes no time, so the heads it turns green are read for once, not one by one.
  const proving = new Set<string>();
  let settled = true;
  let green = 0;
  let pending = landing.pulls.length;
  const greenUpTo = (): void => {
    const unproved = proofs.findIndex((proof) => !passed.has(proof.commit));
    const upTo = unproved === -1 ? proofs.length : unproved;
    for (let pull = landing.pulls[green]; pull !== undefined; pull = landing.pulls[green]) {
      if ((at.get(pull.headRefOid) ?? upTo) >= upTo) return;
      if (!settled) checkListed(root, target, landing);
      settled = true;
      post(pull.headRefOid, {
        context: MERGEABLE_CONTEXT,
        state: "success",
        description: "every commit up to this head passed bun run land",
      });
      if (pull.isDraft && !gh(root, ["pr", "ready", String(pull.number)]).ok) {
        say(
          `#${String(pull.number)} passed, and stays a draft: gh pr ready ${String(pull.number)} was refused.`,
        );
      }
      green += 1;
    }
  };
  const failed = await proveCommits(root, proofs, {
    who: "land",
    jobs: mode.jobs,
    say,
    mark: (commit, state, description) => {
      if (state === "pending") {
        checkListed(root, target, landing);
        proving.add(commit);
      }
      settled = state === "pending" || (settled && !proving.has(commit));
      if (!reach) return;
      post(commit, { context: COMMIT_CONTEXT, state, description });
      // A head that holds a commit proved again reads pending until it passes, not an earlier red.
      const from = state === "pending" ? Math.max(green, holding(root, landing, commit)) : pending;
      for (const pull of landing.pulls.slice(from, pending)) {
        post(pull.headRefOid, {
          context: MERGEABLE_CONTEXT,
          state: "pending",
          description: "bun run land is proving it",
        });
      }
      pending = Math.min(pending, from);
      if (state === "success") passed.add(commit);
      greenUpTo();
    },
  });
  if (failed === null && mode.auto && moved(root, top)) return "moved";
  if (failed !== null) {
    for (const pull of reach ? landing.pulls.slice(holding(root, landing, failed.commit)) : []) {
      const description = failed.verdict
        ? `${short(failed.commit)} fails ${failed.step} on its own`
        : `${short(failed.commit)} got no verdict on ${failed.step}: land again`;
      post(pull.headRefOid, {
        context: MERGEABLE_CONTEXT,
        state: failed.verdict ? "failure" : "error",
        description,
      });
    }
    if (failed.verdict) recipe(root, landing, failed.commit);
    console.error(
      `land: ${failedLine(failed)}. Nothing was merged.${failed.verdict ? "" : " Land again."} Log: ${failed.log}`,
    );
    return 1;
  }
  if (!mode.merge) {
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
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      merge: { type: "boolean", default: false },
      sanitize: { type: "boolean", default: false },
      auto: { type: "boolean", default: false },
      alone: { type: "boolean", default: false },
      jobs: { type: "string", default: "1" },
      tag: { type: "string" },
    },
    allowPositionals: true,
  });
  const named = positionals[0] === undefined ? null : Number(positionals[0]);
  const jobs = Number(values.jobs);
  if (
    (named !== null && (!Number.isInteger(named) || named <= 0)) ||
    positionals.length > 1 ||
    !Number.isInteger(jobs) ||
    jobs <= 0 ||
    (values.tag !== undefined && (!values.merge || !TAG.test(values.tag)))
  ) {
    console.error(USAGE);
    return 2;
  }
  const root = git(runtimeProcess.cwd(), ["rev-parse", "--show-toplevel"]);
  const mode = {
    merge: values.merge,
    sanitize: values.sanitize,
    auto: values.auto || named === null,
    alone: values.alone,
    jobs,
    tag: values.tag ?? null,
  };
  try {
    // A release the merge could not take is refused before anything is gated.
    // `--exit-code` exits 2 where origin holds no such ref; any other failure says nothing of the tag.
    const tagged =
      mode.tag === null
        ? 2
        : runSync(["git", "ls-remote", "--exit-code", "--tags", "origin", mode.tag], { cwd: root }).exitCode;
    if (tagged === 0) throw new Refusal(`${String(mode.tag)} is already a tag on origin.`);
    if (tagged !== 2) throw new Refusal(`origin could not be asked whether it holds ${String(mode.tag)}.`);
    let target = named ?? oldestStack(root);
    for (let moves = 0; ; ) {
      if (mode.auto) {
        const open = openPulls(root);
        const wanted = target;
        const from = open.find((pull) => pull.number === wanted);
        if (from !== undefined) target = topAbove(open, from).number;
      }
      const ended = await landTo(root, target, mode).catch((error: unknown) => {
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
  }
}

if (import.meta.main) runtimeProcess.exit(await main(Bun.argv.slice(2)));
