#!/usr/bin/env bun
/**
 * The Referee seated alone: one ruling on a rejection a seed holds, through the campaign's own
 * wiring (`openCampaign`, `reviewersNamed`, `packaged`), as a round or a gate hands it one. Run it
 * as the command of `live-seat.ts start`, which names the seed, the login and the cap:
 *
 *   bun --env-file=<file> .claude/skills/system-path-simulation/scripts/live-seat.ts start --tree <fork>
 *     --name sim-<what> --out <prefix> --cap 5 --minutes 45 --login N --
 *     <this file's absolute path> --solve <id> --reviewer <model> [--reviewer-effort <effort>]
 *
 * It loads the campaign's code from its working directory, the fork `start` runs it in, rather than
 * from the tree this file sits in, so one copy seats the Referee of whatever commit the fork is at.
 * Cut the seed right before the ruling to be asked again (`runs seed --events <its line - 1>`): a
 * ruling writes `referee.refused` for each refused attempt and one `referee.finding`, and nothing
 * else. It prints the ruling, its check, rule and field, which are the exam side's: keep them out of
 * anything published. No command asks the Referee again for a rejection that has a ruling: this was
 * written on 20 October to simulate #282 (coupled probes) on the two rejections buffer-fresh-opus's
 * Referee had ruled `unclear` for want of one.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { conditionsOf } from "#src/kernel/condition.ts";
import { read } from "#src/kernel/log.ts";
import { isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";

const USAGE = `usage: referee-seat.ts --name sim-<what> --solve <id> --reviewer <model> [--reviewer-effort <effort>]

Rules the rejection of <id> once, with the campaign code of the working directory.`;
const OPTIONS = { name: "text", solve: "text", reviewer: "text", "reviewer-effort": "text" } as const;
/** The Referee's own deadline in a comparison, which a ruling here is held to as well. */
const RULING_MS = 30 * 60_000;

async function main(args: CommandArgs): Promise<number> {
  const name = args.required("name");
  const solve = args.required("solve");
  if (!name.startsWith("sim-")) args.die(`${name} is no seed: the Referee here rules only on sim-<what>`);
  const tree = runtimeProcess.cwd();
  const { openCampaign }: typeof import("#tools/d2/campaign.ts") = await import(
    join(tree, "tools/d2/campaign.ts")
  );
  const { packaged, reviewersNamed }: typeof import("#tools/d2/round.ts") = await import(
    join(tree, "tools/d2/round.ts")
  );
  const campaign = await openCampaign({ name });
  const reviewers = reviewersNamed(campaign, {
    reviewer: args.required("reviewer"),
    "reviewer-effort": args.value("reviewer-effort") ?? "high",
  });
  // A start names its task by id, and its condition names the version the Referee is handed.
  const events = read(campaign.log);
  const start = events.find(({ kind, data }) => kind === "solve.started" && data.solve === solve)?.data
    .condition;
  const task = isString(start) ? conditionsOf(events).get(start)?.task : undefined;
  if (reviewers === null || task === undefined) return args.die(`${name} holds no solve ${solve}`);
  const began = Date.now();
  const finding = await reviewers.referee(solve, packaged(campaign)(task), AbortSignal.timeout(RULING_MS));
  const minutes = ((Date.now() - began) / 60_000).toFixed(1);
  console.log(
    `${solve}: ${finding.ruling}, check ${String(finding.check)}, rule ${String(finding.rule)}, field ${String(finding.field)}, ${minutes} min`,
  );
  return 0;
}

if (import.meta.main) {
  await runCommand({ name: "referee-seat", usage: USAGE, options: OPTIONS }, main);
}
