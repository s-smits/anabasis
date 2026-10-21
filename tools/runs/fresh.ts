/**
 * `bun run runs fresh <pack>`: a measured campaign from a blank project in one command. It names
 * the run and its project, makes the worktree kept for that run alone, detached at a published
 * commit, and starts the campaign there by `launch` (`manage.ts`), which installs, runs the dry run
 * and refuses what it refuses.
 *
 *   bun run runs fresh <pack> [--model opus|sonnet|gpt|<provider>/<id>] [--effort hhmm] [--login N] [--budget 800]
 *     [--at <commit>] [--as <suffix>] [--host <host>] [--yes] [-- <more of the campaign command's flags>]
 *
 * The prompt is the operator's, `<pack>-prompt.txt` in the folder `ANA_PROMPTS` names, by default
 * `anabasis-prompts` beside the checkout, and the verb opens nothing else of it. The name is
 * `<pack>-fresh-<model>[-<suffix>]`, with `-r<n>` where a worktree holds that name or its folder,
 * and the project `<pack>-fresh`. `--effort` is four letters of `lmhx`, for the Builder, the Examiner,
 * the Referee and the solver. The worktree is `anabasis-<name>` beside the checkout, at `--at`, by
 * default this one's commit. `--host` runs the verb on a host `ANA_HOSTS` lists (`hosts.ts`), at this
 * checkout's commit, the host's name the suffix unless `--as` names one; that host's tree runs the
 * verb, so it needs a commit that has it.
 *
 * Until 16 October each fresh launch was typed by hand: a worktree, a prompt file, eight seat
 * flags and a name, and one launch that left out `--login` ended on its environment.
 *
 * A solve's limits are the campaign's one budget (`LIMITS`, `tools/d2/campaign.ts`), unless the
 * flags after `--` name others. From 17 to 19 October this verb named its own by model, 8 or 30
 * minutes and 16 turns, beside a campaign default of 120 minutes with the turns unlimited: one
 * budget a solve, held in two places that disagreed.
 *
 * `gpt` seats GPT-6.1 Sol through the Codex CLI's login, which `--login` does not choose, at high in
 * every seat (the operator, 19 October). Any other model a backend serves is named by its id, so
 * `--model openrouter/deepseek/deepseek-v4.1-flash-1017` seats DeepSeek V4.1 Flash 1017 in every seat
 * as `<pack>-fresh-deepseek-v4.1-flash-1017`; on 21 October such a campaign needed four seat flags
 * after `--` under a name that said opus.
 */
import { existsSync } from "#src/meta/filesystem.ts";
import { gitText, mainTree } from "#src/meta/git.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { on } from "./hosts.ts";
import { modelNamed } from "../m0/stored-sweep.ts";
import { launch } from "./manage.ts";
import { everyRun } from "./registry.ts";

/** The operator's named conditions: a model and its efforts a seat, as the operator ran them. */
const NAMED = {
  opus: { id: "claude/claude-opus-5-5", effort: "hhmm" },
  sonnet: { id: "claude/claude-sonnet-5-5", effort: "xxhh" },
  gpt: { id: "openai-codex/gpt-6.1-sol", effort: "hhhh" },
} as const;
const LEVELS = { l: "low", m: "medium", h: "high", x: "xhigh" } as const;

/**
 * `--model`: a named condition, or any model a backend serves as `<provider>/<id>`, at high in every
 * seat and named by its id. A served model is refused here, before a worktree is made, where no
 * backend serves it.
 */
export function modelOf(model: string): { id: string; effort: string; label: string } {
  const named = Object.entries(NAMED).find(([one]) => one === model);
  if (named !== undefined) return { ...named[1], label: named[0] };
  if (!model.includes("/")) {
    throw new Error(`--model takes ${Object.keys(NAMED).join("|")} or a served model's <provider>/<id>`);
  }
  modelNamed(model);
  return { id: model, effort: "hhhh", label: model.split("/").at(-1) ?? model };
}

/** The four seats' flags for model `id` at `letters`, one of `lmhx` a seat. */
export function seats(id: string, letters: string): string[] {
  const usage = "--effort takes four of lmhx, for the Builder, the Examiner, the Referee and the solver";
  const level = (letter: string) => Object.entries(LEVELS).find(([one]) => one === letter)?.[1];
  const levels = letters.split("").map(level);
  if (levels.length !== 4 || levels.includes(undefined)) throw new Error(usage);
  const [build, examine, review, solve] = levels;
  const seat = (name: string, at: string | undefined) => [`--${name}`, id, `--${name}-effort`, at ?? ""];
  return [
    ...seat("builder", build),
    ...seat("examiner", examine),
    ...seat("reviewer", review),
    ...seat("solver", solve),
  ];
}

/** The first of `base`, `base-r2`, `base-r3` ... that `taken` does not hold. */
export function freeName(base: string, taken: (name: string) => boolean): string {
  const name = (n: number): string => (n === 1 ? base : `${base}-r${String(n)}`);
  const free = (n: number): string => (taken(name(n)) ? free(n + 1) : name(n));
  return free(1);
}

/** `bun run runs fresh`. */
export async function fresh(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      model: { type: "string", default: "opus" },
      effort: { type: "string" },
      login: { type: "string" },
      budget: { type: "string", default: "800" },
      at: { type: "string", default: "HEAD" },
      as: { type: "string" },
      host: { type: "string" },
      yes: { type: "boolean", default: false },
    },
  });
  const [pack, ...more] = positionals;
  if (pack === undefined) {
    throw new Error(
      "usage: bun run runs fresh <pack> [--model opus|sonnet|gpt|<provider>/<id>] [--effort hhmm] [--login N] [--host <host>] [--yes]",
    );
  }
  const here = runtimeProcess.cwd();
  if (values.host !== undefined) {
    // The host makes the run at this checkout's commit, whatever its own tree is at.
    const at = gitText(here, "rev-parse", "--verify", `${values.at}^{commit}`);
    const forwarded = ["--host", "--at"];
    const kept = args.filter(
      (arg, n) =>
        !forwarded.includes(arg) &&
        !forwarded.includes(args[n - 1] ?? "") &&
        !forwarded.some((flag) => arg.startsWith(`${flag}=`)),
    );
    const suffix = values.as === undefined ? ["--as", values.host] : [];
    return on([values.host, "fresh", "--at", at, ...suffix, ...kept]);
  }
  const beside = dirname(mainTree(here));
  const prompt = join(
    runtimeProcess.env.ANA_PROMPTS ?? join(beside, "anabasis-prompts"),
    `${pack}-prompt.txt`,
  );
  if (!existsSync(prompt)) throw new Error(`no ${prompt}: a pack's prompt is the operator's to write there`);
  const model = modelOf(values.model);
  const seated = seats(model.id, values.effort ?? model.effort);
  const held = new Set(everyRun().map((run) => run.name));
  const base = [pack, "fresh", model.label, ...(values.as === undefined ? [] : [values.as])].join("-");
  const name = freeName(base, (one) => held.has(one) || existsSync(join(beside, `anabasis-${one}`)));
  const tree = join(beside, `anabasis-${name}`);
  gitText(here, "fetch", "-q", "origin");
  const commit = gitText(here, "rev-parse", "--verify", `${values.at}^{commit}`);
  if (gitText(here, "branch", "-r", "--contains", commit) === "") {
    throw new Error(`${commit.slice(0, 9)} is on no remote branch`);
  }
  const flags = [
    "--project",
    `${pack}-fresh`,
    "--prompt-file",
    prompt,
    "--budget",
    values.budget,
    ...seated,
    ...more,
  ];
  if (!values.yes) {
    console.log(
      `would make ${tree} at ${commit.slice(0, 9)} and launch ${name} on ${flags.join(" ")}; nothing is done without --yes`,
    );
    return;
  }
  gitText(here, "worktree", "add", "-q", "--detach", tree, commit);
  runtimeProcess.chdir(tree);
  await launch([
    name,
    ...(values.login === undefined ? [] : ["--login", values.login]),
    "--yes",
    "--",
    ...flags,
  ]);
}
