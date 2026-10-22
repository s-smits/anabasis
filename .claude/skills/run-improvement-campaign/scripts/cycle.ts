#!/usr/bin/env bun
/**
 * Where a release cycle stands, and the one step it takes next. It reads each run the cycle forked,
 * on whichever host holds it, and prints a row a run and then the step, with the commands that take
 * it. It stops, launches and writes nothing: the session or the timer that runs it takes the step.
 *
 *   bun .claude/skills/run-improvement-campaign/scripts/cycle.ts <run> ... [--keep <run>]... [--threshold 3]
 *
 * The steps follow the cycle's fixed order (the skill's "The release cycle"):
 *
 * - `run` while a run the cycle stops is live and has fewer promotions than the threshold;
 * - `stop` once every such run has reached it or ended, with the stop that ends the rest;
 * - `investigate` once none is live, with the fetches and the investigation's start;
 * - `unread`, exiting 1, while a run is found on no host that answered, since it may be live.
 *
 * A run named with `--keep` (an ablation the operator keeps going) is read and never waited for or
 * stopped. On 22 October v0.6.4 was landed and six runs forked on it while the investigation of the
 * runs before them was still being read: the order was in the skill, and the session read the
 * running window by the clock. This prints the step from the runs' own logs, so a timer's prompt is
 * one line.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { capturedSpawn } from "#src/meta/process.ts";
import { type Host, hostsOf, quoted, sshScript } from "#tools/runs/hosts.ts";
import { isCampaign, logEvents, processes, runs, writers } from "#tools/runs/registry.ts";

const SCRIPT = ".claude/skills/run-improvement-campaign/scripts/cycle.ts";
const USAGE = `usage: bun ${SCRIPT} <run> ... [--keep <run>]... [--threshold 3]`;
const OPTIONS = { keep: "list", threshold: "int", here: "flag" } as const;
const HOUR_MS = 3_600_000;

/** One run as its log reads, and the host that holds it. */
interface Row {
  readonly name: string;
  readonly host: string;
  readonly live: boolean;
  readonly promotions: number;
  readonly compared: number;
  readonly ending: string | null;
  readonly hours: number;
}

/** The runs among `names` that a worktree of this machine holds. */
function rowsHere(names: readonly string[], host = "here"): Row[] {
  const running = processes();
  return runs()
    .filter((run) => isCampaign(run) && names.includes(run.name))
    .map((run) => {
      const log = logEvents(run.path);
      const last = log.at(-1);
      const opened = Date.parse(log[0]?.at ?? "");
      return {
        name: run.name,
        host,
        live: writers(run, running).length > 0,
        promotions: log.filter(({ kind }) => kind === "harness.promoted").length,
        compared: log.filter(({ kind }) => kind === "comparison.reported").length,
        ending: last?.kind === "campaign.ended" && isString(last.data.ending) ? last.data.ending : null,
        hours: Number.isNaN(opened) ? 0 : (Date.parse(last?.at ?? "") - opened) / HOUR_MS,
      };
    });
}

/** The rows `host` holds, from this script run there with `--here`; none where it does not answer. */
async function rowsOn(host: Host, names: readonly string[]): Promise<Row[]> {
  const script = `cd ${host.tree} && ${host.bun} ${SCRIPT} --here ${names.map(quoted).join(" ")}`;
  const child = capturedSpawn(sshScript(host, script), { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const [said, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  try {
    if (code === 0) return parseJsonAs<Row[]>(said).map((row) => ({ ...row, host: host.name }));
  } catch {
    // An answer that is no JSON list is a tree that predates this script, said below.
  }
  console.error(`${host.name} did not answer (exit ${String(code)}): its tree may predate ${SCRIPT}`);
  return [];
}

const line = (row: Row, kept: boolean) =>
  [
    row.name,
    row.host,
    row.live ? "live" : `closed${row.ending === null ? "" : ` (${row.ending})`}`,
    `${String(row.promotions)} promoted in ${String(row.compared)} compared`,
    `${row.hours.toFixed(1)} h`,
    kept ? "kept" : "",
  ]
    .filter((part) => part !== "")
    .join(" · ");

/** The cycle's next step over `rows`, the runs it stops, and the commands that take the step. */
function stepOf(rows: readonly Row[], kept: readonly string[], threshold: number): string[] {
  const stopped = rows.filter((row) => !kept.includes(row.name));
  const live = stopped.filter((row) => row.live);
  const short = live.filter((row) => row.promotions < threshold);
  if (short.length > 0) {
    return [
      `step: run · ${short.map((row) => `${row.name} ${String(row.promotions)}/${String(threshold)}`).join(", ")}`,
    ];
  }
  if (live.length > 0) {
    return [
      `step: stop · every run is at ${String(threshold)} promotions or ended`,
      `  bun --env-file=.env.runs run runs stop ${live.map((row) => row.name).join(" ")} --yes`,
    ];
  }
  const away = stopped.filter((row) => row.host !== "here");
  return [
    "step: investigate · no run the cycle stops is live",
    ...away.map((row) => `  bun --env-file=.env.runs run runs fetch ${row.name}`),
    `  bun tools/wri/wri.ts start --log ${stopped.map((row) => row.name).join(",")} --out .ana/wri/<date>-<cycle>`,
  ];
}

async function main(args: CommandArgs): Promise<number> {
  const kept = args.list("keep");
  const names = [...new Set([...args.positionals, ...kept])];
  if (names.length === 0) args.die(USAGE);
  if (args.flag("here")) {
    console.log(capturedJsonStringify(rowsHere(names)));
    return 0;
  }
  const rows = [
    ...rowsHere(names),
    ...(await Promise.all(hostsOf().map((host) => rowsOn(host, names)))).flat(),
  ];
  for (const row of rows) console.log(line(row, kept.includes(row.name)));
  const missing = names.filter((name) => !rows.some((row) => row.name === name));
  if (missing.length > 0) {
    // A run no host answered for may be live: no step is read past it.
    console.log(`step: unread · not found on any host that answered: ${missing.join(", ")}`);
    return 1;
  }
  for (const said of stepOf(rows, kept, args.int("threshold") ?? 3)) console.log(said);
  return 0;
}

if (import.meta.main) {
  await runCommand({ name: "cycle", usage: USAGE, options: OPTIONS, positionals: [0, 64] }, main);
}
