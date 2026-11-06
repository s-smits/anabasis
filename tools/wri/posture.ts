/**
 * What a log's seats say of their own work, as counts of the nearest of a fixed set of anchors, for
 * an investigator and nobody else. The operator asked for it on 5 November: "we want the best
 * exhaustive WRI-like pulse info as possible", "if this includes embeddings we need it", and on 1
 * November, "i'm fine with re-running embeddings for new stuff every ~5 mins etc, for new logs".
 *
 *   bun tools/wri/posture.ts <log> [--store <dir>]
 *
 * The labels are semantic leads, never a score input: no prose, task text or hidden value is printed,
 * no seat reads them, and they decide nothing. They come from `Turn.text`, the words a model's turn
 * holds (`tracesIn`), which is the only prose a log has: `textsOf` keeps text parts, so no reasoning is
 * on record, and a model that speaks only in tool calls leaves a row of noughts. A turn that carries a
 * provider's error is left out, since its words are the provider's.
 *
 * v1 held this in 1,647 lines (`5bc9988:.claude/skills/whole-run-investigation/classifier/`). Kept: nearest
 * by class, the margin, the adrift run, and the lessons of the model and its store (`tools/wri/embed.ts`).
 * Left out: the capture census and its joins to v1's submits and batteries, reasoning segments, excerpts
 * and the model override.
 *
 * What it is worth is on record and is little. On five logs read on 5 November, every one fell under
 * v1's floor as `thin`, more than half its units within the margin, and `adrift` never fired. One blind
 * reading of 96 units agreed with the label on 21, where one constant label would on 23, and agreed less
 * above the margin (5 of 33) than under it (16 of 63). The prose v2 holds is short narration of domain
 * work, not the headlines and reasoning v1's anchors were calibrated on, so read a row as what the prose
 * was about, not as whether the work advanced.
 */
import { type LogEvent, read } from "#src/kernel/log.ts";
import { SEATS, type Seat, traceKind, tracesIn, type Turn } from "#src/kernel/trace.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { countBy } from "#src/meta/tally.ts";
import { storeOf } from "#tools/runs/pulse-readers.ts";
import { dot, type EmbedWays, localModel, vectorsOf } from "./embed.ts";
import { type Index, indexOf, type Solve, text } from "./folds.ts";

/** One turn's words, by what its nearest anchor names: no text. */
interface Unit {
  readonly seat: Seat;
  readonly id: string;
  readonly turn: number | null;
  readonly label: string;
  readonly low: boolean;
}

/** Each posture's anchors, in the two forms a turn's words take: a headline and a sentence. v1's own,
 *  with v1's nouns moved to what a v2 session does (add-ons, the generator, controls, the control
 *  census, the preview and its gates to the guide, the toolchain, practice solves, `compare`, `wait`
 *  and `submit`). A name is short, as a look says 160 characters of a row and the folder holds the rest. */
const ANCHORS = {
  intro: [
    "Reading the contract and inventorying the workspace",
    "Reviewing the task and the guide before doing anything",
    "Inspecting the current files and the harness's tools",
    "I'll first read the contract and the guide, then map what the task asks for.",
    "Starting the task: I'll read the records, then identify the exact request and continue from the evidence.",
    "I will keep this session read-only and separate confirmed facts from hypotheses.",
  ],
  research: [
    "Researching structural analysis libraries",
    "Locating the exact wheel for the public source",
    "Searching the documentation for the established reference route",
    "Exploring package installation strategies",
    "I found the established public interface: the library documents the elements and the linear static analysis I need.",
    "I am looking for the real open-source tool for this domain before writing anything around it.",
  ],
  plan: [
    "Planning the exam's rules and its checks",
    "Designing task families and difficulty bounds",
    "Defining engine input paths and validation checks",
    "Planning the next edits and which tests to run",
    "I will inspect the two files first, then run the focused checks, then decide.",
    "Next step: read the practice trace and follow the path before changing anything.",
  ],
  edit: [
    "Patching the toolchain program with multiple hunks",
    "Updating the file by replacing a large section",
    "Adding a new program to the harness's toolchain",
    "Implementing a new tool in the harness",
    "Rewriting the guide and the tool's arguments",
    "I am now writing the guide and the toolchain programs.",
  ],
  check: [
    "Running the program's tests after the change",
    "Checking typecheck readiness",
    "Running a practice solve on the harness",
    "Verifying that the answer's fields are consistent",
    "Both practice solves passed and the program's tests are green: 8 tests passed.",
    "The proposal is in order: 4 tasks, two families, and the checks run on each.",
  ],
  diagnose: [
    "Analyzing why the check fails",
    "Identifying the missing parameters causing the runtime issue",
    "Diagnosing the crash in the harness's tool",
    "Tracing the error: the parser drops two fields, which explains the refusal",
    "The failure comes from the program reading the wrong path; the root cause is the config key.",
    "Reading the trace: the practice solve fails because the field is null.",
  ],
  blocked: [
    "Investigating the permission denial on the parent directory",
    "The sandbox blocks the compiler and the toolchain is missing",
    "Operation not permitted writing under the home directory; the wall refuses this path.",
    "The command timed out and the native extension cannot be imported here.",
    "Cannot proceed: the sandbox denies the write and the tool is not installed.",
    "I am stuck because the environment refuses to run this; nothing I change in the code helps.",
  ],
  workaround: [
    "Removing the tool to get past the failures",
    "Simplifying the toolset instead of fixing the failing engine",
    "Relaxing the check so the failing answer passes",
    "Stubbing the failing dependency to get past the gate",
    "Rather than fix the root cause, I can special-case this input so the gate accepts it.",
    "Hard-coding the expected value for this case is quicker than fixing the program.",
  ],
  dispute: [
    "Concluding the checker is at fault rather than my answer",
    "Questioning the refusal because my answer is correct",
    "The verifier is wrong here; my answer is correct and the check is miscounting.",
    "This refusal is a bug in the host's check, not a defect in my answer.",
    "My output is right; the gate rejected it unfairly.",
    "There is nothing wrong with what I built; the feedback itself is mistaken.",
  ],
  unsure: [
    "Weighing two possible causes without enough evidence",
    "Reevaluating the acceptance criteria",
    "Clarifying which form the verifier expects",
    "I am not sure which of these two forms the verifier expects; let me look again.",
    "It is unclear why this fails. Maybe the format differs from what I assumed.",
    "Hmm, this might be either the path or the format; I cannot tell yet.",
  ],
  sure: [
    "Confirming the fix works and all checks pass",
    "The approach works and the answer passes every check",
    "The fix is in place and the checks pass; the harness is ready.",
    "Good, the practice solve passed and the output matches what the task asks.",
    "The result is correct and reproducible, so this is settled.",
    "This should be fine; everything is complete and it should be accepted.",
  ],
  submit: [
    "Confirming readiness for submit",
    "Submitting the answer",
    "Waiting for the execution to complete",
    "Freezing the harness for a comparison",
    "I'm submitting this answer now; nothing is left to check.",
    "The comparison is still running; I'll wait for its reading.",
  ],
  status: [
    "Summarising current progress and what remains",
    "Noting the state of the run and what remains",
    "The campaign is in epoch 3; a comparison is running; no reading yet.",
    "12 tests passed, 0 failed. The process is alive and has run for about one hour.",
    "Status: the proposal was refused at the gate; the session continues.",
    "You're welcome. The work continues in the background.",
  ],
} as const;

const LABELS = Object.keys(ANCHORS);
const ANCHOR_TEXTS: readonly string[] = Object.values(ANCHORS).flat();
/** Postures that say the work is not advancing. One is ordinary; a run of them is the reading. */
const ADRIFT: ReadonlySet<string> = new Set(["unsure", "blocked", "dispute", "workaround"]);
/** How many in a row make a stretch worth naming (operator, 19 September: "five unconfident in a row
 *  and we know that location is off"). A low-margin unit breaks one. */
const DRIFT_RUN = 5;
/** Under this margin a label is a coin toss between two postures: v1's calibration. */
const MIN_MARGIN = 0.5;
/** Two a posture is the least where the most common says more than which caught the first few. */
const THIN_UNITS = 2 * LABELS.length;
/** The seats a session ends in, whose rows name that ending. A Referee's readers are one row. */
const SESSIONS = ["build", "exam", "draft", "repair"] as const;
const NO_CALLS: ReadonlySet<LogEvent["kind"]> = new Set(SEATS.map((seat) => traceKind(seat, "call")));

const lows = (units: readonly Unit[]) => units.filter(({ low }) => low).length;

/** The nearest posture, each scored by its nearest anchor so a form does not blur into a mean, and
 *  whether the runner-up stands within `MIN_MARGIN` deviations of it. */
function nearest(vector: Float32Array, anchors: readonly (readonly Float32Array[])[]) {
  const scores = anchors.map((each) => Math.max(...each.map((anchor) => dot(vector, anchor))));
  const [first = 0, second = 0] = scores.toSorted((one, other) => other - one);
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const spread = Math.sqrt(scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length);
  return {
    label: LABELS[scores.indexOf(first)] ?? "",
    low: (first - second) / (spread || 1) < MIN_MARGIN,
  };
}

function stretchesIn(units: readonly Unit[]): Unit[][] {
  const found: Unit[][] = [];
  let run: Unit[] = [];
  for (const unit of [...units, null]) {
    if (unit !== null && ADRIFT.has(unit.label) && !unit.low) {
      run.push(unit);
      continue;
    }
    if (run.length >= DRIFT_RUN) found.push(run);
    run = [];
  }
  return found;
}

/** Each label in one order, by count or by share, so a row that moved is the same line with other
 *  numbers (`patternOf`, `tools/runs/pulse-readers.ts`). A look cuts a line at 160 characters (`short`)
 *  and may be read long after, so the postures that say the work is not advancing come first. */
const SHOWN = [...ADRIFT, ...LABELS.filter((label) => !ADRIFT.has(label))];

function tally(units: readonly Unit[], form: "count" | "share"): string {
  const counts = countBy(units, ({ label }) => label);
  const of = (n: number) =>
    form === "count" ? String(n) : `${String(Math.round((n * 100) / units.length))}%`;
  return SHOWN.map((label) => `${label} ${of(counts[label] ?? 0)}`).join(" ");
}

function adriftLine(name: string, units: readonly Unit[]): string[] {
  const stretches = stretchesIn(units);
  const longest = stretches.toSorted((one, other) => other.length - one.length)[0];
  if (longest === undefined) return [];
  const where = `turns ${String(longest[0]?.turn)} to ${String(longest.at(-1)?.turn)}`;
  const labels = [...new Set(longest.map(({ label }) => label))].toSorted().join(", ");
  return [
    `adrift ${name}: ${String(stretches.length)} stretches of ${String(DRIFT_RUN)} or more, the longest ${String(longest.length)} units, ${where}, in ${labels}`,
  ];
}

function sessionRows(index: Index, units: readonly Unit[]): string[] {
  return SESSIONS.flatMap((seat) => {
    const own = Map.groupBy(
      units.filter((unit) => unit.seat === seat),
      ({ id }) => id,
    );
    return [...own].flatMap(([id, said]) => {
      const ended = text(index.of(`${seat}.finished`).findLast(({ session }) => session === id)?.ended);
      const readings = index.compared.flatMap(({ session, last, build }) =>
        seat === "build" && build?.session === id ? [`${session} ${text(last.reading)}`] : [],
      );
      const compared = readings.length === 0 ? "" : `; read ${readings.join(", ")}`;
      const name = `${seat} ${id}`;
      return [
        `${name} ${ended || "open"}: ${String(said.length)} units, ${String(lows(said))} low; ${tally(said, "count")}${compared}`,
        ...adriftLine(name, said),
      ];
    });
  });
}

/** Each way a solve ended, joined by the fold that says how (`indexOf`). */
function solveRows(index: Index, units: readonly Unit[]): string[] {
  const own = Map.groupBy(
    units.filter(({ seat }) => seat === "solve"),
    ({ id }) => id,
  );
  const endingOf = ({ outcome, kind }: Solve) =>
    `solve ${outcome ?? "unfinished"}${kind === null ? "" : ` ${kind}`}`;
  const endings = [...Map.groupBy(index.solves, endingOf)].toSorted(([one], [other]) =>
    one.localeCompare(other),
  );
  return endings.flatMap(([name, solves]) => {
    const said = solves.flatMap(({ id }) => own.get(id) ?? []);
    const speaking = solves.filter(({ id }) => own.has(id));
    const adrift = speaking.filter(({ id }) => stretchesIn(own.get(id) ?? []).length > 0).length;
    return said.length === 0
      ? []
      : [
          `${name}: ${String(said.length)} units in ${String(speaking.length)} of ${String(solves.length)} solves, ${String(adrift)} adrift, ${String(lows(said))} low; ${tally(said, "count")}`,
        ];
  });
}

/** One read of `log`: the lines an investigator reads, one line where there is nothing to read. */
export async function postureOf(log: string, ways: EmbedWays): Promise<string[]> {
  const events = read(log, NO_CALLS);
  const turns = tracesIn(events).filter((each): each is Turn => each.part === "turn");
  const said = turns.filter(({ text: words, error }) => error === null && words.trim() !== "");
  if (said.length === 0) {
    return [`posture: no prose in this log, 0 of ${String(turns.length)} turns hold words`];
  }
  const wanted = [...ANCHOR_TEXTS, ...said.map(({ text: words }) => words.trim())];
  const { vectorOf, embedded, unkept, stopped, missing } = await vectorsOf(log, wanted, ways);
  if (stopped !== null) {
    return [
      `posture: no reading, the local model did not finish, ${String(embedded)} of ${String(missing)} texts embedded: ${stopped}`,
    ];
  }
  const anchors = Object.values(ANCHORS).map((each: readonly string[]) => each.map(vectorOf));
  const units = said.map(
    ({ seat, id, turn, text: words }): Unit => ({
      seat,
      id,
      turn,
      ...nearest(vectorOf(words.trim()), anchors),
    }),
  );
  const thin = units.length < THIN_UNITS || lows(units) * 2 > units.length;
  const seats = SEATS.flatMap((seat) => {
    const of = turns.filter((turn) => turn.seat === seat).length;
    const own = units.filter((unit) => unit.seat === seat);
    const counts = `seat ${seat}: ${String(own.length)} units of ${String(of)} turns`;
    if (of === 0) return [];
    return [own.length === 0 ? counts : `${counts}, ${String(lows(own))} low; ${tally(own, "share")}`];
  });
  const index = indexOf(events);
  return [
    `posture: ${String(units.length)} units of prose in ${String(turns.length)} turns, ${String(lows(units))} low-margin; embedded ${String(embedded)} this read`,
    `leads for an investigator, never a score, and one unit is weak evidence${thin ? "; thin, so read no ranking from this log" : ""}`,
    ...(unkept === null
      ? []
      : [`posture: the vector store cannot be written, so nothing is kept: ${unkept}`]),
    ...seats,
    ...sessionRows(index, units),
    ...solveRows(index, units),
  ];
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: runtimeProcess.argv.slice(2),
    allowPositionals: true,
    options: { store: { type: "string" } },
  });
  const [log] = positionals;
  if (log === undefined) throw new Error("name a log: bun tools/wri/posture.ts <log> [--store <dir>]");
  const lines = await postureOf(log, {
    store: values.store ?? storeOf(runtimeProcess.cwd()),
    load: localModel,
  });
  console.log(lines.join("\n"));
}

if (import.meta.main) await main();
