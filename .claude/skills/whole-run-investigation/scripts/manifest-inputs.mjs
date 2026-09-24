import { sha256 } from "#src/meta/digest.ts";
import { existsSync, readFileSync, realpathSync } from "#src/meta/filesystem.ts";
import { isBoolean, isString } from "#src/meta/json-shape.ts";
import { homedir } from "#src/meta/os.ts";
import { isAbsolute, join, resolve } from "#src/meta/path.ts";
import { exitWith } from "#skills/main/cli.ts";
import { gitText } from "#skills/main/git.ts";
import {
  ANGLE_COUNT,
  DETERMINISTIC_ROWS,
  GIT_SHA,
  ISOLATED_ANGLES,
  SHA256 as SHA_256,
} from "./catalogue-shape.mjs";
import { readJsonFile } from "#src/meta/completed-json.ts";

export const ORIENTATION_HEADING = "orientation";
/** Maximum nonblank lines in the shared reviewer orientation. */
const ORIENTATION_MAX_LINES = 20;
const ANGLE_HEADING = /^\*\*(\d+)\.\s+(.+?)\*\*/;
const DETERMINISTIC_ROW_HEADING = /^\*\*([A-I])\.\s+(.+?)\*\*/;
const DETERMINISTIC_SESSION_HEADING = /^\*\*session\s+\d+\b.*\*\*/i;
const REQUIRED_SHARED_VIEWS = ["digest", "review-yield", "builder"];
const REQUIRED_RUN_VIEWS = [
  "default",
  "scan",
  "scorecard",
  "observations-warning",
  "cases-fail",
  "cases-unaccepted",
  "cases-non-result",
  "cases-pass",
];
export const BLINDED_PAIRS = [
  ["angle_05", "angle_06"],
  ["angle_07", "angle_08"],
  ["angle_19", "angle_20"],
];

export const manifestFail = exitWith("build-manifest");

function slug(title) {
  return title
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function unwrap(text) {
  return text
    .split(/\n{2,}/)
    .flatMap((block) => block.replace(/\s*\n\s*/g, " ").trim() || [])
    .join("\n\n");
}

function headingSection(skill, heading) {
  const start = skill.indexOf(heading);
  if (start === -1) return "";
  const rest = skill.slice(start);
  const end = rest.indexOf("\n## ");
  return end === -1 ? rest : rest.slice(0, end);
}

function sessionRows(section) {
  const sessions = new Map();
  for (const line of section.split("\n")) {
    const match = /^\|\s*\*\*(.+?)\*\*\s*\|(.+?)\|(.+?)\|\s*$/.exec(line);
    if (!match) continue;
    const [, title, trigger, body] = match;
    if (/^\d/.test(title.trim())) continue;
    sessions.set(slug(title), {
      kind: "intelligence",
      title: title.trim(),
      trigger: trigger.trim(),
      body: body.trim(),
    });
  }
  return sessions;
}

export function intelligenceSessions(skill) {
  const admitted = sessionRows(headingSection(skill, "## Admit useful sessions"));
  const reference = sessionRows(headingSection(skill, "## Reference-comparison sessions"));
  return new Map([...admitted, ...reference]);
}

function angleStartsAndBoundaries(lines) {
  const starts = [];
  const deterministic = [];
  const boundaries = [];
  lines.forEach((line, index) => {
    const match = ANGLE_HEADING.exec(line);
    if (match) {
      starts.push({ index, number: Number(match[1]), title: match[2].replace(/\.$/, "") });
      boundaries.push(index);
      return;
    }
    const row = DETERMINISTIC_ROW_HEADING.exec(line);
    if (row) {
      deterministic.push({ index, letter: row[1] });
      boundaries.push(index);
    } else if (/^##\s/.test(line) || DETERMINISTIC_SESSION_HEADING.test(line)) {
      boundaries.push(index);
    }
  });
  return { starts, deterministic, boundaries };
}

function validateCatalogueRows(starts, deterministic) {
  const expectedRows = [...DETERMINISTIC_ROWS];
  const actualRows = deterministic.map((row) => row.letter);
  if (
    actualRows.length !== expectedRows.length ||
    actualRows.some((letter, index) => letter !== expectedRows[index])
  ) {
    manifestFail(
      `review-angle catalogue must declare deterministic rows ${DETERMINISTIC_ROWS[0]}-${DETERMINISTIC_ROWS.at(-1)} exactly once and in order; found ${actualRows.join(", ")}`,
    );
  }
  const expected = Array.from({ length: ANGLE_COUNT }, (_, index) => index + 1);
  const actual = starts.map((start) => start.number);
  if (actual.length !== expected.length || actual.some((number, index) => number !== expected[index])) {
    manifestFail(
      `review-angle catalogue must declare angles 1-${ANGLE_COUNT} exactly once and in order; found ${actual.join(", ")}`,
    );
  }
  if (deterministic.at(-1).index > starts[0].index) {
    manifestFail(
      `review-angle catalogue must keep deterministic rows ${DETERMINISTIC_ROWS[0]}-${DETERMINISTIC_ROWS.at(-1)} before semantic angle 1`,
    );
  }
}

export function angleSessions(skill) {
  const lines = skill.split("\n");
  const { starts, deterministic, boundaries } = angleStartsAndBoundaries(lines);
  validateCatalogueRows(starts, deterministic);
  const sessions = new Map();
  for (const start of starts) {
    const end = boundaries.find((index) => index > start.index) ?? lines.length;
    const rawBody = lines.slice(start.index, end).join("\n");
    if (DETERMINISTIC_SESSION_HEADING.test(rawBody)) {
      manifestFail(`angle ${start.number} contains a deterministic session declaration`);
    }
    const number = String(start.number).padStart(2, "0");
    sessions.set(`angle_${number}`, {
      kind: "angle",
      name: `angle_${number}`,
      number: start.number,
      title: `${start.number}. ${start.title}`,
      trigger: null,
      body: unwrap(rawBody),
    });
  }
  return sessions;
}

function blindedPartners(angles) {
  const partner = new Map();
  for (const [a, b] of BLINDED_PAIRS) {
    if (angles.some((angle) => angle.name === a) && angles.some((angle) => angle.name === b)) {
      partner.set(a, b);
      partner.set(b, a);
    }
  }
  return partner;
}

function requiredCuts(angles, partner) {
  const cuts = new Set();
  angles.forEach((angle, index) => {
    const next = angles[index + 1];
    if (next && partner.get(angle.name) === next.name) cuts.add(index);
  });
  angles.forEach((angle, index) => {
    if (!ISOLATED_ANGLES.has(angle.number)) return;
    if (index > 0) cuts.add(index - 1);
    if (index < angles.length - 1) cuts.add(index);
  });
  return cuts;
}

function contiguousGroupSizes(total, count, requiredCutAfter) {
  const memo = new Map();
  function best(start, groups) {
    const key = `${start}:${groups}`;
    if (memo.has(key)) return memo.get(key);
    let result = null;
    if (groups === 1) {
      const valid = !Array.from({ length: total - start - 1 }, (_, i) => start + i).some((gap) =>
        requiredCutAfter.has(gap),
      );
      if (valid) result = { cost: (total - start) ** 2, sizes: [total - start] };
    } else {
      for (let len = 1; len <= total - start - groups + 1; len += 1) {
        const innerCut = Array.from({ length: len - 1 }, (_, i) => start + i).some((gap) =>
          requiredCutAfter.has(gap),
        );
        if (innerCut) continue;
        const rest = best(start + len, groups - 1);
        if (!rest) continue;
        const cost = len ** 2 + rest.cost;
        if (!result || cost < result.cost) result = { cost, sizes: [len, ...rest.sizes] };
      }
    }
    memo.set(key, result);
    return result;
  }
  return best(0, count)?.sizes ?? null;
}

function contiguousGroups(angles, sizes) {
  const groups = [];
  let cursor = 0;
  for (const size of sizes) {
    groups.push(angles.slice(cursor, cursor + size));
    cursor += size;
  }
  return groups;
}

function mixedGroups(angles, count, partner) {
  const groups = Array.from({ length: count }, () => []);
  const hasPartner = (group, name) => group.some((member) => partner.get(member.name) === name);
  const isolated = angles.filter((angle) => ISOLATED_ANGLES.has(angle.number));
  if (count < isolated.length + 2) {
    manifestFail("too few sessions to preserve isolated lanes and blinded pairs");
  }
  isolated.forEach((angle, index) => groups[index].push(angle));
  for (const angle of angles) {
    if (ISOLATED_ANGLES.has(angle.number)) continue;
    const choices = groups
      .map((group, index) => ({ group, index }))
      .filter(({ group, index }) => index >= isolated.length && !hasPartner(group, angle.name))
      .sort((a, b) => a.group.length - b.group.length || a.index - b.index);
    const choice = choices[0];
    if (choice === undefined) {
      manifestFail("no legal session remains for an angle; blinded pairs cannot be placed");
    }
    choice.group.push(angle);
  }
  return groups.filter((group) => group.length > 0);
}

export function partitionAngles(angles, count) {
  if (count > angles.length) {
    manifestFail(
      `--auto ${count} asks for more sessions than the ${angles.length} angles declared; at most one angle per session`,
    );
  }
  const partner = blindedPartners(angles);
  const cuts = requiredCuts(angles, partner);
  const sizes = contiguousGroupSizes(angles.length, count, cuts);
  if (sizes) return { groups: contiguousGroups(angles, sizes), mixed: false };
  console.error(
    `build-manifest: --auto ${count} cannot give every blinded pair its own contiguous split ` +
      `(${cuts.size} are forced); falling back to balanced non-contiguous grouping`,
  );
  return { groups: mixedGroups(angles, count, partner), mixed: true };
}

// The session index carries one sentence per row so a reviewer can select sessions without loading the
// whole catalogue. It is only useful while it names the same rows, so a drift refuses the build.
export function assertIndexMatchesCatalogue(index, angles) {
  const indexed = angleSessions(index);
  const declared = angleSessions(angles);
  for (const [name, session] of declared) {
    const row = indexed.get(name);
    if (!row) manifestFail(`session index does not declare ${name}; add its one-sentence row`);
    if (row.title !== session.title) {
      manifestFail(
        `session index title for ${name} is "${row.title}" but the catalogue says "${session.title}"`,
      );
    }
  }
  for (const name of indexed.keys()) {
    if (!declared.has(name)) manifestFail(`session index declares ${name}, which the catalogue does not`);
  }
}

function sessionMemberName(token) {
  const match = /^(?:angle_)?(\d{1,2})$/.exec(token);
  if (!match) return token;
  const number = Number(match[1]);
  if (number < 1 || number > ANGLE_COUNT) return token;
  return `angle_${String(number).padStart(2, "0")}`;
}

function sessionMembers(token, problems) {
  const range = /^(?:angle_)?(\d{1,2})\s*-\s*(?:angle_)?(\d{1,2})$/.exec(token);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (from > to) {
      problems.push(`session range \`${token}\` runs backwards; write it low to high`);
      return [];
    }
    return Array.from({ length: to - from + 1 }, (_, offset) => sessionMemberName(String(from + offset)));
  }
  return token.split("+").map((part) => sessionMemberName(part.trim()));
}

function sessionGroupName(members) {
  if (members.length === 1) return members[0].name;
  const numbers = members.map((member) => String(member.session.number).padStart(2, "0"));
  const contiguous = members.every(
    (member, index) => index === 0 || member.session.number === members[index - 1].session.number + 1,
  );
  return contiguous ? `angles_${numbers[0]}_${numbers.at(-1)}` : `angles_${numbers.join("_")}`;
}

function validateSessionGroup(members, problems) {
  const named = members.filter((member) => member.session.kind !== "angle");
  if (named.length > 0 && members.length > 1) {
    problems.push(
      `\`${named[0].name}\` is a whole session and cannot share a session; give it its own comma-separated entry`,
    );
    return false;
  }
  const isolated = members.find((member) => ISOLATED_ANGLES.has(member.session.number));
  if (members.length > 1 && isolated) {
    problems.push(
      `angle ${isolated.session.number} ${ISOLATED_ANGLES.get(isolated.session.number)} and must be its own session`,
    );
    return false;
  }
  for (const [first, second] of BLINDED_PAIRS) {
    if (members.some((member) => member.name === first) && members.some((member) => member.name === second)) {
      problems.push(
        `blinded pair ${first} and ${second} cannot share one session; give each its own ` +
          "comma-separated entry",
      );
      return false;
    }
  }
  return true;
}

// `--sessions 4,7-9,mechanism`: commas separate sessions, `-` is a contiguous angle range inside one
// session and `+` joins arbitrary angles into one session.
export function parseSessionSpec(spec, declared) {
  const problems = [];
  const groups = [];
  const claimed = new Map();
  for (const entry of spec.split(",").flatMap((value) => value.trim() || [])) {
    const members = [];
    for (const name of sessionMembers(entry, problems)) {
      const session = declared.get(name);
      if (!session) {
        problems.push(
          `unknown session \`${name}\` in \`${entry}\` — run with --list to see the declared names`,
        );
        continue;
      }
      if (claimed.has(name)) {
        problems.push(`\`${name}\` is selected twice, in \`${claimed.get(name)}\` and \`${entry}\``);
      }
      claimed.set(name, entry);
      members.push({ name, session });
    }
    if (members.length === 0) continue;
    if (!validateSessionGroup(members, problems)) continue;
    groups.push({ name: sessionGroupName(members), members });
  }
  if (groups.length === 0 && problems.length === 0) problems.push(`--sessions "${spec}" selected no session`);
  return { groups, problems };
}

export function referenceSessionNames(skill) {
  return new Set(sessionRows(headingSection(skill, "## Reference-comparison sessions")).keys());
}

export function referenceIdentity(root) {
  if (!existsSync(root)) manifestFail(`--consumer-hardware: no reference tree at ${root}`);
  const git = (...args) => {
    try {
      return gitText(root, ...args);
    } catch (error) {
      manifestFail(`--consumer-hardware: git ${args.join(" ")} failed under ${root}: ${error.message}`);
    }
  };
  return { root, revision: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain").length > 0 };
}

export function defaultReferenceRoot(value) {
  return resolve(value ?? join(homedir(), "Developer", "schematik-rebuild"));
}

export function retiredAngles(skill) {
  const retired = new Map();
  const section = skill.slice(skill.indexOf("## Admit useful sessions"));
  for (const line of section.split("\n")) {
    const match = /^\|\s*([A-I])\s+(.+?)\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
    if (match) retired.set(match[1], { name: match[2], owner: match[3] });
  }
  return retired;
}

function snapshotLabels(runIds) {
  return [
    ...REQUIRED_SHARED_VIEWS,
    ...runIds.flatMap((runId) => REQUIRED_RUN_VIEWS.map((mode) => `${runId}-${mode}`)),
  ];
}

function snapshotViewFile(dir, view) {
  if (!isString(view.file) || view.file.length === 0 || /[/\\]/.test(view.file)) {
    manifestFail(`snapshot view ${view.label ?? "<unnamed>"} has an invalid file name`);
  }
  if (!Number.isInteger(view.bytes) || view.bytes < 0 || !SHA_256.test(view.sha256 ?? "")) {
    manifestFail(`snapshot view ${view.label} has no valid byte count and sha256`);
  }
  const path = join(dir, view.file);
  if (!existsSync(path)) manifestFail(`snapshot view ${view.label} names a missing file: ${path}`);
  const bytes = readFileSync(path);
  const actualBytes = bytes.byteLength;
  const actualSha256 = sha256(bytes);
  if (actualBytes !== view.bytes) {
    manifestFail(
      `snapshot view ${view.label} byte count drifted: expected ${view.bytes}, received ${actualBytes}`,
    );
  }
  if (actualSha256 !== view.sha256) {
    manifestFail(
      `snapshot view ${view.label} digest drifted: expected ${view.sha256}, received ${actualSha256}`,
    );
  }
  if (view.status === "ok" && bytes.byteLength === 0) {
    manifestFail(`snapshot view ${view.label} is empty but marked ok`);
  }
  return path;
}

/** The first informative line of a captured view failure, bounded for an instruction packet. */
function capturedErrorHead(path) {
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const head =
    lines.find((line) => /^error[: ]/i.test(line)) ??
    lines.find((line) => /exited \d+/.test(line)) ??
    lines.at(-1) ??
    "no captured output";
  return head.length > 240 ? `${head.slice(0, 237)}...` : head;
}

/** @param {string | null} [expectedWorktree] */
function verifyWorktree(status, expectedWorktree = null) {
  if (!isString(status.worktree?.path) || !isAbsolute(status.worktree.path)) {
    manifestFail("snapshot worktree must name an absolute path");
  }
  if (!GIT_SHA.test(String(status.worktree?.head ?? ""))) {
    manifestFail("snapshot worktree must carry one concrete 40-character HEAD");
  }
  if (!GIT_SHA.test(String(status.source?.commit ?? ""))) {
    manifestFail("snapshot source must carry one concrete 40-character commit");
  }
  if (!SHA_256.test(String(status.source?.sourceDigest ?? ""))) {
    manifestFail("snapshot source must carry a concrete 64-character source digest");
  }
  if (!isBoolean(status.source?.dirty)) manifestFail("snapshot source must disclose dirty as boolean");
  if (!isBoolean(status.worktree?.dirty)) manifestFail("snapshot worktree must disclose dirty as boolean");
  if (status.repo !== status.worktree.path) manifestFail("snapshot repository and worktree paths differ");
  if (status.source.commit !== status.worktree.head) {
    manifestFail(
      `snapshot source commit ${status.source.commit} differs from worktree HEAD ${status.worktree.head}`,
    );
  }
  if (!existsSync(status.worktree.path)) {
    manifestFail(`snapshot worktree does not exist: ${status.worktree.path}`);
  }
  if (expectedWorktree !== null) {
    if (!existsSync(expectedWorktree)) {
      manifestFail(`requested --worktree does not exist: ${expectedWorktree}`);
    }
    if (realpathSync(expectedWorktree) !== realpathSync(status.worktree.path)) {
      manifestFail("requested --worktree differs from the snapshot worktree, even though its HEAD may match");
    }
  }
  if (status.source.dirty === true || status.worktree.dirty === true) {
    manifestFail("snapshot refuses a dirty measured worktree; recapture from a clean source");
  }
  let head;
  try {
    head = gitText(status.worktree.path, "rev-parse", "HEAD");
  } catch (error) {
    manifestFail(`could not resolve snapshot worktree HEAD: ${error.message}`);
  }
  if (head !== status.worktree.head) {
    manifestFail(`worktree HEAD drifted: expected ${status.worktree.head}, received ${head}`);
  }
  const dirty = gitText(status.worktree.path, "status", "--porcelain", "--untracked-files=no").length > 0;
  if (dirty !== status.worktree.dirty) {
    manifestFail(
      `snapshot worktree dirty flag drifted: expected ${status.worktree.dirty}, received ${dirty}`,
    );
  }
  if (dirty) manifestFail("snapshot refuses a dirty measured worktree; recapture from a clean source");
}

/** The Bun release the measured worktree pins in package.json `engines.bun`. Reading the pin from
 *  the tree keeps a Bun upgrade to one edit; a snapshot taken with another Bun ran the outcome
 *  readers on a runtime the run never used. */
function measuredBunPin(worktreePath) {
  if (!isString(worktreePath)) manifestFail("snapshot worktree path must be a string");
  const manifestPath = join(worktreePath, "package.json");
  if (!existsSync(manifestPath)) manifestFail(`measured worktree has no package.json at ${manifestPath}`);
  const pin = readJsonFile(manifestPath)?.engines?.bun;
  if (!isString(pin) || !/^\d+\.\d+\.\d+$/.test(pin)) {
    manifestFail(
      `measured worktree package.json must pin engines.bun as x.y.z; received ${pin ?? "missing"}`,
    );
  }
  return pin;
}

/** @param {string | null} [expectedWorktree] the --worktree the operator named, which must be
 *  the one the snapshot measured */
export function loadSnapshot(dir, expectedWorktree = null) {
  const statusPath = join(dir, "snapshot-status.json");
  if (!existsSync(statusPath)) {
    manifestFail(`no snapshot-status.json under ${dir}; run trace-review.mjs first`);
  }
  const status = readJsonFile(statusPath);
  if (status.schema !== "outcome-snapshot-status/v2") {
    manifestFail(
      `snapshot schema must be outcome-snapshot-status/v2; received ${status.schema ?? "missing"}`,
    );
  }
  const bunPin = measuredBunPin(status.worktree?.path);
  if (status.runtime?.version !== bunPin || !String(status.runtime?.executable ?? "").startsWith("/")) {
    manifestFail(
      `snapshot runtime must name an absolute Bun ${bunPin} executable (the measured worktree pins it in package.json); ` +
        `received ${status.runtime?.version ?? "missing"} at ${status.runtime?.executable ?? "missing"}`,
    );
  }
  if (
    !Array.isArray(status.runIds) ||
    status.runIds.length !== 1 ||
    new Set(status.runIds).size !== 1 ||
    !isString(status.runIds[0]) ||
    status.runIds[0].length === 0
  ) {
    manifestFail("snapshot must name exactly one concrete runId");
  }
  verifyWorktree(status, expectedWorktree);
  if (!Array.isArray(status.views)) manifestFail("snapshot views must be an array");
  const labels = status.views.map((view) => view.label);
  if (labels.some((label) => !isString(label)) || new Set(labels).size !== labels.length) {
    manifestFail("snapshot view labels must be unique strings");
  }
  const missing = snapshotLabels(status.runIds).filter((label) => !labels.includes(label));
  if (missing.length > 0) manifestFail(`snapshot is missing required views: ${missing.join(", ")}`);
  // A failed view is not a collected fact, and it is not a reason to skip the review either: the
  // captured error's first line goes into the instructions so every session knows which view is
  // missing and why (2026-09-07: three outcome views refused a signal-terminated run and the whole
  // manifest was refused, so the reviewer hand-wrote the instruction packet instead).
  const failedViews = [];
  const byLabel = new Map();
  for (const view of status.views ?? []) {
    const path = snapshotViewFile(dir, view);
    if (view.status === "ok") byLabel.set(view.label, path);
    else failedViews.push({ ...view, error: capturedErrorHead(path) });
  }
  const runId = status.runIds?.[0] ?? null;
  const view = (mode) => {
    const label = runId ? `${runId}-${mode}` : mode;
    return byLabel.has(label) ? readJsonFile(byLabel.get(label)) : null;
  };
  return {
    dir,
    status,
    runId,
    bunPin,
    view,
    failedViews,
  };
}

const percent = (value) =>
  value === null || value === undefined ? "unknown" : `${(value * 100).toFixed(1)}%`;

function batteryFactLines(runId, battery) {
  const lines = [];
  const cases = battery.cases ?? {};
  const kinds = Object.entries(cases.nonResults?.byKind ?? {})
    .map(([kind, count]) => `${kind}=${count}`)
    .join(", ");
  lines.push(
    `- Battery \`${runId}\`: ${cases.verified ?? "?"} verified, ${cases.passed ?? "?"} passed, ` +
      `${cases.failed ?? "?"} failed, ${cases.unaccepted ?? "?"} unaccepted, ` +
      `${cases.nonResults?.total ?? "?"} non-results${kinds ? ` (${kinds})` : ""}. ` +
      `Pass rate ${percent(battery.passRate?.rate)} on n=${battery.passRate?.n ?? "?"}` +
      (battery.passRate?.wilson
        ? `, Wilson [${battery.passRate.wilson.lower.toFixed(3)}, ${battery.passRate.wilson.upper.toFixed(3)}].`
        : ", Wilson unavailable."),
  );
  const families = Object.entries(battery.families ?? {});
  if (families.length > 0) {
    lines.push(
      `  - Per family (passed/verified): ${families.map(([name, row]) => `${name} ${row.passed ?? "?"}/${row.verified ?? "?"}`).join("; ")}.`,
    );
  }
  const identity = battery.identity ?? {};
  if (identity.backendPins?.length || identity.variants?.length) {
    lines.push(
      `  - Identity: backends [${(identity.backendPins ?? []).join(", ")}], variants [${(identity.variants ?? []).join(", ")}], slugs [${(identity.slugs ?? []).join(", ")}]${identity.isolationUnproven ? `, isolation unproven on ${identity.isolationUnproven} row(s).` : "."}`,
    );
  }
  const telemetry = battery.telemetry ?? {};
  if (telemetry.recorded !== undefined) {
    lines.push(
      `  - Telemetry: ${telemetry.recorded} recorded, mean turns ${telemetry.meanTurns ?? "null"}, mean tool calls ${telemetry.meanToolCalls ?? "null"}.`,
    );
  }
  const never = battery.tools?.neverCalled ?? [];
  if (never.length > 0) lines.push(`  - Declared tools never called: ${never.join(", ")}.`);
  return lines;
}

function factValue(value, fallback = "not recorded") {
  if (value === null || value === undefined || value === "") return fallback;
  return isString(value) ? value : String(value);
}

/**
 * The terminal accounting trace-review projected from the controller's strict reader, stated as it
 * was recorded. Nothing is re-derived here: when that reader refused the run the refusal is the
 * fact, and an absent value reads as not recorded rather than as a count summed from the views.
 */
function terminalAccountingLines(snapshot) {
  const projected = snapshot.status.facts?.terminalAccounting ?? {};
  const calls = projected.authorCalls ?? {};
  const counts = projected.counts ?? {};
  const parents = projected.parents ?? {};
  const refused =
    projected.controller?.state === "refused"
      ? [`- Controller evidence refused by its strict reader: ${factValue(projected.controller.error)}.`]
      : [];
  return [
    ...refused,
    `- Terminal accounting: outer-controller cap ${factValue(projected.outerCap, "uncapped or not recorded")}; completed controller rounds ${factValue(projected.completedRounds)}.`,
    `- Durable campaign budget / author-call charge: budget ${factValue(calls.budget, "not recorded")}, opening ${factValue(calls.opening)}, terminal ${factValue(calls.terminal)}, delta ${factValue(calls.delta)}; charge unit ${factValue(calls.unit, "completed authoring/session-call attempts")}.`,
    `- Event counts (keep these meanings separate): raw ${factValue(counts.raw)}; real ${factValue(counts.real)}; controller-terminal ${factValue(counts.controller)}.`,
    `- Parent identities: last candidate ${factValue(parents.lastCandidate)}; adopted ${factValue(parents.adopted)}; accepted ${factValue(parents.accepted)}.`,
  ];
}

function reportFactLines(report, scorecard, snapshot) {
  const controller = report.controller ?? {};
  const denominator = controller.denominator ?? {};
  const lines = [
    `- Terminal: \`${controller.state ?? "unknown"} (${controller.terminalReason ?? "no reason recorded"})\`${controller.abortClause ? `, abort clause \`${controller.abortClause}\`.` : "."}`,
    `- Recorded denominator (${denominator.state ?? "state unknown"}): ${denominator.total ?? "?"} total = ${denominator.verified ?? "?"} verified + ${denominator.unaccepted ?? "?"} unaccepted + ${denominator.nonResults ?? "?"} non-results. Case record: ${report.caseRecord ?? "unknown"}.`,
  ];
  lines.push(...terminalAccountingLines(snapshot));
  const authoring = scorecard?.reach?.lastAuthoring;
  if (authoring) {
    lines.push(
      `- Last authoring: iteration ${authoring.ordinal} in epoch \`${authoring.epoch}\`, outcome \`${authoring.outcome}\`, workspace commit \`${String(authoring.workspaceCommit).slice(0, 12)}\`.`,
    );
  }
  for (const [runId, battery] of Object.entries(report.batteries ?? {})) {
    lines.push(...batteryFactLines(runId, battery));
  }
  for (const promotion of report.promotions ?? []) {
    lines.push(
      `- Promotion \`${promotion.runId}\`: \`${promotion.decision}\`${promotion.experiment ? ` (experiment ${promotion.experiment})` : ""}${promotion.clauses?.length ? `, clauses: ${promotion.clauses.join(", ")}` : ""}.`,
    );
  }
  return lines;
}

export function factsBlock(snapshot) {
  const report = snapshot.view("default");
  if (!report) {
    return "- The default metrics view is absent from the snapshot. Every count below is unavailable,\n  which is a gap to report, not a zero.";
  }
  const scan = snapshot.view("scan");
  const lines = reportFactLines(report, snapshot.view("scorecard"), snapshot);
  if (scan?.findings?.length) {
    lines.push("- Deterministic scan findings (the scan reports and never gates — a warning is a question):");
    for (const finding of scan.findings) {
      lines.push(
        `  - \`${finding.rule}\`${finding.battery ? ` [${finding.battery}]` : ""}: ${finding.statement}`,
      );
    }
  } else if (scan) lines.push("- Deterministic scan: no findings.");
  if (report.bundle) {
    const worst = report.bundle.worstFunction ?? {};
    lines.push(
      `- Bundle: ${report.bundle.files} files, ${report.bundle.nonBlankLines} nonblank lines, ${report.bundle.functions} functions; longest \`${worst.name ?? "?"}\` at ${worst.lines ?? "?"} lines in \`${worst.file ?? "?"}\`.`,
    );
  }
  return lines.join("\n");
}

export function parseNotes(path) {
  const blocks = [];
  let current = null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const heading = /^##\s+(custom:)?([A-Za-z][A-Za-z0-9_]*)\s*$/.exec(line);
    if (heading) {
      current = { name: heading[2].toLowerCase(), custom: Boolean(heading[1]), lines: [] };
      blocks.push(current);
    } else if (current) current.lines.push(line);
  }
  const orientations = blocks.flatMap((block) =>
    block.name === ORIENTATION_HEADING ? [{ custom: block.custom, text: block.lines.join("\n").trim() }] : [],
  );
  const notes = blocks.flatMap((block) =>
    block.name === ORIENTATION_HEADING
      ? []
      : [{ name: block.name, custom: block.custom, note: unwrap(block.lines.join("\n")) }],
  );
  return { orientations, notes };
}

export function orientationProblems(orientations) {
  if (orientations.length === 0) {
    return [
      "the notes file has no `## orientation` block; controller counts alone do not tell a session what it is looking at",
    ];
  }
  if (orientations.length > 1) {
    return [`the notes file carries ${orientations.length} \`## orientation\` blocks`];
  }
  const [orientation] = orientations;
  if (orientation.custom) return ["`custom:orientation` is the reserved orientation block, not a session"];
  if (orientation.text.length === 0) return ["`## orientation` has no text under it"];
  const lines = orientation.text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length > ORIENTATION_MAX_LINES) {
    return [
      `\`## orientation\` carries ${lines.length} lines; the contract is at most ${ORIENTATION_MAX_LINES}, so cut it to what a session cannot read off the facts block`,
    ];
  }
  return [];
}
