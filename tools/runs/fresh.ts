/**
 * A measured campaign from a blank project in one command. It names the run
 * `<pack>-fresh-<model>[-<suffix>]-<host>` (`-r<n>` where taken) and the project `<pack>-fresh`,
 * makes a worktree kept for that run alone at `--at` (default `HEAD`), and starts it by `launch`
 * (`manage.ts`). The prompt is `<pack>-prompt.txt` in `ANA_PROMPTS`. `--model` names one model for
 * every seat or four in order, and `--effort` four letters of `lmhx`: Builder, Examiner, Referee,
 * solver. Without `--host`, placement picks the machine (`leastOccupied`, `placement.ts`); a peer's own `fresh` is told `--placed` so it does not place
 * the run again over itself alone. Several packs are planned as one (`plan`), and nothing launches
 * while a login it takes is missing from its host. A solve's limits are the campaign's (`LIMITS`,
 * `tools/campaign/campaign.ts`) unless flags after `--` name others.
 *
 *   bun run runs fresh <pack> [<pack> ...] [--logins <allowed-list>] [--model opus|sonnet|gpt|<provider>/<id>[,<b>,<c>,<d>]] [--effort hhmm] [--login N] [--budget 800]
 *     [--at <commit>] [--as <suffix>] [--host <host> | --placed] [--yes] [-- <more of the campaign command's flags>]
 */
import { codexAuthStatus } from "#src/agent/backends/codex-auth.ts";
import { CODEX } from "#src/agent/backends/models.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { gitMaybe, gitText, mainTree } from "#src/meta/git.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { type Host, hostNamed, ownName } from "./host-config.ts";
import { verbOn } from "./hosts.ts";
import { preparedHost, publishedAt } from "./code.ts";
import {
  codexPresent,
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
import { payerOf, seatFlagsOf } from "./live.ts";
import { billsLogin, readLogins } from "./logins.ts";

type Values = ReturnType<typeof parsed>["values"];

interface Planning extends Pick<Values, "login" | "logins"> {
  readonly named: string | undefined;
  readonly flags: readonly string[];
  readonly read: typeof readLogins;
}

interface Planned {
  readonly pack: string;
  readonly host: Host | undefined;
  readonly login: string | undefined;
}

interface Start extends Values {
  readonly label: string;
  readonly seated: readonly string[];
  readonly more: readonly string[];
  readonly commit: string;
}

const NAMED = {
  opus: { id: "claude/claude-opus-5-5", effort: "hhmm" },
  sonnet: { id: "claude/claude-sonnet-5-5", effort: "xxhh" },
  gpt: { id: "openai-codex/gpt-6.1-sol", effort: "hhhh" },
} as const;
const LEVELS = { l: "low", m: "medium", h: "high", x: "xhigh" } as const;
const SEATS = ["builder", "examiner", "reviewer", "solver"] as const;

function parsed(own: readonly string[]) {
  return parseArgs({
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
}

function modelOf(model: string): { id: string; effort: string; label: string } {
  const named = Object.entries(NAMED).find(([one]) => one === model);
  if (named !== undefined) return { ...named[1], label: named[0] };
  if (!model.includes("/")) {
    throw new Error(`--model takes ${Object.keys(NAMED).join("|")} or a served model's <provider>/<id>`);
  }
  modelNamed(model);
  return { id: model, effort: "hhhh", label: model.split("/").at(-1) ?? model };
}

export function seats(model: string, effort: string | undefined): { label: string; seated: string[] } {
  const names = model.split(",");
  if (names.length !== 1 && names.length !== SEATS.length) {
    throw new Error("--model takes one model, or four comma-separated: Builder, Examiner, Referee, solver");
  }
  const models = SEATS.map((_, seat) => modelOf(names[names.length === 1 ? 0 : seat] ?? ""));
  const letters = effort ?? models.map((one, seat) => one.effort[seat]).join("");
  const level = (letter: string) => Object.entries(LEVELS).find(([one]) => one === letter)?.[1];
  const levels = letters.split("").map(level);
  if (levels.length !== SEATS.length || levels.includes(undefined)) {
    throw new Error("--effort takes four of lmhx, for the Builder, the Examiner, the Referee and the solver");
  }
  return {
    label: models.at(-1)?.label ?? model,
    seated: SEATS.flatMap((name, seat) => [
      `--${name}`,
      models[seat]?.id ?? "",
      `--${name}-effort`,
      levels[seat] ?? "",
    ]),
  };
}

function preflightSeats(seated: readonly string[], more: readonly string[]): boolean {
  if (more.includes("--admit-judge") || more.includes("--no-admit-judge")) {
    throw new Error(
      "--admit-judge was removed: the Examiner chooses dynamically during d-1, and unattended openings with a first-party reviewer auto-admit judged items",
    );
  }
  const bySeat = seatFlagsOf([...seated, ...more]);
  return Object.values(bySeat).some((model) => model?.startsWith(`${CODEX}/`) === true);
}

export async function fresh(args: readonly string[], read: typeof readLogins = readLogins): Promise<void> {
  const own = ownArgs(args);
  const more = args.slice(own.length + 1);
  const { values, positionals } = parsed(own);
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
  const { label, seated } = seats(values.model, values.effort);
  const needsCodex = preflightSeats(seated, more);
  if (positionals.length > 1 && values.host !== undefined) {
    throw new Error("a batch chooses its hosts automatically");
  }
  if (values.host !== undefined && values.host !== HERE) hostNamed(values.host);
  const named = values.placed ? HERE : values.host;
  const planned = await plan(positionals, { ...values, named, flags: [...seated, ...more], read });
  if (needsCodex) {
    const hosts = new Map(planned.map(({ host }) => [host?.name ?? HERE, host] as const));
    let ready = true;
    for (const host of hosts.values()) ready = (await codexCarried(host)) && ready;
    if (!ready) return;
  }
  if (planned.length > 1 && !(await announced(planned, values.yes))) return;
  const commit = publishedAt(here, values.at);
  for (const item of planned) {
    try {
      await startPlanned(item, { ...values, label, seated, more, commit });
    } finally {
      runtimeProcess.chdir(here);
    }
    if (planned.length > 1 && Number(runtimeProcess.exitCode) > 0) {
      throw new Error(`${item.pack} did not launch; remaining packs were not started`);
    }
  }
}

async function plan(packs: readonly string[], o: Planning): Promise<Planned[]> {
  const fleet = [...(await freshFleet())];
  const allowed = loginPool(o.logins);
  let readings: ReturnType<typeof readLogins> | undefined;
  const once: typeof readLogins = (wanted, env) => (readings ??= o.read(wanted, env));
  let choices = o.named === undefined ? await freshHosts() : [];
  const planned: Planned[] = [];
  for (const [index, pack] of packs.entries()) {
    const login =
      o.login !== undefined || billsLogin([], o.flags)
        ? await freshLogin(o.login, fleet, once, allowed)
        : undefined;
    const payer = payerOf(login, o.flags);
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

async function carried(host: Host, login: string): Promise<boolean> {
  if (await loginPresent(host, login)) return true;
  console.error(`login ${login} must be carried to ${host.name} first`);
  runtimeProcess.exitCode = 1;
  return false;
}

async function codexCarried(host: Host | undefined): Promise<boolean> {
  const status = host === undefined ? codexAuthStatus() : await codexPresent(host);
  if (status === "ready") return true;
  if (status === "unknown") {
    console.error(
      `warning: could not verify Codex login on ${host?.name ?? HERE} (no recognised answer); continuing`,
    );
    return true;
  }
  const where = host === undefined ? "this host" : host.name;
  console.error(`Codex login on ${where} is ${status}: renew it with \`codex\` on ${where} first`);
  runtimeProcess.exitCode = 1;
  return false;
}

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
  // The first of `base`, `base-r2`, `base-r3` ... that no campaign or worktree holds.
  const nameOf = (n: number): string => (n === 1 ? base : `${base}-r${String(n)}`);
  const taken = (one: string): boolean => held.has(one) || existsSync(join(beside, `anabasis-${one}`));
  const free = (n: number): string => (taken(nameOf(n)) ? free(n + 1) : nameOf(n));
  const name = free(1);
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
  try {
    await launch([name, ...(login === undefined ? [] : ["--login", login]), "--yes", "--", ...flags]);
  } catch (error) {
    // A tree refused before its campaign's folder is made would send the next fresh to `-r2`.
    runtimeProcess.chdir(here);
    if (!existsSync(join(tree, ".ana", "d2", name))) gitMaybe(here, "worktree", "remove", tree);
    throw error;
  }
}
