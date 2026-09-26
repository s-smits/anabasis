#!/usr/bin/env bun
/**
 * `bun run runs` — what is running on this machine, and what can be done about it.
 *
 * The listing replaces the hand-rolled sequence the operator was using: `ps | grep fullrun`, a hunt
 * through the campaign tree for a terminal, then a tail of the log inside the run worktree. `show`
 * reads one run in depth, `stop` delegates to the existing stop owner, and `resume` reconstructs
 * the continuation from the run's own recorded evidence.
 *
 * Read-only by default. `stop` and `resume` print their plan and do nothing without `--yes`; no
 * subcommand writes into a campaign tree, changes a case kind, a terminal, a route, an adoption or
 * a claim, and nothing here schedules anything on its own.
 *
 * There is no `launch`: `bun .claude/skills/launch-run/scripts/launch.ts <preset> --model <name>`
 * already owns worktree creation, credential capture, the preflight probe, the composed gate and
 * detaching into the service manager, and `resume --yes` is that same launcher with a run's own
 * recorded arguments. A wrapper in front of it would pay no rent.
 */
import { parseArgs } from "../../src/meta/process.ts";
import { readObservations } from "./evidence.ts";
import { renderList, renderShow, shortPath } from "./format.ts";
import { mainCheckout } from "./discover.ts";
import { collectDetail, collectRows, type RunDetail } from "./rows.ts";
import { runPulse } from "./pulse.ts";
import { PAUSE_FINDING, resumePlan } from "./resume.ts";
import { stopRun } from "../../.claude/skills/launch-run/scripts/stop.ts";
import { gitMaybe } from "../../.claude/skills/main/git.ts";

const USAGE = `Usage: bun run runs [list] [--closed N]
       bun run runs show <runId>
       bun run runs stop <runId> [--yes] [--grace-ms N]
       bun run runs resume <runId|project> [--yes]
       bun run runs pause
       bun run runs pulse [<runId|label|project> ...] [--every S] [--once]

  list    every run this machine recorded, open ones first (the default with no arguments)
  show    one run: opening identity, authoring, batteries by claim time, terminal, recent evidence
  pulse   what moved in the open runs since the last look: a round opened, a battery recorded,
          a clear preview, a rehearsal against its prediction, a quiet Builder, a non-result
  stop    the existing stop owner, refusing a service the manager bound to another worktree
  resume  the continuation of a campaign: same prompt, same pins, same budget, same project
  pause   why there is none, and what to use instead

  --yes       actually stop, or actually launch the continuation; without it both only print
  --closed N  how many closed runs to list (default 8)
  --grace-ms  milliseconds between SIGTERM and removing the service (default 15000)
  --every S   seconds between two looks for pulse (default 290)
  --once      one pulse look, status lines only, then exit`;

const OPTIONS = {
  yes: { type: "boolean" },
  closed: { type: "string" },
  "grace-ms": { type: "string" },
  every: { type: "string" },
  once: { type: "boolean" },
  help: { type: "boolean" },
} as const;

function count(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} needs a positive whole number`);
  return parsed;
}

function detailOrExit(repoRoot: string, selector: string, closedLimit: number): RunDetail {
  const chosen = collectDetail(repoRoot, selector, { closedLimit });
  if (chosen.detail === undefined) {
    process.stderr.write(`${chosen.refusal}\n`);
    process.exit(1);
  }
  return chosen.detail;
}

export function stopPlanOf(detail: RunDetail, graceMs: number) {
  const { row, launch } = detail;
  if (row.liveness.state === "closed") {
    return { refusal: `${row.runId} already recorded its terminal; there is nothing to stop` };
  }
  const service = launch?.service ?? null;
  if (launch === null || service === null) {
    return {
      refusal: `${row.runId} has no launcher receipt naming a service, so this cannot prove which service is its own`,
    };
  }
  // A run id is unique inside one campaign only, so a service is this run's when its receipt names
  // this campaign as well.
  if (launch.project !== row.slug) {
    return {
      refusal: `${row.runId}'s launcher receipt does not name campaign ${row.slug}, so this cannot prove the service is its own`,
    };
  }
  return {
    plan: {
      dir: launch.dir,
      runId: row.runId,
      service,
      deadline: Date.now() + graceMs,
      grace: graceMs,
    },
  };
}

async function stop(detail: RunDetail, intent: "send" | "print-only", graceMs: number): Promise<number> {
  const resolved = stopPlanOf(detail, graceMs);
  if (resolved.plan === undefined) {
    process.stderr.write(`${resolved.refusal}\n`);
    return 2;
  }
  const plan = resolved.plan;
  process.stdout.write(
    [
      `stop ${plan.runId}`,
      `  service  ${plan.service}`,
      `  worktree ${shortPath(plan.dir)}`,
      `  state    ${detail.row.liveness.state} — ${detail.row.liveness.detail}`,
      `  SIGTERM, then ${plan.grace} ms, then the service is removed; the controller records its own terminal`,
      "",
    ].join("\n"),
  );
  if (intent === "print-only") {
    process.stdout.write("nothing sent: add --yes to stop this run\n");
    return 0;
  }
  const result = await stopRun(plan);
  process.stdout.write(`${result.outcome}: ${result.service}\n`);
  return 0;
}

async function resume(detail: RunDetail, intent: "launch" | "print-only", repoRoot: string): Promise<number> {
  const result = resumePlan(detail.evidence.opening, detail.launch);
  if (!result.ok) {
    process.stderr.write(`cannot reconstruct a continuation of ${detail.row.runId} from its own evidence:\n`);
    for (const missing of result.missing) process.stderr.write(`  ${missing}\n`);
    return 2;
  }
  const { command, provenance, warnings } = result.plan;
  process.stdout.write(
    `continuation of ${detail.row.runId}, from ${repoRoot}:\n\n  ${command.map((part) => (/[\s"]/.test(part) ? JSON.stringify(part) : part)).join(" ")}\n\n`,
  );
  for (const line of provenance) process.stdout.write(`  ${line}\n`);
  for (const warning of warnings) process.stdout.write(`  warning: ${warning}\n`);
  if (intent === "print-only") {
    process.stdout.write("\nnothing launched: add --yes to run this command, which spends provider turns\n");
    return 0;
  }
  const child = Bun.spawn(command, { cwd: repoRoot, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  return await child.exited;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  if (values.help === true) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const command = positionals[0] ?? "list";
  const selector = positionals[1];
  const closedLimit = count(values.closed, 8, "--closed");
  const repoRoot = mainCheckout(process.cwd());
  if (command === "pause") {
    process.stdout.write(`${PAUSE_FINDING}\n`);
    return 2;
  }
  if (command === "pulse") {
    const everyMs = values.once === true ? null : count(values.every, 290, "--every") * 1000;
    return await runPulse(repoRoot, positionals.slice(1), everyMs);
  }
  if (command === "list") {
    process.stdout.write(`${renderList(collectRows(repoRoot, { closedLimit }))}\n`);
    return 0;
  }
  if (selector === undefined) {
    process.stderr.write(`${command} needs a run id\n\n${USAGE}\n`);
    return 1;
  }
  const detail = detailOrExit(repoRoot, selector, closedLimit);
  if (command === "show") {
    process.stdout.write(
      `${renderShow(
        detail,
        readObservations(detail.evidence.location.campaignDir, detail.row.runId),
        // A branch's head at origin as this checkout last fetched it; no fetch, so the answer is local.
        (branch) =>
          gitMaybe(repoRoot, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}^{commit}`),
      )}\n`,
    );
    return 0;
  }
  if (command === "stop") {
    return await stop(
      detail,
      values.yes === true ? "send" : "print-only",
      count(values["grace-ms"], 15_000, "--grace-ms"),
    );
  }
  if (command === "resume") {
    return await resume(detail, values.yes === true ? "launch" : "print-only", repoRoot);
  }
  process.stderr.write(`unknown command ${command}\n\n${USAGE}\n`);
  return 1;
}

if (import.meta.main) {
  process.exitCode = await main(Bun.argv.slice(2));
}
