/** Plan every slot before launching any pack; reuse single-run admission for each actual launch. */
import { runtimeProcess } from "#src/meta/process.ts";
import { type Host } from "./host-config.ts";
import { type Live } from "./live.ts";
import { readLogins } from "./logins.ts";
import { freshFleet, freshHosts, freshLogin, loginPool, loginPresent, placeFresh } from "./placement.ts";
import { publishedAt } from "./code.ts";

interface BatchOptions {
  readonly flags: readonly string[];
  readonly more: readonly string[];
  readonly at: string;
  readonly login: string | undefined;
  readonly logins: string | undefined;
  readonly billed: boolean;
  readonly yes: boolean;
}
interface Planned {
  readonly pack: string;
  readonly host: Host | undefined;
  readonly login: string | undefined;
}

/** The whole ordered plan is printed even when a missing login prevents its execution. */
export async function batchFresh(
  packs: readonly string[],
  options: BatchOptions,
  launch: (args: readonly string[]) => Promise<void>,
  read: typeof readLogins,
): Promise<void> {
  const fleet: Live[] = await freshFleet();
  const allowed = loginPool(options.logins);
  const readings =
    options.billed && options.login === undefined ? await read(allowed, runtimeProcess.env) : [];
  const chooseLogin = () =>
    options.billed || options.login !== undefined
      ? freshLogin(options.login, fleet, async () => readings, allowed)
      : Promise.resolve(undefined);
  const first = await chooseLogin();
  let choices = await freshHosts();
  const plan: Planned[] = [];
  for (const [index, pack] of packs.entries()) {
    const login = index === 0 ? first : await chooseLogin();
    const host = await placeFresh(pack, fleet, choices, login);
    plan.push({ pack, host, login });
    fleet.push({ name: `planned-${String(index)}`, host: host?.name ?? "here", login: login ?? null });
    choices = choices.map((choice) =>
      choice.host === host ? { ...choice, projects: [...choice.projects, `${pack}-fresh`] } : choice,
    );
  }
  console.log("fresh batch plan");
  for (const [index, item] of plan.entries()) {
    console.log(
      `${String(index + 1)}. ${item.pack} -> ${item.host?.name ?? "here"}${item.login === undefined ? "" : `; login ${item.login}`}`,
    );
  }
  const checked = new Set<string>();
  for (const item of plan) {
    if (item.host === undefined || item.login === undefined) continue;
    const key = `${item.host.name}:${item.login}`;
    if (checked.has(key)) continue;
    checked.add(key);
    if (!(await loginPresent(item.host, item.login))) {
      console.error(`login ${item.login} must be carried to ${item.host.name} first`);
      runtimeProcess.exitCode = 1;
    }
  }
  if (runtimeProcess.exitCode === 1) return;
  if (!options.yes) return console.log("nothing is launched without --yes");
  const caller = runtimeProcess.cwd();
  const commit = publishedAt(caller, options.at);
  for (const item of plan) {
    try {
      await launch([
        item.pack,
        ...options.flags,
        "--at",
        commit,
        "--host",
        item.host?.name ?? "here",
        ...(item.login === undefined ? [] : ["--login", item.login]),
        "--yes",
        "--",
        ...options.more,
      ]);
    } finally {
      runtimeProcess.chdir(caller);
    }
    if (Number(runtimeProcess.exitCode ?? 0) !== 0) {
      throw new Error(`${item.pack} did not launch; remaining packs were not started`);
    }
  }
}
