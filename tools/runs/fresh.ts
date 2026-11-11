/**
 * `bun run runs fresh <pack>`: a measured campaign from a blank project in one command. It names
 * the run and its project, makes the worktree kept for that run alone, detached at a published
 * commit, and starts the campaign there by `launch` (`manage.ts`), which installs, runs the dry run
 * and refuses what it refuses.
 *
 *   bun run runs fresh <pack> [<pack> ...] [--logins <allowed-list>] [--model opus|sonnet|gpt|<provider>/<id>] [--effort hhmm] [--login N] [--budget 800]
 *     [--at <commit>] [--as <suffix>] [--host <host> | --placed] [--yes] [-- <more of the campaign command's flags>]
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
 * `launch` leaves the run its keeper on the machine it runs on, unless `ANA_KEEP=off` (`keepsItself`).
 * Several packs are planned as one (`plan`): each pack's login and host are reserved in the counts
 * before the next is placed, the whole plan is printed, and nothing launches while a login it takes
 * is missing from its host. Until 11 November a batch planned, then called this verb again once a
 * pack, which read the fleet and the logins a second time.
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
import { type Host, hostNamed, ownName } from "./host-config.ts";
import { verbOn } from "./hosts.ts";
import { preparedHost, publishedAt } from "./code.ts";
import {
  freshFleet,
  freshHost,
  freshHosts,
  freshLogin,
  loginPool,
  loginPresent,
  placeFresh,
} from "./placement.ts";
import { modelNamed } from "../m0/stored-sweep.ts";
import { launch } from "./manage.ts";
import { everyRun, HERE, harnessesOf, Misused, ownArgs } from "./registry.ts";
import { payerOf } from "./live.ts";
import { billsLogin, readLogins } from "./logins.ts";

interface Planning {
  readonly login?: string;
  readonly logins?: string;
  /** The host the operator or a placing caller named, or undefined where placement chooses. */
  readonly named: string | undefined;
  /** The four seats' flags and those after `--`, which say who pays. */
  readonly flags: readonly string[];
  readonly read: typeof readLogins;
}

interface Planned {
  readonly pack: string;
  readonly host: Host | undefined;
  readonly login: string | undefined;
}

/** What a planned pack launches with: the verb's own values, the seats' flags and the commit. */
interface Start {
  readonly model: string;
  readonly label: string;
  readonly seated: readonly string[];
  readonly effort?: string;
  readonly budget: string;
  readonly as?: string;
  readonly placed: boolean;
  readonly yes: boolean;
  readonly more: readonly string[];
  readonly commit: string;
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
  const own = ownArgs(args);
  const more = args.slice(own.length + 1);
  const { values, positionals } = parseArgs({
    args: [...own],
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
  if (positionals.length === 0) {
    throw new Misused();
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
  if (positionals.length > 1 && values.host !== undefined) {
    throw new Error("a batch chooses its hosts automatically");
  }
  if (values.host !== undefined && values.host !== HERE) hostNamed(values.host);
  const named = values.placed ? HERE : values.host;
  const planned = await plan(positionals, { ...values, named, flags: [...seated, ...more], read });
  if (planned.length > 1 && !(await announced(planned, values.yes))) return;
  const commit = publishedAt(here, values.at);
  for (const item of planned) {
    try {
      await startPlanned(item, { ...values, label: model.label, seated, more, commit });
    } finally {
      runtimeProcess.chdir(here);
    }
    if (planned.length > 1 && Number(runtimeProcess.exitCode ?? 0) !== 0) {
      throw new Error(`${item.pack} did not launch; remaining packs were not started`);
    }
  }
}

/** Every pack's host and login, each reserved in the counts before the next is placed, so that a
 *  batch reads the fleet, the hosts' catalogues and the logins' windows once. */
async function plan(packs: readonly string[], o: Planning): Promise<Planned[]> {
  const fleet = [...(await freshFleet())];
  const allowed = loginPool(o.logins);
  let readings: ReturnType<typeof readLogins> | undefined;
  const once: typeof readLogins = (wanted, env) => (readings ??= o.read(wanted, env));
  let choices: Awaited<ReturnType<typeof freshHosts>> | undefined;
  const planned: Planned[] = [];
  for (const [index, pack] of packs.entries()) {
    const login =
      o.login !== undefined || billsLogin([], o.flags)
        ? await freshLogin(o.login, fleet, once, allowed)
        : undefined;
    const payer = payerOf(login, o.flags);
    choices ??= o.named === undefined ? await freshHosts() : [];
    const host =
      o.named === undefined
        ? await placeFresh(pack, fleet, choices, payer)
        : freshHost(pack, fleet, o.named, payer);
    planned.push({ pack, host, login });
    fleet.push({ name: `planned-${String(index)}`, host: host?.name ?? HERE, login: payer ?? null });
    choices = choices.map((choice) =>
      choice.host === host ? { ...choice, projects: [...choice.projects, `${pack}-fresh`] } : choice,
    );
  }
  return planned;
}

/** Whether `host` holds `login`, saying so in the line the hourly fork reads where it does not. */
async function carried(host: Host, login: string): Promise<boolean> {
  if (await loginPresent(host, login)) return true;
  console.error(`login ${login} must be carried to ${host.name} first`);
  runtimeProcess.exitCode = 1;
  return false;
}

/** Print a batch's whole plan, and whether it may launch: with `--yes`, and with every login it takes
 *  already on the host it goes to, so that a missing one stops every launch. */
async function announced(planned: readonly Planned[], yes: boolean): Promise<boolean> {
  console.log("fresh batch plan");
  for (const [index, { pack, host, login }] of planned.entries()) {
    const paid = login === undefined ? "" : `; login ${login}`;
    console.log(`${String(index + 1)}. ${pack} -> ${host?.name ?? HERE}${paid}`);
  }
  const pairs = new Map(
    planned.flatMap(({ host, login }) =>
      host === undefined || login === undefined ? [] : [[`${host.name}:${login}`, { host, login }] as const],
    ),
  );
  let present = true;
  for (const { host, login } of pairs.values()) present = (await carried(host, login)) && present;
  if (!present) return false;
  if (!yes) console.log("nothing is launched without --yes");
  return yes;
}

/** Launch one planned pack: here in a worktree of its own, or on its host through a controller
 *  prepared at the commit, whose own `fresh` is told `--placed`. */
async function startPlanned({ pack, host, login }: Planned, start: Start): Promise<void> {
  if (host === undefined) return await startFresh(pack, login, start);
  console.log(
    `${host.name}: prepare a detached controller at ${start.commit.slice(0, 9)}, then fresh ${pack}`,
  );
  if (!start.yes) return console.log("nothing is launched without --yes");
  if (login !== undefined && !(await carried(host, login))) return;
  const forwarded = [
    "fresh",
    pack,
    "--at",
    start.commit,
    "--model",
    start.model,
    "--budget",
    start.budget,
    "--as",
    start.as === undefined ? host.name : `${start.as}-${host.name}`,
    "--placed",
    ...(start.effort === undefined ? [] : ["--effort", start.effort]),
    ...(login === undefined ? [] : ["--login", login]),
    "--yes",
    "--",
    ...start.more,
  ];
  runtimeProcess.exitCode = await verbOn(await preparedHost(host, start.commit), forwarded);
}

/** Make and launch the local worktree after fleet admission. A run placed here by this machine ends
 *  with its own name; one a caller placed here carries the caller's suffix. */
async function startFresh(pack: string, login: string | undefined, start: Start): Promise<void> {
  const here = runtimeProcess.cwd();
  const beside = dirname(mainTree(here));
  const prompt = join(
    runtimeProcess.env.ANA_PROMPTS ?? join(beside, "anabasis-prompts"),
    `${pack}-prompt.txt`,
  );
  if (!existsSync(prompt)) throw new Error(`no ${prompt}: a pack's prompt is the operator's to write there`);
  const held = new Set(everyRun().map((run) => run.name));
  const suffix = start.placed
    ? start.as
    : [start.as, ownName()].filter((part) => part !== undefined).join("-");
  const base = [pack, "fresh", start.label, ...(suffix === undefined ? [] : [suffix])].join("-");
  const name = freeName(base, (one) => held.has(one) || existsSync(join(beside, `anabasis-${one}`)));
  if (!isSafePathSegment(name)) throw new Error("the campaign name exceeds the path-segment limit");
  const tree = join(beside, `anabasis-${name}`);
  const flags = [
    "--project",
    `${pack}-fresh`,
    "--prompt-file",
    prompt,
    "--budget",
    start.budget,
    "--handover",
    harnessesOf(here, name),
    ...start.seated,
    ...start.more,
  ];
  if (!start.yes) {
    console.log(
      `would make ${tree} at ${start.commit.slice(0, 9)} and launch ${name} on ${flags.join(" ")}; nothing is done without --yes`,
    );
    return;
  }
  gitText(here, "worktree", "add", "-q", "--detach", tree, start.commit);
  runtimeProcess.chdir(tree);
  await launch([name, ...(login === undefined ? [] : ["--login", login]), "--yes", "--", ...flags]);
}
