/**
 * `bun run runs fresh <pack>`: a measured campaign from a blank project in one command. It names
 * the run and its project, makes the worktree kept for that run alone, detached at a published
 * commit, and starts the campaign there by `launch` (`manage.ts`), which installs, runs the dry run
 * and refuses what it refuses.
 *
 *   bun run runs fresh <pack> [<pack> ...] [--logins <allowed-list>] [--model opus|sonnet|gpt|<provider>/<id>] [--effort hhmm] [--login N] [--budget 800]
 *     [--at <commit>] [--as <suffix>] [--host <host>] [--yes] [-- <more of the campaign command's flags>]
 *
 * The prompt is the operator's, `<pack>-prompt.txt` in the folder `ANA_PROMPTS` names, by default
 * `anabasis-prompts` beside the checkout, and the verb opens nothing else of it. The name is
 * `<pack>-fresh-<model>[-<suffix>]-<host>`, with `-r<n>` where a worktree holds that name or its folder,
 * and the project `<pack>-fresh`. `--effort` is four letters of `lmhx`, for the Builder, the Examiner,
 * the Referee and the solver. The worktree is `anabasis-<name>` beside the checkout, at `--at`, by
 * default this checkout's commit. Without `--host`, placement takes a machine below its configured
 * cap that carries the fewest live runs on the chosen login, then a pack's prior machine, then the
 * fewest live campaigns and simulation seats (`leastOccupied`, `placement.ts`). An explicit
 * `--host here` or peer overrides placement. Remote source is prepared by `code.ts` before launch,
 * and the peer's own `fresh` is told `--placed`, the caller's word that it placed the run there and
 * named it with the peer's `ANA_HOSTS` name: without it the peer placed the run again over itself
 * alone, and on 23 October refused a named host that held its cap of two live runs. A run placed
 * here ends with this machine's own name (`ownName`), so from 28 October every name says where it
 * runs; until then only a peer's did, and the operator asked that the machines be named alike.
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
 * every seat (the operator, 19 October). That login is one a machine, and placement and a named
 * `--host` hold it to one live GPT run a machine (`fullOn`, `logins.ts`). Any other model a backend serves is named by its id, so
 * `--model openrouter/deepseek/deepseek-v4.1-flash-1017` seats DeepSeek V4.1 Flash 1017 in every seat
 * as `<pack>-fresh-deepseek-v4.1-flash-1017`; on 21 October such a campaign needed four seat flags
 * after `--` under a name that said opus.
 */
import { existsSync } from "#src/meta/filesystem.ts";
import { gitText, mainTree } from "#src/meta/git.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { ownName } from "./host-config.ts";
import { verbOn } from "./hosts.ts";
import { preparedHost, publishedAt } from "./code.ts";
import { freshFleet, freshHost, freshLogin, loginPool, loginPresent } from "./placement.ts";
import { modelNamed } from "../m0/stored-sweep.ts";
import { launch } from "./manage.ts";
import { everyRun, harnessesOf } from "./registry.ts";
import { batchFresh } from "./batch.ts";
import { CODEX, seatsCodex } from "./live.ts";
import { billsLogin, readLogins } from "./logins.ts";

interface FreshStart {
  readonly model: ReturnType<typeof modelOf>;
  readonly seated: readonly string[];
  readonly suffix: string | undefined;
  readonly budget: string;
  readonly more: readonly string[];
  readonly login: string | undefined;
  readonly commit: string;
  readonly yes: boolean;
}

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
export async function fresh(args: readonly string[], read: typeof readLogins = readLogins): Promise<void> {
  const boundary = args.indexOf("--");
  const more = boundary === -1 ? [] : args.slice(boundary + 1);
  const { values, positionals } = parseArgs({
    args: [...(boundary === -1 ? args : args.slice(0, boundary))],
    allowPositionals: true,
    options: {
      model: { type: "string", default: "opus" },
      effort: { type: "string" },
      login: { type: "string" },
      logins: { type: "string" },
      budget: { type: "string", default: "800" },
      at: { type: "string", default: "HEAD" },
      as: { type: "string" },
      host: { type: "string" },
      placed: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
  });
  const [pack] = positionals;
  if (pack === undefined) {
    throw new Error(
      "usage: bun run runs fresh <pack> [<pack> ...] [--logins <allowed-list>] [--model opus|sonnet|gpt|<provider>/<id>] [--effort hhmm] [--login N] [--budget 800] [--at <commit>] [--as <suffix>] [--host <host>] [--yes] [-- <more of the campaign command's flags>]",
    );
  }
  if (
    positionals.some((name) => !isSafePathSegment(name)) ||
    (values.as !== undefined && !isSafePathSegment(values.as))
  ) {
    throw new Error("a pack and suffix each take a safe path segment");
  }
  const here = runtimeProcess.cwd();
  const model = modelOf(values.model);
  const seated = seats(model.id, values.effort ?? model.effort);
  const billed = billsLogin([], [...seated, ...more]);
  const codex = !billed && seatsCodex([...seated, ...more]);
  if (positionals.length > 1) {
    if (values.host !== undefined) throw new Error("a batch chooses its hosts automatically");
    return await batchFresh(
      positionals,
      {
        flags: [
          "--model",
          values.model,
          "--budget",
          values.budget,
          ...(values.as === undefined ? [] : ["--as", values.as]),
          ...(values.effort === undefined ? [] : ["--effort", values.effort]),
        ],
        more,
        at: values.at,
        login: values.login,
        logins: values.logins,
        billed,
        codex,
        yes: values.yes,
      },
      (words) => fresh(words, read),
      read,
    );
  }
  const fleet = await freshFleet();
  const login =
    values.login !== undefined || billed
      ? await freshLogin(values.login, fleet, read, loginPool(values.logins))
      : undefined;
  const payer = login ?? (codex ? CODEX : undefined);
  const host = await freshHost(pack, fleet, values.placed ? "here" : values.host, payer);
  const commit = publishedAt(here, values.at);
  if (host !== undefined) {
    console.log(`${host.name}: prepare a detached controller at ${commit.slice(0, 9)}, then fresh ${pack}`);
    if (!values.yes) return console.log("nothing is launched without --yes");
    if (login !== undefined && !(await loginPresent(host, login))) {
      console.error(`login ${login} must be carried to ${host.name} first`);
      runtimeProcess.exitCode = 1;
      return;
    }
    const forwarded = [
      "fresh",
      pack,
      "--at",
      commit,
      "--model",
      values.model,
      "--budget",
      values.budget,
      "--as",
      values.as === undefined ? host.name : `${values.as}-${host.name}`,
      "--placed",
      ...(values.effort === undefined ? [] : ["--effort", values.effort]),
      ...(login === undefined ? [] : ["--login", login]),
      "--yes",
      "--",
      ...more,
    ];
    runtimeProcess.exitCode = await verbOn(preparedHost(host, commit), forwarded);
    return;
  }
  await startFresh(pack, {
    model,
    seated,
    suffix: values.placed ? values.as : [values.as, ownName()].filter((part) => part !== undefined).join("-"),
    budget: values.budget,
    more,
    login,
    commit,
    yes: values.yes,
  });
}

/** Make and launch the local worktree after fleet admission. */
async function startFresh(pack: string, options: FreshStart): Promise<void> {
  const here = runtimeProcess.cwd();
  const beside = dirname(mainTree(here));
  const prompt = join(
    runtimeProcess.env.ANA_PROMPTS ?? join(beside, "anabasis-prompts"),
    `${pack}-prompt.txt`,
  );
  if (!existsSync(prompt)) throw new Error(`no ${prompt}: a pack's prompt is the operator's to write there`);
  const held = new Set(everyRun().map((run) => run.name));
  const base = [
    pack,
    "fresh",
    options.model.label,
    ...(options.suffix === undefined ? [] : [options.suffix]),
  ].join("-");
  const name = freeName(base, (one) => held.has(one) || existsSync(join(beside, `anabasis-${one}`)));
  if (!isSafePathSegment(name)) throw new Error("the campaign name exceeds the path-segment limit");
  const tree = join(beside, `anabasis-${name}`);
  const flags = [
    "--project",
    `${pack}-fresh`,
    "--prompt-file",
    prompt,
    "--budget",
    options.budget,
    "--handover",
    harnessesOf(here, name),
    ...options.seated,
    ...options.more,
  ];
  if (!options.yes) {
    console.log(
      `would make ${tree} at ${options.commit.slice(0, 9)} and launch ${name} on ${flags.join(" ")}; nothing is done without --yes`,
    );
    return;
  }
  gitText(here, "worktree", "add", "-q", "--detach", tree, options.commit);
  runtimeProcess.chdir(tree);
  await launch([
    name,
    ...(options.login === undefined ? [] : ["--login", options.login]),
    "--yes",
    "--",
    ...flags,
  ]);
}
