#!/usr/bin/env bun
/**
 * WRI2P2, the iteration of the skill's "The iteration", read as one step at a time from what is on
 * disk, so a session or a timer runs one line and takes the step it prints. It writes nothing but an
 * investigation's own files, through `wri.ts`; it stops, launches and merges nothing.
 *
 *   bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts [<part> ...] [--promotions 2] [--hours 12] [--days 2]
 *   bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts open <name>[,<name>...] [--out <dir>]
 *   bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts next <dir>
 *
 * - With no verb it reads every campaign this machine reads whose log moved in the last `--days`
 *   (`readable`: the worktrees' and the copies the central host's ten-minute gather keeps of every
 *   peer's, live ones included, each with the liveness its host last reported) and prints one row a
 *   run and its step: `run` while no trigger fired, `open` once one did, or the investigation's next
 *   step once one reads it. The trigger is whichever comes first (operator, 4 November): the
 *   promotions, the hours since the opening, a comparison that left no task untied ("they likely
 *   won't promote so that's a bit ironic that we need to wait"), or an ending.
 * - `open` starts the investigation of one run, or of several as equals, under `.ana/wri/` of the
 *   main checkout, reading a frozen copy of each live one (`wri.ts start --snapshot`): a run is
 *   never stopped for its iteration, since stopping one is the operator's.
 * - `next` reads an investigation's folder and prints the one step left, in the order of the
 *   iteration: the shared instructions' blank sections, the lanes, each lane session still owing a
 *   report (with the line a subagent is handed), the collection and the synthesis, the vetting, the
 *   plan against the levers, the pull request (named in `plan.md` as `Pull request: #N`), and the
 *   fresh runs at its head (`runs fresh --as forkedPR<N>`), which are launched without asking.
 *
 * Until 4 November `cycle.ts` read a release cycle's named runs by asking each host to run it in its
 * own tree, printed `stop` at the threshold, and investigated only once no run was live; an
 * iteration there waited on the operator's stop of a run that would never promote, and the step
 * after `investigate` was read by hand from the folder.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { existsSync, readdirSync, readFileSync, statSync } from "#src/meta/filesystem.ts";
import { mainTree } from "#src/meta/git.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "#src/meta/process.ts";
import { runSync } from "#src/meta/subprocess.ts";
import { stillRunning } from "#tools/runs/diagnosis.ts";
import {
  type Run,
  HERE,
  isCampaign,
  logEvents,
  processes,
  readable,
  readNamed,
} from "#tools/runs/registry.ts";
import { INVESTIGATION, SHARED, SYNTHESIS, VETTING } from "#tools/wri/index.ts";
import { blankSections } from "#tools/wri/investigation.ts";
import type { LogEvent } from "#src/kernel/log.ts";

const SCRIPT = ".claude/skills/run-improvement-campaign/scripts/wri2p2.ts";
const USAGE = `usage: bun ${SCRIPT} [<part> ...] [--promotions 2] [--hours 12] [--days 2] | open <name>[,<name>] [--out <dir>] | next <dir>`;
const OPTIONS = { promotions: "int", hours: "int", days: "int", out: "abs" } as const;
const HOUR_MS = 3_600_000;
const WRI = "tools/wri/wri.ts";

/** The trigger's defaults: two promotions (the cycle's `--promotions 2`) or twelve hours. */
const LIMITS = { promotions: 2, hours: 12 } as const;

/** One run as its log reads. */
interface Row {
  readonly name: string;
  readonly host: string;
  readonly live: boolean;
  readonly promotions: number;
  readonly compared: number;
  /** Whether a comparison reported a scored set with every task tied. */
  readonly allTied: boolean;
  readonly ending: string | null;
  readonly hours: number;
}

/** The row of the run `seen` whose log holds `events`, read at `now`. */
export function rowOf(
  seen: { readonly name: string; readonly host: string; readonly live: boolean },
  events: readonly LogEvent[],
  now: number,
): Row {
  const { live } = seen;
  const last = events.at(-1);
  const opened = Date.parse(events[0]?.at ?? "");
  const reported = events.filter(({ kind }) => kind === "comparison.reported");
  return {
    ...seen,
    promotions: events.filter(({ kind }) => kind === "harness.promoted").length,
    compared: reported.length,
    allTied: reported.some(({ data }) => {
      const scored = asRecord(data.scored);
      return scored?.wins === 0 && scored.losses === 0;
    }),
    ending: last?.kind === "campaign.ended" && isString(last.data.ending) ? last.data.ending : null,
    // A live run is timed to now: one in a long wait writes nothing, and its clock still runs.
    hours: Number.isNaN(opened) ? 0 : ((live ? now : Date.parse(last?.at ?? "")) - opened) / HOUR_MS,
  };
}

/** Why the iteration opens on `row` now, or null while it runs on. */
export function triggerOf(row: Row, limits: { promotions: number; hours: number } = LIMITS): string | null {
  if (row.promotions >= limits.promotions) return `${String(row.promotions)} promotions`;
  if (row.allTied) return "a comparison left no task untied";
  if (row.hours >= limits.hours) return `${row.hours.toFixed(1)} h since its opening`;
  // A run that ended before any comparison measured nothing an iteration could read.
  if (!row.live && row.compared > 0) return `closed${row.ending === null ? "" : ` (${row.ending})`}`;
  return null;
}

/** Each investigation folder under `root`, newest first, with the campaigns it reads. */
function investigations(root: string): { dir: string; names: string[] }[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((entry) => existsSync(join(root, entry, INVESTIGATION)))
    .toSorted((one, other) => other.localeCompare(one))
    .map((entry) => {
      const dir = join(root, entry);
      // Before 21 October an investigation read one log, named `log`.
      const { logs, log } = parseJsonAs<{ logs?: string[]; log?: string }>(
        readFileSync(join(dir, INVESTIGATION), "utf8"),
      );
      return {
        dir,
        names: (logs ?? (log === undefined ? [] : [log])).map((each) => basename(dirname(each))),
      };
    });
}

/** The lane sessions a manifest of `dir` launched whose reports are not all written. */
function owing(dir: string): { name: string; task: string }[] {
  return readdirSync(dir)
    .filter((file) => /^launch(-\d+)?\.json$/u.test(file))
    .flatMap(
      (file) =>
        parseJsonAs<{ sessions: { name: string; task: string; ownedPaths?: string[] }[] }>(
          readFileSync(join(dir, file), "utf8"),
        ).sessions,
    )
    .filter(({ ownedPaths = [] }) => ownedPaths.some((path) => !existsSync(path)));
}

/** The pull request `plan.md` names as the iteration's (`Pull request: #N`), or null. */
export function pullOf(plan: string): number | null {
  const named = /^Pull request: #(\d+)/mu.exec(plan)?.[1];
  return named === undefined ? null : Number(named);
}

/** The step left in the investigation `dir`, as lines, given the runs launched at a pull request. */
export function nextOf(dir: string, launchedAt: (pull: number) => string[]): string[] {
  const at = (file: string) => join(dir, file);
  const wri = (verb: string, more = "") => `  bun ${WRI} ${verb} --out ${dir}${more}`;
  if (!existsSync(at(INVESTIGATION))) return [`step: open · no investigation in ${dir}`];
  const blank = blankSections(readFileSync(at(SHARED), "utf8"));
  if (blank.length > 0) {
    return [`step: instruct · write ${blank.map((heading) => `"${heading}"`).join(", ")} in ${at(SHARED)}`];
  }
  if (!readdirSync(dir).some((file) => /^launch(-\d+)?\.json$/u.test(file))) {
    return ["step: lanes", wri("lanes", " --agents 4")];
  }
  const owed = owing(dir);
  if (owed.length > 0) {
    return [
      `step: reports · ${String(owed.length)} lane session(s) owe a report; hand each its line to a wri-lane agent, all in one message`,
      ...owed.map(({ name, task }) => `  ${name}: ${task}`),
    ];
  }
  if (!existsSync(at(SYNTHESIS))) {
    return [
      "step: synthesise · collect, render the prompt, and hand it to one session that writes synthesis.md",
      `${wri("collect")} && bun ${WRI} synthesis --out ${dir}`,
    ];
  }
  if (!existsSync(at(VETTING))) {
    return [`step: vet · recount each finding of ${at(SYNTHESIS)} into ${at(VETTING)}, predictions first`];
  }
  const plan = existsSync(at("plan.md")) ? readFileSync(at("plan.md"), "utf8") : null;
  if (plan === null) {
    return [
      `step: plan · repairs and tunings in ${at("plan.md")}, each lever of references/levers.md the run selects a row`,
    ];
  }
  const pull = pullOf(plan);
  if (pull === null) {
    return [
      `step: implement · one pull request on the top of the stack, then name it in plan.md as "Pull request: #N"`,
    ];
  }
  const launched = launchedAt(pull);
  if (launched.length === 0) {
    return [
      `step: launch · write the prediction, then fork at #${String(pull)}'s head on the host and login with room`,
      `  bun run runs fresh <pack> --at <#${String(pull)} head> --as forkedPR${String(pull)} --yes`,
    ];
  }
  return [`step: done · #${String(pull)} is measured by ${launched.join(", ")}`];
}

/** Each campaign `among` holds whose name carries `forkedPR<pull>`. */
const launchedFrom = (among: readonly Run[]) => (pull: number) =>
  among
    .filter((run) => isCampaign(run) && run.name.includes(`forkedPR${String(pull)}`))
    .map(({ name }) => name);

function due(args: CommandArgs, repo: string, known: readonly Run[]): number {
  const now = Date.now();
  const days = args.int("days") ?? 2;
  const limits = {
    promotions: args.int("promotions") ?? LIMITS.promotions,
    hours: args.int("hours") ?? LIMITS.hours,
  };
  const running = processes();
  const folders = investigations(join(mainTree(repo), ".ana", "wri"));
  const parts = args.positionals;
  const chosen = known.filter(
    (run) =>
      isCampaign(run) &&
      run.seed !== true &&
      (parts.length === 0 || parts.some((part) => run.name.includes(part))) &&
      now - statSync(run.path).mtimeMs < days * 24 * HOUR_MS,
  );
  const rows = chosen.map((run) =>
    rowOf(
      { name: run.name, host: run.archived ?? HERE, live: stillRunning(run, running) },
      logEvents(run.path),
      now,
    ),
  );
  const silent = rows.filter((row) => !row.live && row.compared === 0);
  for (const row of rows.filter((each) => !silent.includes(each))) {
    const folder = folders.find(({ names }) => names.includes(row.name));
    const trigger = triggerOf(row, limits);
    const opening =
      trigger === null ? ["step: run"] : [`step: open · ${trigger}`, `  bun ${SCRIPT} open ${row.name}`];
    const step = folder === undefined ? opening : nextOf(folder.dir, launchedFrom(known));
    const state = row.live ? "live" : `closed${row.ending === null ? "" : ` (${row.ending})`}`;
    console.log(
      `${row.name} · ${row.host} · ${state} · ${String(row.promotions)} promoted in ${String(row.compared)} compared · ${row.hours.toFixed(1)} h`,
    );
    for (const line of step) console.log(`  ${line}`);
  }
  if (silent.length > 0) console.log(`and ${String(silent.length)} closed run(s) that compared nothing`);
  if (chosen.length === 0) console.log(`no campaign moved in the last ${String(days)} day(s)`);
  return 0;
}

function open(args: CommandArgs, repo: string): number {
  const names = (args.positionals[1] ?? "").split(",").filter((name) => name !== "");
  if (names.length === 0) args.die(USAGE);
  const logs = names.map((name) => readNamed(name, repo).path);
  const day = new Date().toISOString().slice(0, 10);
  const out = resolve(args.value("out") ?? join(mainTree(repo), ".ana", "wri", `${day}-${names.join("+")}`));
  const started = runSync(
    [capturedExecPath, WRI, "start", "--log", logs.join(","), "--out", out, "--snapshot"],
    {
      cwd: repo,
    },
  );
  runtimeProcess.stdout.write(started.stdout);
  runtimeProcess.stderr.write(started.stderr);
  if (started.exitCode !== 0) return started.exitCode ?? 1;
  for (const line of nextOf(out, () => [])) console.log(line);
  return 0;
}

async function main(args: CommandArgs): Promise<number> {
  const repo = runtimeProcess.cwd();
  const [verb] = args.positionals;
  if (verb === "open") return open(args, repo);
  if (verb === "next") {
    const dir = args.positionals[1];
    if (dir === undefined) args.die(USAGE);
    for (const line of nextOf(resolve(dir), launchedFrom(readable(repo)))) console.log(line);
    return 0;
  }
  return due(args, repo, readable(repo));
}

if (import.meta.main) {
  await runCommand({ name: "wri2p2", usage: USAGE, options: OPTIONS, positionals: [0, 64] }, main);
}
