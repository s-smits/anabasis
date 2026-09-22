import { sha256 } from "#src/meta/digest.ts";
import { canonicalJson } from "#src/meta/stable-json.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";

const round = (value) => Math.round(value * 10_000) / 10_000;
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function tasksFromText(text) {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value.filter((task) => asRecord(task) !== null) : null;
  } catch {
    return null;
  }
}

function frequencies(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function cosine(left, right) {
  const a = frequencies(left);
  const b = frequencies(right);
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (const count of a.values()) aa += count * count;
  for (const count of b.values()) bb += count * count;
  for (const [token, count] of a) dot += count * (b.get(token) ?? 0);
  return aa === 0 || bb === 0 ? 0 : dot / Math.sqrt(aa * bb);
}

function quantile(values, fraction) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor((ordered.length - 1) * fraction)] ?? null;
}

function flatten(value, path = "$", out = new Map()) {
  const append = (key, fact) => out.set(key, out.has(key) ? `${out.get(key)}\u0000${fact}` : fact);
  if (Array.isArray(value)) {
    if (value.length === 0) append(path, "array:empty");
    for (let index = 0; index < value.length; index += 1) flatten(value[index], `${path}[]`, out);
    return out;
  }
  const object = asRecord(value);
  if (object !== null) {
    const entries = Object.entries(object).sort(([a], [b]) => compareText(a, b));
    if (entries.length === 0) append(path, "object:empty");
    for (const [key, child] of entries) flatten(child, `${path}.${key}`, out);
    return out;
  }
  append(path, `${value === null ? "null" : typeof value}:${canonicalJson(value)}`);
  return out;
}

function changedPaths(left, right) {
  const a = flatten(left);
  const b = flatten(right);
  return [...new Set([...a.keys(), ...b.keys()])].filter((path) => a.get(path) !== b.get(path)).sort();
}

function taskRows(tasks) {
  return tasks.map((task, index) => {
    const projected = {
      family: isString(task.family) ? task.family : "<missing>",
      publicInput: task.publicInput ?? null,
    };
    const textTokens =
      canonicalJson(projected)
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? [];
    return {
      task,
      taskId: isString(task.taskId) ? task.taskId : `<index:${index}>`,
      family: projected.family,
      projected,
      digest: sha256(canonicalJson(projected)),
      tokens: textTokens,
      pathSignature: [...flatten(projected.publicInput).keys()].join("\n"),
    };
  });
}

function duplicateGroups(rows) {
  const groups = new Map();
  for (const row of rows) groups.set(row.digest, [...(groups.get(row.digest) ?? []), row.taskId]);
  return groups
    .entries()
    .filter(([, taskIds]) => taskIds.length > 1)
    .map(([digest, taskIds]) => ({ digest, taskIds: [...taskIds].sort(compareText) }))
    .toArray()
    .sort((a, b) => compareText(a.digest, b.digest));
}

function closestPairs(rows) {
  const pairs = [];
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      const a = rows[left];
      const b = rows[right];
      if (a.family !== b.family) continue;
      pairs.push({
        left: a.taskId,
        right: b.taskId,
        family: a.family,
        cosine: round(cosine(a.tokens, b.tokens)),
        samePublicLayout: a.pathSignature === b.pathSignature,
      });
    }
  }
  return pairs.sort((a, b) => b.cosine - a.cosine || compareText(a.left, b.left)).slice(0, 8);
}

function familyCounts(rows) {
  const counts = {};
  for (const row of rows) counts[row.family] = (counts[row.family] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => compareText(a, b)));
}

export function taskSetFacts(text) {
  const tasks = tasksFromText(text);
  if (tasks === null) return { state: "unobservable", reason: "tasks.json is not a JSON array" };
  const rows = taskRows(tasks);
  const allTokens = rows.flatMap((row) => row.tokens);
  const pairs = closestPairs(rows);
  const familyPairs = [];
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      if (rows[left].family === rows[right].family) {
        familyPairs.push(cosine(rows[left].tokens, rows[right].tokens));
      }
    }
  }
  const uniqueLayouts = new Set(rows.map((row) => row.pathSignature)).size;
  return {
    state: "recorded",
    tasks: rows.length,
    families: familyCounts(rows),
    publicInputLayouts: uniqueLayouts,
    exactPublicDuplicates: duplicateGroups(rows),
    lexical: {
      tokens: allTokens.length,
      uniqueTokens: new Set(allTokens).size,
      medianSameFamilyCosine: familyPairs.length === 0 ? null : round(quantile(familyPairs, 0.5)),
      p90SameFamilyCosine: familyPairs.length === 0 ? null : round(quantile(familyPairs, 0.9)),
      closestPairs: pairs,
    },
  };
}

function taskLink(previousRows, current) {
  const parentId = isString(current.task.parentTaskId) ? current.task.parentTaskId : null;
  const parent = parentId === null ? null : (previousRows.find((row) => row.taskId === parentId) ?? null);
  if (parent !== null) return { row: parent, kind: "parentTaskId" };
  const sameId = previousRows.find((row) => row.taskId === current.taskId) ?? null;
  if (sameId !== null) return { row: sameId, kind: "sameTaskId" };
  const family = previousRows.filter((row) => row.family === current.family);
  const closest =
    family
      .map((row) => ({ row, score: cosine(row.tokens, current.tokens) }))
      .sort((a, b) => b.score - a.score || compareText(a.row.taskId, b.row.taskId))[0]?.row ?? null;
  return { row: closest, kind: closest === null ? "unmatched" : "nearestLexical" };
}

export function taskTransitionFacts(previousText, currentText) {
  const previous = tasksFromText(previousText);
  const current = tasksFromText(currentText);
  if (previous === null || current === null) {
    return { state: "unobservable", reason: "one tasks.json is not a JSON array" };
  }
  const before = taskRows(previous);
  const after = taskRows(current);
  const previousDigests = new Set(before.map((row) => row.digest));
  const pathCounts = new Map();
  const similarities = [];
  const linkKinds = { parentTaskId: 0, sameTaskId: 0, nearestLexical: 0, unmatched: 0 };
  for (const row of after) {
    const link = taskLink(before, row);
    linkKinds[link.kind] += 1;
    if (link.row === null) continue;
    similarities.push(cosine(link.row.tokens, row.tokens));
    for (const path of changedPaths(link.row.projected.publicInput, row.projected.publicInput)) {
      pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
    }
  }
  const beforeTokens = new Set(before.flatMap((row) => row.tokens));
  const afterTokens = new Set(after.flatMap((row) => row.tokens));
  const newTokens = [...afterTokens].filter((token) => !beforeTokens.has(token)).length;
  return {
    state: "recorded",
    previousTasks: before.length,
    currentTasks: after.length,
    linkKinds,
    exactPublicRepeats: after.filter((row) => previousDigests.has(row.digest)).length,
    vocabulary: {
      previous: beforeTokens.size,
      current: afterTokens.size,
      added: newTokens,
      removed: [...beforeTokens].filter((token) => !afterTokens.has(token)).length,
    },
    linkedLexicalCosine: {
      min: similarities.length === 0 ? null : round(Math.min(...similarities)),
      median: similarities.length === 0 ? null : round(quantile(similarities, 0.5)),
      max: similarities.length === 0 ? null : round(Math.max(...similarities)),
    },
    changedPublicInputPaths: [...pathCounts.entries()]
      .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
      .slice(0, 16)
      .map(([path, tasks]) => ({ path, tasks })),
  };
}
