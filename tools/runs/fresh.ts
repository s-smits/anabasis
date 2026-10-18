/**
 * `bun run runs fresh <pack>`: a measured campaign from a blank project in one command. It names
 * the run and its project, makes the worktree kept for that run alone, detached at a published
 * commit, and starts the campaign there by `launch` (`manage.ts`), which installs, runs the dry run
 * and refuses what it refuses.
 *
 *   bun run runs fresh <pack> [--model opus|sonnet|gpt] [--effort hhmm] [--login N] [--budget 800]
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
 * A solve's limits are the model's as the operator ran them (`LIMITS`), unless the flags after `--`
 * name one. Until 17 October the verb named none, and every fresh run solved at the campaign's own
 * 120 minutes with the model's turns unlimited, where the gate held out 6 of 78 buffer drafts and 3
 * of 24 truss drafts; the three buffer runs at 8 minutes and 16 turns whose gate asked the Referee
 * held out 74 of 146, and a truss run at that budget 4 of its first 4. The turns bind, not the
 * minutes: there a valid answer took a median of 10 turns and 170 s, and of the gate's 1,233 solves
 * 569 were rejected and 12 ran out of turns. It does not make every pack's tasks hard: esp32's held
 * out 1 of 27 at 8 and 16, its valid answers taking a median of 3 turns.
 *
 * `gpt` seats GPT-6.1 Sol through the Codex CLI's login, which `--login` does not choose, at high in
 * every seat (the operator, 19 October). Its solve takes Sonnet's 30 minutes with Opus's 16 turns,
 * so that the turns bind and not a slower provider's clock; no campaign has yet run it, and the
 * flags after `--` name others.
 */
import { existsSync } from "#src/meta/filesystem.ts";
import { gitText, worktrees } from "#src/meta/git.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { on } from "./hosts.ts";
import { launch } from "./manage.ts";
import { runs } from "./registry.ts";

const MODELS = {
  opus: "claude/claude-opus-5-5",
  sonnet: "claude/claude-sonnet-5-5",
  gpt: "openai-codex/gpt-6.1-sol",
} as const;
/** Each model's efforts where none is named, as the operator ran them. */
const EFFORTS = { opus: "hhmm", sonnet: "xxhh", gpt: "hhhh" } as const;
const LEVELS = { l: "low", m: "medium", h: "high", x: "xhigh" } as const;
/** Each model's solve limits, minutes and the model's own turns, as the operator's campaigns ran them. */
const LIMITS = { opus: ["8", "16"], sonnet: ["30", "16"], gpt: ["30", "16"] } as const;

/** The solve-limit flags for `model` that `more`, the campaign command's own flags, does not name. */
export function limits(model: string, more: readonly string[]): string[] {
  const [minutes, turns] = named(LIMITS, model, `--model takes ${Object.keys(LIMITS).join("|")}`);
  const unnamed = ([flag]: readonly string[]) =>
    !more.some((arg) => arg === flag || arg.startsWith(`${flag ?? ""}=`));
  return [
    ["--solve-minutes", minutes],
    ["--solve-model-turns", turns],
  ]
    .filter(unnamed)
    .flat();
}

const named = <T>(table: Record<string, T>, key: string | undefined, usage: string): T => {
  const value = Object.entries(table).find(([one]) => one === key)?.[1];
  if (value === undefined) throw new Error(usage);
  return value;
};

/** The four seats' flags for `model` at `effort`, or at the model's own efforts. */
export function seats(model: string, effort: string | undefined): string[] {
  const id = named(MODELS, model, `--model takes ${Object.keys(MODELS).join("|")}`);
  const letters = effort ?? named(EFFORTS, model, "");
  const usage = "--effort takes four of lmhx, for the Builder, the Examiner, the Referee and the solver";
  if (letters.length !== 4) throw new Error(usage);
  const [build, examine, review, solve] = letters.split("").map((letter) => named(LEVELS, letter, usage));
  const seat = (name: string, level: string | undefined) => [
    `--${name}`,
    id,
    `--${name}-effort`,
    level ?? "",
  ];
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
      "usage: bun run runs fresh <pack> [--model opus|sonnet|gpt] [--effort hhmm] [--login N] [--host <host>] [--yes]",
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
  const beside = dirname(worktrees(here)[0] ?? here);
  const prompt = join(
    runtimeProcess.env.ANA_PROMPTS ?? join(beside, "anabasis-prompts"),
    `${pack}-prompt.txt`,
  );
  if (!existsSync(prompt)) throw new Error(`no ${prompt}: a pack's prompt is the operator's to write there`);
  const seated = seats(values.model, values.effort);
  const held = new Set(runs().map((run) => run.name));
  const base = [pack, "fresh", values.model, ...(values.as === undefined ? [] : [values.as])].join("-");
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
    ...limits(values.model, more),
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
