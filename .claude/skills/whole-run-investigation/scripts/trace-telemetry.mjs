import { caseTraceFacts, foldTraceFacts, mergeToolStats } from "#tools/outcome/trace-facts.ts";

function summarize(records, includeFamilies = true) {
  const recorded = records.filter((record) => record.facts !== null);
  const calls = recorded.reduce((sum, record) => sum + (record.facts.toolCalls ?? 0), 0);
  const tools = Object.entries(mergeToolStats(recorded.map((record) => record.facts.byTool)))
    .map(([name, stat]) => ({ name, ...stat, share: calls === 0 ? null : stat.calls / calls }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
  const counts = new Map();
  for (const record of recorded) {
    const sequence = record.facts.toolNames.join(" -> ");
    counts.set(sequence, (counts.get(sequence) ?? 0) + 1);
  }
  const sequences = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const summary = {
    cases: { seen: records.length, recorded: recorded.length },
    ...foldTraceFacts(recorded.map((record) => record.facts)),
    tools,
    sequences: { distinct: sequences.length, frequencies: sequences },
  };
  if (!includeFamilies) return summary;
  const families = new Map();
  for (const record of records) {
    const family = families.get(record.family) ?? [];
    family.push(record);
    families.set(record.family, family);
  }
  return {
    ...summary,
    families: Object.fromEntries(
      [...families.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([family, rows]) => [family, summarize(rows, false)]),
    ),
  };
}

function pairedComparison(leftId, left, rightId, right) {
  const rightByTask = new Map(right.map((record) => [record.taskId, record]));
  const pairs = left
    .map((record) => [record, rightByTask.get(record.taskId)])
    .filter((pair) => pair[1] !== undefined && pair[0].facts !== null && pair[1].facts !== null);
  if (pairs.length === 0) return null;
  const changed = (pick) => pairs.filter(([a, b]) => pick(a) !== pick(b)).length;
  const delta = (pick) => pairs.reduce((sum, [a, b]) => sum + pick(b) - pick(a), 0);
  const taskDiffs = pairs
    .map(([a, b]) => ({
      taskId: a.taskId,
      family: a.family,
      left: {
        turns: a.facts.turns,
        toolCalls: a.facts.toolCalls,
        sequence: a.facts.toolNames,
        outcome: a.outcome,
      },
      right: {
        turns: b.facts.turns,
        toolCalls: b.facts.toolCalls,
        sequence: b.facts.toolNames,
        outcome: b.outcome,
      },
    }))
    .filter((pair) => JSON.stringify(pair.left) !== JSON.stringify(pair.right));
  return {
    left: leftId,
    right: rightId,
    sharedRecordedTasks: pairs.length,
    turnsChanged: changed((record) => record.facts.turns),
    toolCallsChanged: changed((record) => record.facts.toolCalls),
    sequencesChanged: changed((record) => record.facts.toolNames.join("\u0000")),
    outcomesChanged: changed((record) => record.outcome),
    rightMinusLeftTurns: delta((record) => record.facts.turns ?? 0),
    rightMinusLeftToolCalls: delta((record) => record.facts.toolCalls ?? 0),
    taskDiffs,
  };
}

/** Aggregate trace structure verified by the caller; include no prompt, argument or result text. */
export function buildTraceTelemetry(records) {
  const normalized = records.map((record) => ({
    runId: record.runId,
    taskId: record.taskId,
    family: record.family,
    outcome: record.outcome,
    facts: record.trace === null ? null : caseTraceFacts(record.trace),
  }));
  const grouped = new Map();
  for (const record of normalized) {
    const rows = grouped.get(record.runId) ?? [];
    rows.push(record);
    grouped.set(record.runId, rows);
  }
  const batteries = Object.fromEntries(
    [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, rows]) => [id, summarize(rows)]),
  );
  const entries = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  const paired = [];
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      const a = entries[left];
      const b = entries[right];
      if (a === undefined || b === undefined) continue;
      const comparison = pairedComparison(a[0], a[1], b[0], b[1]);
      if (comparison !== null) paired.push(comparison);
    }
  }
  return { schema: "whole-run-trace-telemetry/v1", batteries, paired };
}
