#!/usr/bin/env bun
/**
 * Inspects solve settings and identifies condition differences within comparisons.
 *
 *   bun .claude/skills/campaign-mechanics/scripts/conditions.ts <log.jsonl | campaign name>
 *
 * Scalar fields (`model`, `effort`, `compaction`, `side`) are printed verbatim; changed keys in
 * `limits` and `runtime` are listed explicitly; remaining fields are represented by short digests.
 * A changed `host` digest indicates a host code change between conditions. Output omits tasks,
 * answers, and checks, but remains exam-side and must stay untracked.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { short } from "#src/campaign/move.ts";
import { type Condition, conditionsOf, settingId } from "#src/kernel/condition.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { isString } from "#src/meta/json-shape.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { plural } from "#src/meta/text.ts";
import { logEvents } from "#tools/runs/registry.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

const USAGE = `usage: conditions.ts <log.jsonl | campaign name>

The settings a campaign's solves ran under, and what each comparison's solves differ in.`;

/** Fields included in a `Setting` (`condition.ts`), ordered to match `settingId` hashing. */
const SETTING = [
  "contract",
  "model",
  "effort",
  "prices",
  "runtime",
  "compaction",
  "verifierTools",
  "sandbox",
  "limits",
  "host",
  "side",
] as const satisfies readonly (keyof Condition)[];
/** Scalar fields printed in full rather than as short hashes. */
const WORDS: ReadonlySet<string> = new Set(["model", "effort", "compaction", "side"]);

type Field = (typeof SETTING)[number];

/** Started solve record with its resolved condition and associated session ID, or null if ungrouped. */
interface Started {
  readonly condition: Condition;
  readonly comparison: string | null;
}

/** Extracts every started solve whose condition is present in the log. */
function startedOf(events: readonly LogEvent[]): Started[] {
  const conditions = conditionsOf(events);
  return events.flatMap(({ kind, data }) => {
    const condition =
      kind === "solve.started" && isString(data.condition) ? conditions.get(data.condition) : undefined;
    if (condition === undefined) return [];
    return [{ condition, comparison: isString(data.comparison) ? data.comparison : null }];
  });
}

/** Returns a key-value map for the `limits` or `runtime` field of a condition. */
function keysOf(
  field: "limits" | "runtime",
  side: Condition,
): ReadonlyMap<string, string | number | undefined> {
  return field === "limits"
    ? new Map<string, number | undefined>(Object.entries(side.limits))
    : new Map(Object.entries(side.runtime));
}

/** Describes how a single setting field changed between two conditions, or returns null if unchanged. */
function moved(field: Field, before: Condition, after: Condition): string | null {
  const [was, now] = [before[field], after[field]];
  if (hashJsonValue(was) === hashJsonValue(now)) return null;
  if (WORDS.has(field) && isString(was) && isString(now)) return `${field} ${was} to ${now}`;
  if (field === "limits" || field === "runtime") {
    const [one, other] = [keysOf(field, before), keysOf(field, after)];
    const keys = [...new Set([...one.keys(), ...other.keys()])].filter(
      (key) => one.get(key) !== other.get(key),
    );
    return `${field} ${keys.map((key) => `${key} ${String(one.get(key) ?? "none")} to ${String(other.get(key) ?? "none")}`).join(", ")}`;
  }
  return `${field} ${short(hashJsonValue(was))} to ${short(hashJsonValue(now))}`;
}

/** Returns the setting fields (excluding harness, tool tree, and task) that vary across `conditions`. */
export function differing(conditions: readonly Condition[]): Field[] {
  return SETTING.filter((field) => new Set(conditions.map((each) => hashJsonValue(each[field]))).size > 1);
}

/** Formats the condition summary lines for `events`. */
export function conditionLines(events: readonly LogEvent[]): string[] {
  const started = startedOf(events);
  const settings = new Map<string, { condition: Condition; solves: number }>();
  for (const { condition } of started) {
    const id = settingId(condition);
    const known = settings.get(id);
    settings.set(id, { condition, solves: (known?.solves ?? 0) + 1 });
  }
  const order = [...settings];
  const settingLines = order.map(([id, { condition, solves }], at) => {
    const before = order[at - 1]?.[1].condition;
    const changes =
      before === undefined ? [] : SETTING.flatMap((field) => moved(field, before, condition) ?? []);
    const from =
      before === undefined ? `${condition.model} at ${condition.effort}` : `changed: ${changes.join("; ")}`;
    return `setting ${String(at + 1)} (${short(id)}): ${plural(solves, "solve")}; ${from}`;
  });
  const groups = Map.groupBy(started, ({ comparison }) => comparison);
  // A solve's session ID identifies either a comparison or an Examiner session's room solves.
  const compared = new Set(
    events.flatMap(({ kind, data }) =>
      kind === "comparison.started" && isString(data.session) ? [data.session] : [],
    ),
  );
  const groupLine = (label: string, solves: readonly Started[]) => {
    const conditions = solves.map(({ condition }) => condition);
    const harnesses = new Set(conditions.map(({ harness }) => harness)).size;
    const ids = new Set(conditions.map((condition) => settingId(condition))).size;
    const fields = differing(conditions);
    const differs = fields.length === 0 ? ": comparable" : `: differs in ${fields.join(", ")}`;
    const verdict = label.startsWith("comparison") ? differs : "";
    const harnessed = `${String(harnesses)} ${harnesses === 1 ? "harness" : "harnesses"}`;
    return `${label}: ${plural(solves.length, "solve")}, ${harnessed}, ${plural(ids, "setting")}${verdict}`;
  };
  return [
    `${plural(started.length, "solve")} under ${plural(new Set(started.map(({ condition }) => hashJsonValue(condition))).size, "condition")} and ${plural(settings.size, "setting")}`,
    ...settingLines,
    ...[...groups].flatMap(([id, solves]) =>
      id === null ? [] : [groupLine(compared.has(id) ? `comparison ${id}` : `room solves of ${id}`, solves)],
    ),
    ...(groups.has(null) ? [groupLine("practice and other solves", groups.get(null) ?? [])] : []),
  ];
}

if (import.meta.main) {
  await runCommand({ name: "conditions", usage: USAGE, positionals: 1 }, async (args: CommandArgs) => {
    const [named = ""] = args.positionals;
    console.log(conditionLines(logEvents(await logAcross(named))).join("\n"));
  });
}
