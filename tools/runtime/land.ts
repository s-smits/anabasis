/**
 * Lands a pull request, with every unmerged one beneath it in its stack, on the stack's trunk. It
 * is the one merge path main's ruleset leaves open.
 *
 * A push gates only what it changed: a commit whose patch the remote already held is a replay, and
 * the pre-push hook leaves it alone. So this is where each commit the merge would publish is proved
 * on its own bytes, and by its own gate — the static steps and the tests one import from what it
 * changed — and where the top's head gets the whole gate. The bottom must contain the trunk's head,
 * which makes the merge commit's tree exactly the top's, so the whole gate on that head is the whole
 * gate on the trunk after the merge. With `--sanitize` or `--merge`, every commit that passes shows it
 * on GitHub as `ana/commit`; without either, the script writes nothing to GitHub. `--sanitize` proves
 * the stack mergeable and stops there.
 *
 * `--sanitize` and `--merge` also need the Actions gate (`gate.yml`) to pass on the top's head, since only
 * it shows the Linux isolation and a clean runner. Unless a run on that head exists, they dispatch one
 * before gating the commits here, so it runs meanwhile, and wait for it after them. A failed run is not
 * dispatched again, since nothing about its head changed.
 *
 * Main's ruleset requires `ana/stack-gate` on every pull request a merge lands, and nothing but this
 * script posts it: after every commit and the Actions gate have passed, on heads it has just read
 * again, immediately before its own merge request. A merge that does not go through sets them back to
 * pending, so the Merge button, `gh stack merge` and a raw API call stay refused until the next land.
 *
 * What it lands is this clone's `land/<ref>` branch for each pull request, made from GitHub's head the
 * first time. A fix goes into the commit that failed, and the rebase it prints carries it across every
 * `land/` branch above that commit and no other branch, so the fixes wait here, gated, until one push
 * publishes them; `--sanitize` and `--merge` refuse a branch GitHub does not have yet.
 *
 * `--jobs N` gates up to N commits at once; the top's whole gate still runs alone.
 *
 *   bun run land -- <pull request> [--sanitize | --merge] [--jobs N]
 */
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
} from "../../src/meta/filesystem.ts";
import { capturedJsonParse } from "../../src/meta/json-runtime.ts";
import { asRecord, isString } from "../../src/meta/json-shape.ts";
import { tmpdir } from "../../src/meta/os.ts";
import { join } from "../../src/meta/path.ts";
import { parseArgs, runtimeProcess } from "../../src/meta/process.ts";

const STACK_CONTEXT = "ana/stack-gate";
const COMMIT_CONTEXT = "ana/commit";
/** What a recorded pass proved, as its `ana/commit` status says it, whether it ran now or earlier. */
const PROVED: Record<Mode, string> = {
  "--static": "its static steps and nearby tests passed on its own checkout",
  "--at": "passed the whole gate",
};
const POLL_MS = 2000;
const MERGE_WAIT_MS = 15 * 60_000;
const CI_WORKFLOW = "gate.yml";
/** ANA_CI_POLL_MS shortens it for the tests that walk a run from queued to completed. */
const CI_POLL_MS = Number(runtimeProcess.env.ANA_CI_POLL_MS) || 20_000;
/** The gate's jobs stop at 45 minutes; the rest is the macOS runner's queue. */
const CI_WAIT_MS = 75 * 60_000;
const FIELDS = String.raw`map(tostring) | join("\t")`;
const WORKBENCH = "land/";
// The rebase's sequence editor: of the branches `--update-refs` would move, it keeps the `land/` ones,
// so a branch someone else made at a pull request's head stays where it was.
const KEEP_WORKBENCH = String.raw`sed -i.bak -e '/^update-ref refs\/heads\/land\//b' -e '/^update-ref /d'`;

interface Pull {
  number: number;
  ref: string;
  /** The head GitHub holds. */
  pushed: string;
  /** The head this clone lands, its `land/<ref>` branch. */
  sha: string;
}

interface Landing {
  trunk: string;
  trunkSha: string;
  /** The unmerged pull requests the merge lands, bottom to top; the last is the one named. */
  pulls: Pull[];
}

type Mode = "--static" | "--at";
/** Whether each commit's verdict is posted on GitHub or kept in this clone. */
type Reach = "github" | "local";

interface Ran {
  ok: boolean;
  out: string;
  err: string;
}

/** What merge-async answered: its status, the request to poll while pending, and what it says. */
interface MergeAnswer {
  status: string;
  uuid: string;
  message: string;
}

class Refusal extends Error {}

function run(cwd: string, command: readonly string[]): Ran {
  const result = Bun.spawnSync([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    ok: result.exitCode === 0,
    out: result.stdout.toString().trim(),
    err: result.stderr.toString().trim(),
  };
}

function must(cwd: string, command: readonly string[]): string {
  const result = run(cwd, command);
  if (!result.ok) throw new Error(`${command.join(" ")}: ${result.err}`);
  return result.out;
}

const lines = (text: string): string[] => text.split("\n").filter((line) => line.length > 0);
const short = (sha: string): string => sha.slice(0, 9);
const say = (line: string): void => console.log(`land: ${line}`);

// `{owner}/{repo}` is gh's own placeholder for the repository the working directory's remote names.
const api = (path: string): string => `repos/{owner}/{repo}/${path}`;

/** The pull request named and every unmerged one beneath it, read from GitHub bottom to top. */
function readLanding(root: string, target: number): Landing {
  const [state, draft, base, ref, sha, stack] = must(root, [
    "gh",
    "api",
    api(`pulls/${target}`),
    "--jq",
    `[.state, .draft, .base.ref, .head.ref, .head.sha, .stack.number] | ${FIELDS}`,
  ]).split("\t");
  const rows =
    stack === "null"
      ? [base ?? "", [target, state, draft, "null", ref, sha].join("\t")]
      : lines(
          must(root, [
            "gh",
            "api",
            api(`stacks/${stack}`),
            "--jq",
            `.base.ref, (.pull_requests[] | [.number, .state, .draft, .merged_at, .head.ref, .head.sha] | ${FIELDS})`,
          ]),
        );
  const [trunk = "", ...members] = rows;
  const pulls: Pull[] = [];
  for (const member of members) {
    const [number, memberState, memberDraft, mergedAt, memberRef = "", memberSha = ""] = member.split("\t");
    if (mergedAt !== "null") continue;
    if (memberState !== "open" || memberDraft !== "false") {
      throw new Refusal(
        `#${number} is ${memberState === "open" ? "a draft" : "closed"}, and it sits beneath #${target}.`,
      );
    }
    pulls.push({ number: Number(number), ref: memberRef, pushed: memberSha, sha: memberSha });
    if (Number(number) === target) break;
  }
  if (pulls.at(-1)?.number !== target) {
    throw new Refusal(`#${target} is not an open pull request waiting to merge.`);
  }
  const trunkSha = must(root, ["git", "ls-remote", "origin", `refs/heads/${trunk}`]).split("\t")[0] ?? "";
  must(root, ["git", "fetch", "-q", "origin", trunkSha, ...pulls.map((pull) => pull.pushed)]);
  return { trunk, trunkSha, pulls };
}

/** Points each pull request at its `land/<ref>` branch, making it from GitHub's head the first time. A
 *  branch GitHub's head has grown past holds nothing GitHub lacks, so it moves up to that head, unless
 *  a checkout holds it. Any other branch that never held GitHub's head was made before someone else
 *  pushed, and its fixes would overwrite what they pushed. */
function useWorkbench(root: string, landing: Landing): Landing {
  const pulls = landing.pulls.map((pull) => {
    const branch = `${WORKBENCH}${pull.ref}`;
    const local = run(root, ["git", "rev-parse", "-q", "--verify", `refs/heads/${branch}`]);
    if (!local.ok) {
      must(root, ["git", "branch", branch, pull.pushed]);
      return pull;
    }
    if (
      local.out !== pull.pushed &&
      run(root, ["git", "merge-base", "--is-ancestor", local.out, pull.pushed]).ok &&
      run(root, ["git", "branch", "-f", branch, pull.pushed]).ok
    ) {
      return pull;
    }
    const held = lines(must(root, ["git", "reflog", "show", "--format=%H", `refs/heads/${branch}`]));
    if (local.out !== pull.pushed && !held.includes(pull.pushed)) {
      throw new Refusal(
        `#${pull.number}'s head moved on GitHub to ${short(pull.pushed)} after ${branch} was made. Fold that ` +
          `in, or delete ${branch} to start again from it, and land again.`,
      );
    }
    return { ...pull, sha: local.out };
  });
  return { ...landing, pulls };
}

/** One atomic push of every `land/` branch GitHub does not have, each leased on the head land read. */
const pushCommand = (pulls: readonly Pull[]): string =>
  [
    "git push --atomic",
    ...pulls.map((pull) => `--force-with-lease=refs/heads/${pull.ref}:${pull.pushed}`),
    "origin",
    ...pulls.map((pull) => `${WORKBENCH}${pull.ref}:refs/heads/${pull.ref}`),
  ].join(" ");

/** The merge commit has the top's tree only when each head contains the one beneath it, down to the
 *  trunk's current head. */
function checkChain(root: string, landing: Landing): void {
  let below = { name: `${landing.trunk}'s head`, sha: landing.trunkSha };
  for (const pull of landing.pulls) {
    if (!run(root, ["git", "merge-base", "--is-ancestor", below.sha, pull.sha]).ok) {
      throw new Refusal(
        `#${pull.number} (${pull.ref}) does not contain ${below.name} ${short(below.sha)}. Replay it and every ` +
          `pull request above it on what is beneath it, push them together, and land again.`,
      );
    }
    below = { name: `#${pull.number}'s head`, sha: pull.sha };
  }
}

/** The documentation set is the pre-push hook's: the paths its `changes_source` excludes. */
function documentationPathspecs(): string[] {
  const hook = readFileSync(join(import.meta.dir, "..", "..", ".githooks", "pre-push"), "utf8");
  const pathspecs = [...hook.matchAll(/'(:\(exclude\)[^']+)'/g)].map((match) => match[1] ?? "");
  if (pathspecs.length === 0) throw new Error("the pre-push hook names no documentation paths");
  return pathspecs;
}

/** Each commit the merge publishes, with the pass it needs, or null for one changing documentation
 *  alone, which the static steps have nothing to read in. */
function plan(root: string, landing: Landing): [string, Mode | null][] {
  const top = landing.pulls.at(-1)?.sha ?? "";
  const pathspecs = documentationPathspecs();
  const commits = lines(
    must(root, ["git", "rev-list", "--reverse", "--topo-order", top, "--not", landing.trunkSha]),
  );
  return commits.map((commit) => {
    if (commit === top) return [commit, "--at"];
    const parent = run(root, ["git", "rev-parse", "-q", "--verify", `${commit}^1`]);
    const source =
      !parent.ok || !run(root, ["git", "diff", "--quiet", parent.out, commit, "--", ".", ...pathspecs]).ok;
    return [commit, source ? "--static" : null];
  });
}

function postStatus(root: string, sha: string, context: string, state: string, description: string): boolean {
  return run(root, [
    "gh",
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

/** Runs each commit's own gate over a checkout of it, up to `jobs` at once, the passes remembered
 *  where the pre-push hook keeps its own. The top's whole gate runs alone, once every commit beneath it
 *  has passed. Nothing new starts after a failure, since every commit above a fix changes id with it,
 *  and the lowest commit that failed is returned. */
async function firstFailure(
  root: string,
  steps: readonly [string, Mode | null][],
  reach: Reach,
  jobs: number,
): Promise<string | null> {
  const mark = (commit: string, state: string, description: string): void => {
    if (reach === "github") postStatus(root, commit, COMMIT_CONTEXT, state, description);
  };
  const record = join(
    must(root, ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"]),
    "ana-gate-passed",
  );
  const logs = must(root, ["git", "rev-parse", "--path-format=absolute", "--git-path", "ana-gate"]);
  mkdirSync(logs, { recursive: true });
  let passed: string[];
  try {
    passed = lines(readFileSync(record, "utf8"));
  } catch {
    passed = [];
  }
  const free: string[] = [];
  const made: string[] = [];
  const failed: number[] = [];
  const gate = async (index: number, commit: string, mode: Mode): Promise<void> => {
    const at = `${index + 1} of ${steps.length}, ${short(commit)}`;
    const tree = free.pop() ?? mkdtempSync(join(tmpdir(), "ana-land-"));
    if (!made.includes(tree)) {
      made.push(tree);
      must(root, ["git", "worktree", "add", "-q", "--detach", tree, commit]);
    }
    try {
      must(tree, ["git", "checkout", "-q", "--detach", commit]);
      const log = join(logs, `land-${short(commit)}-${Date.now()}.log`);
      say(
        `${at}: ${mode === "--at" ? "the whole gate, as the top's head" : "the static steps and its nearby tests"}. Log: ${log}`,
      );
      const fd = openSync(log, "w");
      const child = Bun.spawn(["bun", "run", "gate", mode, tree], {
        cwd: tree,
        env: { ...runtimeProcess.env, ANA_TESTED_COMMIT: commit },
        stdout: fd,
        stderr: fd,
      });
      const code = await child.exited;
      closeSync(fd);
      if (code === 0) {
        appendFileSync(record, `${commit} ${mode}\n`);
        mark(commit, "success", PROVED[mode]);
        say(`${at}: passed.`);
        return;
      }
      failed.push(index);
      mark(commit, "failure", "failed on its own; see bun run land");
      const output = lines(readFileSync(log, "utf8"));
      const step = output.map((line) => /^gate: step ([a-z-]+) failed/.exec(line)?.[1]).findLast(isString);
      console.error(output.slice(-30).join("\n"));
      console.error(
        `land: ${short(commit)} FAILS ${step ?? "the gate"} ON ITS OWN. Nothing was merged. Log: ${log}`,
      );
    } finally {
      // A file the gate left behind would sit in the next commit's checkout, which that commit does
      // not hold; such a tree is removed at the end rather than handed on.
      const left = run(tree, ["git", "status", "--porcelain"]);
      if (left.ok && left.out === "") free.push(tree);
    }
  };
  const running = new Set<Promise<void>>();
  try {
    for (const [index, [commit, mode]] of steps.entries()) {
      const proved = passed.includes(`${commit} --at`)
        ? "--at"
        : passed.includes(`${commit} ${mode}`)
          ? mode
          : null;
      if (mode === null || proved !== null) {
        say(
          `${index + 1} of ${steps.length}, ${short(commit)}: ${mode === null ? "documentation only" : "passed earlier on these exact bytes"}.`,
        );
        mark(commit, "success", proved === null ? "documentation only" : PROVED[proved]);
        continue;
      }
      if (mode === "--at") await Promise.all(running);
      while (running.size >= jobs) await Promise.race(running);
      if (failed.length > 0) break;
      const task: Promise<void> = gate(index, commit, mode).then(() => {
        running.delete(task);
      });
      running.add(task);
    }
    await Promise.all(running);
    return failed.length === 0 ? null : (steps[Math.min(...failed)]?.[0] ?? null);
  } finally {
    for (const tree of made) run(root, ["git", "worktree", "remove", "--force", tree]);
  }
}

/** The newest Actions gate run on `sha` that a later dispatch did not cancel, as its status,
 *  conclusion, id and link; null when there is none, so land dispatches one; undefined when GitHub
 *  did not answer, which is never read as "none". A dispatched run always runs both jobs, and the gate
 *  runs on no other event for a pull request's head. */
function ciRun(root: string, sha: string): string[] | null | undefined {
  const read = run(root, [
    "gh",
    "run",
    "list",
    "--workflow",
    CI_WORKFLOW,
    "--commit",
    sha,
    "--json",
    "status,conclusion,databaseId,url",
    "--jq",
    `[.[] | select(.conclusion != "cancelled")] | first // empty | [.status, .conclusion, .databaseId, .url] | ${FIELDS}`,
  ]);
  if (!read.ok) return undefined;
  return read.out === "" ? null : read.out.split("\t");
}

/** Dispatches the Actions gate on the top's head unless a run is already there. */
function startCi(root: string, top: Pull): void {
  const ci = ciRun(root, top.sha);
  if (ci === undefined) {
    throw new Refusal(`GitHub did not list the Actions gate's runs on ${short(top.sha)}. Land again.`);
  }
  if (ci !== null) return;
  must(root, ["gh", "workflow", "run", CI_WORKFLOW, "--ref", top.ref]);
  say(
    `dispatched the Actions gate on #${top.number}'s head ${short(top.sha)}; it runs while the commits are gated here.`,
  );
}

function awaitCi(root: string, top: Pull): void {
  const deadline = Date.now() + CI_WAIT_MS;
  let ci = ciRun(root, top.sha);
  while (ci?.[0] !== "completed" && Date.now() < deadline) {
    Bun.sleepSync(CI_POLL_MS);
    const next = ciRun(root, top.sha);
    if (next !== undefined) ci = next;
  }
  const [status, conclusion, id, url] = ci ?? [];
  const head = `#${top.number}'s head ${short(top.sha)}`;
  if (conclusion === "success") {
    say(`the Actions gate passed on ${head}: ${url}`);
    return;
  }
  throw new Refusal(
    status === "completed"
      ? `the Actions gate ended ${conclusion} on ${head}: ${url}. Fix the commit it names, or run ` +
          `gh run rerun ${id} if the runner was at fault, and land again.`
      : `the Actions gate on ${head} has not finished: ${url ?? "no run has started"}. Land again once it has.`,
  );
}

function mergeAnswer(text: string, fallback: string): MergeAnswer {
  let body: ReturnType<typeof asRecord>;
  try {
    body = asRecord(capturedJsonParse(text));
  } catch {
    body = null;
  }
  const details = asRecord(body?.details);
  const status = body?.status;
  const uuid = details?.uuid;
  const message = details?.message ?? details?.sha;
  return {
    status: isString(status) ? status : "failed",
    uuid: isString(uuid) ? uuid : "",
    message: isString(message) ? message : fallback,
  };
}

/** Posts the required status on every head it lands, asks GitHub to merge the named pull request at
 *  exactly the gated head, and waits for the answer. Anything short of a merge takes the statuses
 *  back. */
function merge(root: string, target: number, landing: Landing): boolean {
  const again = readLanding(root, target);
  checkChain(root, again);
  if (again.pulls.map((pull) => pull.sha).join() !== landing.pulls.map((pull) => pull.sha).join()) {
    throw new Refusal("a pull request's head moved while its commits were gated. Land again.");
  }
  const top = landing.pulls.at(-1)?.sha ?? "";
  const heads = landing.pulls.map((pull) => pull.sha);
  const revoke = (): void => {
    for (const sha of heads) postStatus(root, sha, STACK_CONTEXT, "pending", "Waiting for bun run land");
  };
  for (const sha of heads) {
    if (
      postStatus(
        root,
        sha,
        STACK_CONTEXT,
        "success",
        "every commit passed on its own; the top passed the whole gate here and on Actions",
      )
    ) {
      continue;
    }
    revoke();
    throw new Error(`the ${STACK_CONTEXT} status could not be posted on ${short(sha)}`);
  }
  const submitted = run(root, [
    "gh",
    "api",
    "-X",
    "PUT",
    api(`pulls/${target}/merge-async`),
    "-f",
    "merge_method=merge",
    "-f",
    `sha=${top}`,
  ]);
  let answer = mergeAnswer(submitted.out, submitted.err);
  const poll = api(`pulls/${target}/merge-async/${answer.uuid}`);
  const deadline = Date.now() + MERGE_WAIT_MS;
  while (answer.status === "pending" && Date.now() < deadline) {
    Bun.sleepSync(POLL_MS);
    const polled = run(root, ["gh", "api", poll]);
    // A poll that could not be read says nothing about the merge, which GitHub is still running:
    // taking the statuses back on it would refuse a merge that was about to go through.
    if (polled.ok) answer = mergeAnswer(polled.out, polled.err);
    else answer = { ...answer, message: `its last poll could not be read: ${polled.err}` };
  }
  const numbers = landing.pulls.map((pull) => `#${pull.number}`).join(", ");
  if (answer.status === "merged" || answer.status === "enqueued") {
    say(`${numbers} ${answer.status} into ${landing.trunk}: ${answer.message}`);
    return true;
  }
  revoke();
  console.error(`land: GitHub did not merge ${numbers} (${answer.status}): ${answer.message}`);
  return false;
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
    console.error("usage: bun run land -- <pull request> [--sanitize | --merge] [--jobs N]");
    return 2;
  }
  const root = must(runtimeProcess.cwd(), ["git", "rev-parse", "--show-toplevel"]);
  try {
    const landing = useWorkbench(root, readLanding(root, target));
    checkChain(root, landing);
    const reach = values.merge === true || values.sanitize === true ? "github" : "local";
    const unpushed = landing.pulls.filter((pull) => pull.sha !== pull.pushed);
    if (reach === "github" && unpushed.length > 0) {
      throw new Refusal(
        `GitHub does not have the fixes on ${WORKBENCH} yet. Push them first: ${pushCommand(unpushed)}`,
      );
    }
    const steps = plan(root, landing);
    say(
      `${landing.pulls.map((pull) => `#${pull.number}`).join(", ")} onto ${landing.trunk} ${short(landing.trunkSha)}: ` +
        `${steps.length} commits.`,
    );
    // SAFETY: readLanding refuses a landing whose last pull request is not the one named.
    const top = landing.pulls.at(-1) as Pull;
    if (reach === "github") startCi(root, top);
    const failed = await firstFailure(root, steps, reach, jobs);
    if (failed !== null) {
      const at = short(failed);
      console.error(
        `land: the fix belongs in ${at}, not on top. Stage it in a checkout of ${WORKBENCH}${landing.pulls.at(-1)?.ref}, then:`,
      );
      console.error(`land:   git commit --fixup=${at}`);
      console.error(
        `land:   GIT_SEQUENCE_EDITOR="${KEEP_WORKBENCH}" git rebase -i --autosquash --update-refs ${at}~1`,
      );
      console.error(
        `land: the ${WORKBENCH} branches above ${at} move with it, the commits below keep their ids and passes. Land again.`,
      );
      return 1;
    }
    if (unpushed.length > 0) {
      say(`every commit passed. Publish the fixes: ${pushCommand(unpushed)}`);
      return 0;
    }
    if (reach === "github") awaitCi(root, top);
    if (values.merge !== true) {
      const next =
        reach === "github" ? `each shows ${COMMIT_CONTEXT} on GitHub` : `--sanitize shows it on GitHub`;
      say(
        `every commit passed; ${next}. bun run land -- ${target} --merge posts ${STACK_CONTEXT} and merges.`,
      );
      return 0;
    }
    return merge(root, target, landing) ? 0 : 1;
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    console.error(`land: ${error.message} Nothing was merged.`);
    return 1;
  }
}

if (import.meta.main) runtimeProcess.exit(await main(Bun.argv.slice(2)));
