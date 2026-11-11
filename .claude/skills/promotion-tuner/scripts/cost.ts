#!/usr/bin/env bun
/**
 * Dollars a promotion for every campaign on record, priced once by today's meter, beside what each
 * run billed under the meter of its own commit. It starts no solve, calls no model and writes nothing.
 *
 *   bun .claude/skills/promotion-tuner/scripts/cost.ts [--since <date>] [--name <part>]...
 *     [--by week|pack|setting|none] [--format md|tsv]
 *
 * Why. A run's `billed` dollars are what its own meter wrote, and the meter moved: on 25 October it
 * began pricing each turn at the model that served it, and on 1 November (#563) it began billing a
 * session on its backend's ledger, compactions and retries included. So the dollars of an October run
 * and of a November run are two measures, and a fall between them may be the meter's (operator,
 * 2 November: "use current metrics mechanisms to backtrack earlier runs and equally compare that
 * way"). This reads every turn a log recorded, each with its tokens and the model that served it, and
 * prices it with the meter a live seat runs today (`seatMeter`, with its provider's catalogue, as
 * `sit` builds it), so every run is priced on one table. What it cannot reprice is what no old log
 * holds: the backend's own excess over the turns (a compaction summary, a retried attempt), which
 * only runs from #563 on bill. `repriced` therefore counts turns alone on every run, and `recorded`
 * is the log's own bill (`billedAll`); their ratio shows how far each run's meter stood from today's
 * turn pricing.
 *
 * A promotion is a `harness.promoted` event; the first is set-up, as the closing report counts it. A
 * run still going has spent towards a promotion it has not made, so its dollars a promotion fall as it
 * goes on: such a run is marked live and left out of a group's pooled figure. Results are never
 * compared across settings (AGENTS.md section 9), so a group names its solver setting.
 *
 * It prints campaign names, counts and dollars, and never a task, an answer or a check.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { billedAll, roleOf, seatMeter } from "#src/kernel/meter.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { backends } from "#src/agent/backends/models.ts";
import { modelNamed, sweepOptions } from "#tools/m0/stored-sweep.ts";
import { packOf } from "#tools/runs/registry.ts";
import { printed } from "#skills/main/print.ts";
import { LIVE_MS } from "#skills/main/runs.ts";
import { campaignLogs, rehearsed } from "#skills/main/logs.ts";

const SINCE = "2026-10-01";
const BY = ["week", "pack", "setting", "none"] as const;
type By = (typeof BY)[number];
const USAGE = `usage:
  bun .claude/skills/promotion-tuner/scripts/cost.ts [--since <date>] [--name <part>]...
    [--by week|pack|setting|none] [--format md|tsv]

--since   campaigns whose last event is at or after this date; ${SINCE} by default
--name    these campaigns only, matched by part of the name (repeatable)
--by      how the finished runs are pooled beside the setting: week of launch (default), pack, or none
--format  md (default) or tsv`;
const OPTIONS = { since: "text", name: "list", by: "text", format: "text" } as const;
/** The seat of the opening each role's turns ran on, where no start of theirs names a model. */
const SEAT = new Map([
  ["builder", "builder"],
  ["examiner", "examiner"],
  ["referee", "reviewer"],
]);
const DAY_MS = 86_400_000;
/** A run whose log has been quiet this long, or whose last event is an ending, is not live
 *  (`LIVE_MS`, `table.ts`). */

interface Run {
  readonly name: string;
  readonly launched: number;
  readonly setting: string;
  readonly live: boolean;
  readonly promotions: number;
  readonly recorded: number;
  readonly repriced: number | null;
  readonly unpriced: string | null;
}

type Meter = ReturnType<typeof seatMeter>;

/** One meter a model, priced on today's catalogue as a live seat's is. */
function meters(): (name: string) => Meter {
  const models = backends(sweepOptions());
  const held = new Map<string, Meter>();
  return (name) => {
    const found = held.get(name);
    if (found !== undefined) return found;
    const meter = seatMeter(modelNamed(name));
    meter.catalogue(models);
    held.set(name, meter);
    return meter;
  };
}

/** The model each session or solve ran on, by the id its turns carry, and each role's seat. */
function modelsOf(events: readonly LogEvent[]) {
  const byId = new Map<string, string>();
  const bySeat = new Map<string, string>();
  for (const { kind, data } of events) {
    const seats =
      kind === "campaign.opened"
        ? asRecord(data.seats)
        : { solver: kind === "campaign.setting" ? data.solver : null };
    for (const [seat, held] of Object.entries(seats ?? {})) {
      const model = asRecord(held)?.model;
      if (isString(model)) bySeat.set(seat, model);
    }
    const id = data.session ?? data.solve;
    if (kind.endsWith(".started") && isString(id) && isString(data.model)) byId.set(id, data.model);
  }
  return ({ kind, data }: LogEvent) => {
    const id = data.session ?? data.solve;
    const role = roleOf(kind) ?? "";
    return (isString(id) ? byId.get(id) : undefined) ?? bySeat.get(SEAT.get(role) ?? role);
  };
}

/** Every recorded turn of a log at today's prices, or what stopped it being priced. */
function repricedOf(events: readonly LogEvent[], meterOf: (name: string) => Meter) {
  const modelOf = modelsOf(events);
  let total = 0;
  for (const event of events) {
    const usage = asRecord(event.data.usage);
    if (!event.kind.endsWith(".turn") || usage === null) continue;
    const model = modelOf(event);
    if (model === undefined) return { repriced: null, unpriced: `no model for ${event.kind}` };
    const [provider = "", ...id] = model.split("/");
    const served = event.data.responseModel;
    try {
      total += meterOf(model).turn({
        provider,
        model: id.join("/"),
        ...keyIfDefined("responseModel", isString(served) ? served : undefined),
        // SAFETY: a `*.turn` event's `usage` is the pi usage its seat recorded whole (`src/agent/session.ts`).
        usage: usage as never,
      });
    } catch (error) {
      return { repriced: null, unpriced: errorMessage(error) };
    }
  }
  return { repriced: total, unpriced: null };
}

function runOf(name: string, events: readonly LogEvent[], meterOf: (name: string) => Meter): Run | null {
  const [first, last] = [events[0], events.at(-1)];
  if (first === undefined || last === undefined || rehearsed(events)) return null;
  const solver = asRecord(events.find(({ kind }) => kind === "campaign.setting")?.data.solver);
  const [model, effort] = [solver?.model, solver?.effort];
  return {
    name,
    launched: Date.parse(first.at),
    setting: `${isString(model) ? model : "?"} ${isString(effort) ? effort : ""}`.trim(),
    live: last.kind !== "campaign.ended" && Date.now() - Date.parse(last.at) < LIVE_MS,
    promotions: events.filter(({ kind }) => kind === "harness.promoted").length,
    recorded: billedAll(events),
    ...repricedOf(events, meterOf),
  };
}

const money = (value: number | null) => (value === null ? "?" : value.toFixed(0));
const perPromotion = (dollars: number | null, promotions: number) =>
  dollars === null || promotions === 0 ? "-" : (dollars / promotions).toFixed(0);

function groupOf(run: Run, by: By): string {
  const part = {
    // Monday of the week it was launched in.
    week: `week of ${new Date(run.launched - ((new Date(run.launched).getUTCDay() + 6) % 7) * DAY_MS).toISOString().slice(0, 10)}`,
    pack: packOf(run.name),
    setting: "",
    none: "",
  }[by];
  return [part, run.setting].filter((piece) => piece !== "").join(" · ");
}

async function main(args: CommandArgs): Promise<number> {
  const asked = args.value("by") ?? "week";
  const by = BY.find((each) => each === asked);
  if (by === undefined) return args.die(`--by takes ${BY.join(", ")}; got ${asked}`);
  const format = args.value("format") ?? "md";
  if (format !== "md" && format !== "tsv") return args.die(`--format takes md or tsv; got ${format}`);
  const names = args.list("name");
  const meterOf = meters();
  const runs: Run[] = [];
  const skipped: string[] = [];
  for (const found of await campaignLogs(null, [], args.value("since") ?? SINCE)) {
    if (names.length > 0 && !names.some((part) => found.name.includes(part))) continue;
    try {
      const run = runOf(found.name, read(found.path), meterOf);
      if (run !== null) runs.push(run);
    } catch (error) {
      skipped.push(`${found.name}: ${errorMessage(error)}`);
    }
  }
  runs.sort((a, b) => a.launched - b.launched);
  const runHead = [
    "run",
    "launched",
    "setting",
    "state",
    "promotions",
    "recorded $",
    "repriced $",
    "repriced/recorded",
    "recorded $ a promotion",
    "repriced $ a promotion",
  ];
  console.log(
    printed(
      runHead,
      runs.map((run) => [
        run.name,
        new Date(run.launched).toISOString().slice(0, 10),
        run.setting,
        run.live ? "live" : "ended",
        String(run.promotions),
        money(run.recorded),
        run.repriced === null ? `? (${run.unpriced ?? ""})` : money(run.repriced),
        run.repriced === null || run.recorded === 0 ? "-" : (run.repriced / run.recorded).toFixed(2),
        perPromotion(run.recorded, run.promotions),
        perPromotion(run.repriced, run.promotions),
      ]),
      format,
    ),
  );
  const groups = new Map<string, Run[]>();
  for (const run of runs.filter(({ live, repriced }) => !live && repriced !== null)) {
    groups.set(groupOf(run, by), [...(groups.get(groupOf(run, by)) ?? []), run]);
  }
  const sum = (list: readonly Run[], key: "recorded" | "repriced" | "promotions") =>
    list.reduce((total, run) => total + (run[key] ?? 0), 0);
  console.log("");
  console.log(
    printed(
      [
        "group (finished runs)",
        "runs",
        "promoted",
        "promotions",
        "recorded $",
        "repriced $",
        "recorded $ a promotion",
        "repriced $ a promotion",
      ],
      [...groups].map(([group, list]) => [
        group,
        String(list.length),
        String(list.filter((run) => run.promotions > 0).length),
        String(sum(list, "promotions")),
        money(sum(list, "recorded")),
        money(sum(list, "repriced")),
        perPromotion(sum(list, "recorded"), sum(list, "promotions")),
        perPromotion(sum(list, "repriced"), sum(list, "promotions")),
      ]),
      format,
    ),
  );
  if (format === "tsv") return 0;
  console.log(
    "\nrepriced: every recorded turn at today's list prices through today's seat meter; it leaves out a backend's excess over its turns (compactions, retries), which only runs from #563 on record, so it is the one measure every run shares. A group pools its finished runs: all their dollars over all their promotions.",
  );
  if (skipped.length > 0) console.log(`not read (${String(skipped.length)}): ${skipped.join("; ")}`);
  return 0;
}

if (import.meta.main) await runCommand({ name: "cost", usage: USAGE, options: OPTIONS }, main);
