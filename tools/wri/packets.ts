/**
 * Lane 27 across campaigns: blind packets for several graders, and the join of what they graded.
 *
 *   bun tools/wri/wri.ts packets --log <log>,<log>[,...] --out <dir> [--graders 2]
 *   bun tools/wri/wri.ts packets --out <dir> --join
 *
 * A grade read across campaigns must not follow a campaign's age or result. On 6 November sixteen
 * buffer campaigns were graded this way from hand-written scripts, which carried two faults into the
 * packets: a long requirement was reduced to its keys, and 19 of 21 diffs were cut at 500 lines. So
 * here each campaign gets an opaque label, a grader holds half of them with old and new alternating
 * and tasks shuffled across them, a value is shown whole up to `VALUE_BYTES`, which every requirement
 * in those logs fits and a long table does not, and a diff is cut only past `DIFF_LINES`, which none
 * there reaches. The verb prints each grader's size, since a session has only so much room.
 *
 * Each grader also holds `ANCHORS` tasks of the others' campaigns, unmarked, so the join can say how
 * far the graders differ before anyone sets their grades side by side. No packet reads an outcome.
 * The join writes `grades.tsv` under the campaigns' names for `wri.ts trajectory --grades`, and only
 * then asks each grader to regrade, once, a task it graded high that the Starter answered every time
 * (the lane's own rule). Each grade changes no verdict, reading, promotion or move, and no seat is told it.
 * `key.json` names the campaigns, so it stays with the primary.
 */
import type { LogEvent } from "#src/kernel/log.ts";
import { passed, solvesIn } from "#src/kernel/solves.ts";
import { AGENT_DIR, GUIDE_FILE } from "#src/meta/bundle-layout.ts";
import { sha256 } from "#src/meta/digest.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { asRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { catalogueText, lanesOf } from "./catalogue.ts";
import { scoredTasks } from "./tasks.ts";
import { ownFilesOf, weightOf } from "./trajectory.ts";

const VALUE_BYTES = 1500;
const DIFF_LINES = 3000;
const ANCHORS = 6;
/** The grade from which a task the Starter answers every time is regraded: specialist work (lane 27). */
const HIGH = 5;
const GUIDE = `${AGENT_DIR}${GUIDE_FILE}`;

export interface Campaign {
  readonly name: string;
  readonly log: string;
  readonly events: readonly LogEvent[];
}

interface Key {
  readonly campaigns: Record<
    string,
    { readonly name: string; readonly log: string; readonly grader: string }
  >;
  /** What each grader holds, as `label<TAB>id`, its anchors apart. */
  readonly graders: Record<
    string,
    {
      readonly tasks: readonly string[];
      readonly versions: readonly string[];
      readonly anchors: readonly string[];
    }
  >;
}

interface Packed {
  readonly key: string;
  readonly text: string;
}

const graderName = (index: number) => String.fromCodePoint(97 + index);
const reportOf = (out: string, grader: string) => join(out, "lanes", `34${grader}-report.md`);
const salted = <T>(items: readonly T[], salt: string, key: (item: T) => string): T[] =>
  items.toSorted((a, b) => sha256(`${salt}${key(a)}`).localeCompare(sha256(`${salt}${key(b)}`)));

function shown(value: JsonValue | undefined): string {
  const text = JSON.stringify(value) ?? "null";
  if (text.length <= VALUE_BYTES) return text;
  return `${text.slice(0, VALUE_BYTES)} [cut after ${String(VALUE_BYTES)} of ${String(text.length)} characters]`;
}

function tasksOf({ events }: Campaign, label: string): Packed[] {
  return scoredTasks(events).flatMap(({ taskId, family, input }) => {
    if (taskId === null) return [];
    const fields = Object.entries(
      asRecord(input?.publicInput) ?? { public: input?.publicInput ?? "none in the log" },
    );
    const body = fields.map(([field, value]) => `  ${field}: ${shown(value)}`);
    return [
      {
        key: `${label}\t${taskId}`,
        text: [`task ${label} ${taskId}`, `  family: ${family ?? "none"}`, ...body].join("\n"),
      },
    ];
  });
}

/** The guide and the programs a kept harness wrote, by path. */
function writtenIn(state: string): Map<string, string> {
  const { root, paths } = ownFilesOf(state);
  const found = new Map(paths.map((path) => [path, join(root, path)]));
  if (existsSync(join(state, GUIDE))) found.set("guide", join(state, GUIDE));
  return found;
}

function diffOf(parent: string, version: string): string[] {
  const old = existsSync(parent) ? writtenIn(parent) : new Map<string, string>();
  const fresh = writtenIn(version);
  return [...new Set([...old.keys(), ...fresh.keys()])].toSorted().flatMap((path) => {
    const { stdout } = runSync([
      "diff",
      "-U1",
      "--label",
      `parent/${path}`,
      "--label",
      `version/${path}`,
      old.get(path) ?? "/dev/null",
      fresh.get(path) ?? "/dev/null",
    ]);
    const text = decodeOutput(stdout).trimEnd();
    return text === "" ? [] : text.split("\n");
  });
}

function versionsOf({ log, events }: Campaign, label: string): Packed[] {
  const started = events.filter(({ kind }) => kind === "comparison.started");
  const starter = started[0]?.data.starter;
  const parents = new Map(
    events.flatMap(({ kind, data }) => (kind === "harness.version" ? [[data.version, data.parent]] : [])),
  );
  const states = join(dirname(log), "states");
  const fresh = [...new Set(started.map(({ data }) => data.fresh))].filter(
    (digest): digest is string => isString(digest) && digest !== starter,
  );
  return fresh.flatMap((digest) => {
    const state = join(states, digest);
    if (!existsSync(state)) return [];
    const parent = parents.get(digest) ?? starter;
    const named = isString(parent) ? parent : "none";
    const lines = diffOf(join(states, named), state);
    const weight = weightOf(state);
    const cut =
      lines.length > DIFF_LINES ? [`[cut after ${String(DIFF_LINES)} of ${String(lines.length)} lines]`] : [];
    return [
      {
        key: `${label}\t${digest.slice(0, 8)}`,
        text: [
          `### version ${label} ${digest.slice(0, 8)} (parent ${named.slice(0, 8)}): guide ${String(weight?.guide)} lines, ${String(weight?.files)} own program files, ${String(weight?.lines)} lines`,
          ...lines.slice(0, DIFF_LINES),
          ...cut,
        ].join("\n"),
      },
    ];
  });
}

function between(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  const stop = text.indexOf(to, start);
  if (start === -1 || stop === -1) throw new Error(`lane 27's text no longer holds "${from}"`);
  return text.slice(start, stop).trim();
}

function graderPrompt(out: string, grader: string, tasks: number, versions: number): string {
  const lane = lanesOf(catalogueText()).find(({ number }) => number === 27)?.body ?? "";
  return `# Blind grades for lane 27 of a whole-run investigation

You grade tasks and harness versions. A harness is a guide and programs that a fixed solver model uses to answer a domain's tasks. Your grades are a reviewer's reading: they change no verdict, reading, promotion or move, and no seat is told them.

## Stay blind

Grades must not follow a result or a campaign's age. Campaigns appear under opaque labels.

- Read only \`${join(out, `packet-${grader}-tasks.md`)}\` and \`${join(out, `packet-${grader}-versions.md`)}\`.
- Do not read any other file of this folder, any log, \`data/derived\`, \`data/runs\`, any \`.ana\` folder or git history.
- Do not try to work out which campaign a label is.

## Hard rules

- Quote nothing in the report: no task text and no line of a harness. A sentence names parts, kinds and counts.
- Write one file only, \`${reportOf(out, grader)}\`. Start no solve, session or check. Launch no subagent.
- Open the report early and write each grade as it settles, so nothing is lost if you run out of room.

## Tasks

${between(lane, "**Reach** is how hard", "Then set each grade beside")}

The tasks packet shows each task's public part, shuffled across campaigns. Grade all ${String(tasks)}, once, on what each asks. Use the top of the scale when a task earns it and the bottom when it does.

## Harness versions

${between(lane, "**Soundness** is whether", "Then read whether the step's wins")}

The versions packet shows each of ${String(versions)} versions' diff against its parent, leaving out what it installed. A cut diff says so: grade what you can read, and name the cut in the sentence.

## The report

In this shape and order, with real tabs in the rows:

\`\`\`
# Lane 27: Harness quality, version by version

Verdict: no finding

## Checked

<how many tasks and versions you graded, and anything you could not read>

## Grade features

<the features of these tasks that place one at each grade you use>

## Version sentences

<label digest: soundness, one sentence>

## Findings

## Grade rows

task<TAB>label<TAB>id<TAB>grade
version<TAB>label<TAB>digest<TAB>grade
\`\`\`

End your reply with one line naming the report and how many rows it holds.
`;
}

function launch(
  out: string,
  file: string,
  sessions: readonly { readonly grader: string; readonly prompt: string }[],
): void {
  const manifest = {
    workdir: process.cwd(),
    sandbox: "workspace-write",
    search: false,
    sessions: sessions.map(({ grader, prompt }) => ({
      name: `grader_${grader}`,
      task: `Read \`${prompt}\` and do exactly what it says.`,
      ownedPaths: [reportOf(out, grader)],
    })),
  };
  writeFileSync(join(out, file), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Writes every grader's packets and prompt, the key and the manifest, and says what each holds. */
export function buildPackets(campaigns: readonly Campaign[], outDir: string, count: number): string[] {
  const out = resolve(outDir);
  if (!Number.isInteger(count) || count < 2) {
    throw new Error("--graders takes a whole number from 2: one grader has no one to differ from");
  }
  mkdirSync(join(out, "lanes"), { recursive: true });
  const inOrder = campaigns.toSorted((a, b) => (a.events[0]?.at ?? "").localeCompare(b.events[0]?.at ?? ""));
  const width = String(campaigns.length).length;
  const labelled = salted(campaigns, out, ({ name }) => name).map((campaign, index) => ({
    campaign,
    label: `r${String(index + 1).padStart(width, "0")}`,
    grader: graderName(inOrder.indexOf(campaign) % count),
  }));
  const tasks = new Map(labelled.map(({ campaign, label }) => [label, tasksOf(campaign, label)]));
  const key: Key = { campaigns: {}, graders: {} };
  const graders = Array.from({ length: count }, (_, index) => graderName(index));
  const lines = graders.map((grader) => {
    const mine = labelled.filter((one) => one.grader === grader);
    const others = labelled.filter((one) => one.grader !== grader);
    const own = mine.flatMap(({ label }) => tasks.get(label) ?? []);
    const anchors = salted(
      others.flatMap(({ label }) => tasks.get(label) ?? []),
      `${out}${grader}`,
      ({ key: row }) => row,
    ).slice(0, ANCHORS);
    const versions = salted(mine, `${out}${grader}`, ({ label }) => label).flatMap(({ campaign, label }) =>
      versionsOf(campaign, label),
    );
    const shuffled = salted([...own, ...anchors], `${out}${grader}`, ({ key: row }) => row);
    writeFileSync(
      join(out, `packet-${grader}-tasks.md`),
      `${shuffled.map(({ text }) => text).join("\n\n")}\n`,
    );
    writeFileSync(
      join(out, `packet-${grader}-versions.md`),
      `${versions.map(({ text }) => text).join("\n\n")}\n`,
    );
    writeFileSync(
      join(out, `grader-${grader}.md`),
      graderPrompt(out, grader, shuffled.length, versions.length),
    );
    key.graders[grader] = {
      tasks: own.map((row) => row.key),
      versions: versions.map((row) => row.key),
      anchors: anchors.map((row) => row.key),
    };
    for (const { campaign, label } of mine) {
      key.campaigns[label] = { name: campaign.name, log: campaign.log, grader };
    }
    const held = [...shuffled, ...versions].reduce((sum, { text }) => sum + text.length, 0);
    return `grader ${grader}: ${String(mine.length)} campaigns, ${String(own.length)} tasks and ${String(anchors.length)} anchors, ${String(versions.length)} versions, about ${String(Math.round(held / 4000))} thousand tokens`;
  });
  writeFileSync(join(out, "key.json"), `${JSON.stringify(key, null, 1)}\n`);
  launch(
    out,
    "launch.json",
    graders.map((grader) => ({ grader, prompt: join(out, `grader-${grader}.md`) })),
  );
  return lines;
}

/** One grader's rows of one kind, as `label<TAB>id` to grade. */
function rowsIn(text: string, kind: string): Map<string, number> {
  return new Map(
    text.split("\n").flatMap((line) => {
      const [row, label, id, grade] = line.split("\t");
      const value = Number(grade);
      return row === kind && grade !== "" && Number.isFinite(value) ? [[`${label}\t${id}`, value]] : [];
    }),
  );
}

/** Tasks whose every solve under the Starter was valid, by id, at least two solves. */
function starterAnswers(events: readonly LogEvent[]): Set<string> {
  const starter = events.find(({ kind }) => kind === "comparison.started")?.data.starter;
  const tally = new Map<string, { valid: number; results: number }>();
  for (const solve of solvesIn(events)) {
    const task = solve.start.task;
    const result = passed(solve);
    if (!isString(task) || solve.end?.harness !== starter || result === null) continue;
    const one = tally.get(task) ?? { valid: 0, results: 0 };
    tally.set(task, { valid: one.valid + (result ? 1 : 0), results: one.results + 1 });
  }
  return new Set(
    [...tally].flatMap(([task, { valid, results }]) => (results >= 2 && valid === results ? [task] : [])),
  );
}

function regradePrompt(out: string, grader: string, owed: readonly string[]): string {
  return `# Regrade, once, for lane 27

Each task below is one you graded high, and the Starter, the plainest harness, answered it validly on every solve. That says the grade may be too high for this solver. Read each again in \`${join(out, `packet-${grader}-tasks.md`)}\`, on that reason alone, and keep the grade where the reason does not move it.

${owed.map((row) => `- ${row.replace("\t", " ")}`).join("\n")}

Append one row each to \`${reportOf(out, grader)}\`, changing nothing above it: \`regrade<TAB>label<TAB>id<TAB>grade\`. The hard rules of \`${join(out, `grader-${grader}.md`)}\` hold. Read nothing else.
`;
}

/** Joins the graders' rows under the campaigns' names and reads how far the graders differ. */
export function joinPackets(outDir: string, read: (log: string) => readonly LogEvent[]): string[] {
  const out = resolve(outDir);
  // SAFETY: `buildPackets` above is the one writer of `key.json`, in this shape.
  const key = JSON.parse(readFileSync(join(out, "key.json"), "utf8")) as Key;
  const reports = new Map(
    Object.keys(key.graders).map((grader) => {
      const path = reportOf(out, grader);
      return [grader, existsSync(path) ? readFileSync(path, "utf8") : ""];
    }),
  );
  const tasksBy = new Map([...reports].map(([grader, text]) => [grader, rowsIn(text, "task")]));
  const lines: string[] = [];
  const rows: string[] = [];
  const answered = new Map(
    Object.entries(key.campaigns).map(([label, { log }]) => [label, starterAnswers(read(log))]),
  );
  const regrades: { grader: string; prompt: string }[] = [];
  for (const [grader, held] of Object.entries(key.graders)) {
    const text = reports.get(grader) ?? "";
    const tasks = tasksBy.get(grader) ?? new Map<string, number>();
    const versions = rowsIn(text, "version");
    const regraded = rowsIn(text, "regrade");
    const nameOf = (row: string) => key.campaigns[row.split("\t")[0] ?? ""]?.name;
    const owed = held.tasks.filter((row) => {
      const [label = "", id = ""] = row.split("\t");
      return (tasks.get(row) ?? 0) >= HIGH && !regraded.has(row) && answered.get(label)?.has(id) === true;
    });
    for (const row of held.tasks) {
      const grade = regraded.get(row) ?? tasks.get(row);
      if (grade !== undefined) {
        rows.push(`task\t${String(nameOf(row))}\t${row.split("\t")[1]}\t${String(grade)}`);
      }
    }
    for (const row of held.versions) {
      const grade = versions.get(row);
      if (grade !== undefined) {
        rows.push(`version\t${String(nameOf(row))}\t${row.split("\t")[1]}\t${String(grade)}`);
      }
    }
    const missing = [...held.tasks, ...held.anchors].filter((row) => !tasks.has(row)).length;
    const pairs = held.anchors.flatMap((row) => {
      const owner = key.campaigns[row.split("\t")[0] ?? ""]?.grader ?? "";
      const mine = tasks.get(row);
      const theirs = tasksBy.get(owner)?.get(row);
      return mine === undefined || theirs === undefined ? [] : [mine - theirs];
    });
    const near = pairs.filter((gap) => Math.abs(gap) <= 1).length;
    const mean =
      pairs.length === 0 ? "-" : (pairs.reduce((sum, gap) => sum + gap, 0) / pairs.length).toFixed(2);
    lines.push(
      `grader ${grader}: ${String(tasks.size)} task rows, ${String(missing)} missing, ${String(versions.size)} of ${String(held.versions.length)} versions, ${String(regraded.size)} regraded; on ${String(pairs.length)} anchors ${String(pairs.filter((gap) => gap === 0).length)} exact, ${String(near)} within one, mean difference from their grader ${mean}; owes ${String(owed.length)} regrades`,
    );
    if (owed.length > 0) {
      const prompt = join(out, `regrade-${grader}.md`);
      writeFileSync(prompt, regradePrompt(out, grader, owed));
      regrades.push({ grader, prompt });
    }
  }
  writeFileSync(join(out, "grades.tsv"), `${rows.join("\n")}\n`);
  if (regrades.length > 0) launch(out, "launch-regrade.json", regrades);
  return [
    ...lines,
    `${String(rows.length)} rows in ${join(out, "grades.tsv")}; ${String(regrades.length)} regrade sessions owed, in launch-regrade.json`,
  ];
}
