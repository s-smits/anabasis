/**
 * Three campaign logs written from typed events, as the repository's own tests build theirs
 * (`test/handover.test.ts`, `test/reports.test.ts`, `test/climb.test.ts`): the one sample the page's
 * tests render from, through the server's handlers and so through the repository's folds, and the
 * one the page is started on to be looked at. There is no real campaign log in a container: they
 * live on the operator's host and are private.
 *
 *   bun packages/ui/test/fixture-campaign.ts <dir>
 *
 * writes `<dir>/.ana/d2/<name>/log.jsonl` for each campaign, with its kept harnesses' `agent/`
 * folders beside it, and `bun serve.ts --repo <dir>`, run in `packages/ui` (the page's `index.html`
 * names its script from there), reads them. The domains are invented and neutral. The held-out
 * tasks' hidden values, the answers to them and the one check's name carry the markers in
 * `MARKERS`, so that a test can show that no default-tier answer holds any of them.
 *
 * The main campaign, `fixture`, holds every case a pane draws: an opening from a prompt, an exam
 * drafted and frozen, four Examiner sessions, five rounds (a Builder session and the comparison
 * after it under one id, as `tools/d2/round.ts` runs them) and a Builder session open at the end,
 * practice solves, nine comparisons of which two repeat an earlier one and one is a control with an
 * A/A reading beside it, a change of setting between two comparisons, a promotion by the rule, one
 * made with `--despite` and a return to the starter, a comparison cut before its report with a
 * ruled rejection, rejections ruled earned, a check defect and unclear, one comparison settled by a
 * person's labels each way, a task waiting for a label, a disputed task, a non-result solved again,
 * and twenty-five task versions. A second campaign in the same project, `early`, holds no
 * comparison yet; a third, `units`, in another project, ended on its budget with no promotion,
 * after a control whose A/A reading the later sample lost 0 to 4.
 *
 * The reports are the comparison's own reading of its solves (`compared`,
 * `src/builder/comparison.ts`) and the settling is `settleReading`'s, so nothing in a report is
 * typed by hand. Each event is stamped by a clock this file moves, so the moves take minutes.
 */
import { setSystemTime } from "bun:test";
import { compared, fixedIn, NO_LABELS } from "../../../src/builder/comparison.ts";
import { settleReading } from "../../../src/builder/round.ts";
import { recordCondition, settingId } from "../../../src/kernel/condition.ts";
import { append, type EventKind, LOG_FILE, read } from "../../../src/kernel/log.ts";
import { comparedAs } from "../../../src/kernel/reports.ts";
import { sha256 } from "../../../src/meta/digest.ts";
import { mkdirSync, writeFileSync } from "../../../src/meta/filesystem.ts";
import { asRecord, type JsonObject, type JsonValue } from "../../../src/meta/json-shape.ts";
import { keyIfDefined } from "../../../src/meta/optional-key.ts";
import { join, resolve } from "../../../src/meta/path.ts";
import type { Ruling } from "../../../src/review/referee.ts";
import type { Query, Tier } from "../src/models.ts";
import { campaignAnswer } from "../src/server/campaign.ts";
import { campaignsAnswer } from "../src/server/campaigns.ts";
import type { Reading } from "../src/server/context.ts";
import { harnessAnswer, harnessDiffAnswer, harnessFileAnswer } from "../src/server/harness.ts";
import { eventAnswer, logAnswer } from "../src/server/log.ts";
import { moveAnswer } from "../src/server/move.ts";
import { solveAnswer } from "../src/server/solve.ts";
import { taskAnswer, tasksAnswer } from "../src/server/tasks.ts";

/** What the server must never show in the default tier. */
export const MARKERS = {
  hidden: "hidden-quartz-5521",
  answer: "answer-quartz-7730",
  check: "check-quartz-tally",
} as const;

/** How a solve ends in the fixture. */
type Ends = "pass" | "rejected" | "no-answer" | "format" | "provider" | "faulty";

/** One solve to write. */
interface SolveAsked {
  readonly task: string;
  readonly harness: string;
  readonly ends: Ends;
  readonly comparison?: string;
  /** Whether its task is held out, so that its answer and its trace carry the answer marker. */
  readonly heldOut: boolean;
}

/** One comparison's plan: by task id, how each side's solves end, and the rulings of the
 *  rejections, by side and solve. `cutAfter` writes that many solves and no report. */
interface Planned {
  readonly id: string;
  readonly old: string;
  readonly fresh: string;
  /** Its solves a side, two unless named: at four the report reads the reference against itself. */
  readonly solves?: number;
  readonly tasks: Readonly<
    Record<string, { readonly old: readonly Ends[]; readonly fresh: readonly Ends[] }>
  >;
  readonly rulings?: Readonly<Record<string, Ruling>>;
  readonly cutAfter?: number;
}

/** A log being written, as `writer` makes one. */
type Writer = ReturnType<typeof writer>;

/** What a written fixture is: where, and the names a test asks about. */
export interface Fixture {
  readonly root: string;
  /** The main campaign's name, its log and its key as the server forms it. */
  readonly name: string;
  readonly log: string;
  readonly key: string;
  /** The other two: one with no comparison yet, in the same project; one in another project. */
  readonly early: string;
  readonly units: string;
  /** The projects their openings name: the main campaign's and `early`'s, then `units`'s. */
  readonly projects: { readonly vowels: string; readonly units: string };
  readonly harnesses: {
    readonly starter: string;
    readonly a: string;
    readonly b: string;
    readonly c: string;
    readonly d: string;
  };
  /** A held-out task waiting for a person's label, and the solves whose ruling stays hidden. */
  readonly awaiting: string;
  readonly withheld: readonly string[];
  readonly practiceSolve: string;
  readonly heldOutSolve: string;
  /** A rejected held-out solve whose ruling stands, and the task a person's label disputed. */
  readonly ruledSolve: string;
  readonly disputed: string;
  /** A ruled rejection of the comparison cut before its report. */
  readonly unreportedSolve: string;
}

const MOVE = "campaign.move";
const MODEL = "faux/solver-1";
const SEAT = { model: "faux/seat-1", effort: "high" } as const;
const PROMPT =
  "Count the vowels in a short invented word, such as one a game might make up, and give the count as a whole number.";
/** The projects the campaigns are opened under (`--project`). */
const PROJECTS = { vowels: "vowel-counts", units: "unit-conversion" } as const;
const UNITS_PROMPT =
  "Convert a length between two invented units, given the rate between them, and give the result as a whole number.";
const LIMITS = {
  wallSeconds: 480,
  turns: 24,
  modelTurns: 10,
  shellDefaultSeconds: 120,
  shellMaxSeconds: 240,
  concurrency: 4,
  diskBytes: 1_000_000_000,
};
const CONDITION = {
  contract: sha256("fixture contract"),
  model: MODEL,
  effort: "high",
  prices: { [MODEL]: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  runtime: { "pi-coding-agent": "0.0.0-fixture" },
  compaction: "off",
  solverTools: sha256("fixture solver tools"),
  verifierTools: sha256("fixture verifier tools"),
  sandbox: sha256("fixture sandbox"),
  limits: LIMITS,
  host: sha256("fixture host"),
  side: "test",
} as const;
/** The same condition after the host's code moved: another setting id, as a new commit gives. */
const MOVED_HOST = { ...CONDITION, host: sha256("fixture host, moved") };
const HARNESSES = {
  starter: sha256("fixture starter"),
  a: sha256("fixture harness a"),
  b: sha256("fixture harness b"),
  c: sha256("fixture harness c"),
  d: sha256("fixture harness d"),
};
const UNITS = {
  starter: HARNESSES.starter,
  a: sha256("units harness a"),
  b: sha256("units harness b"),
};
const CAP = { dollars: 12, reserve: 0.5 };
const range = (prefix: string, from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, at) => `${prefix}-${String(from + at).padStart(2, "0")}`);
/** The verdict each ending's answer was given, where an answer reached the verifier. */
const VERDICTS: Readonly<Partial<Record<Ends, JsonObject>>> = {
  pass: { kind: "pass" },
  rejected: { kind: "fail", blocking: [MARKERS.check] },
  format: { kind: "fail", fault: "count is not a whole number" },
  faulty: { kind: "faulty", check: MARKERS.check, reason: "it threw" },
};
/** Each ending as `solve.finished` logs it. */
const ENDINGS: Readonly<Record<Ends, JsonObject>> = {
  pass: { outcome: "pass" },
  provider: { outcome: "non-result", kind: "provider", reason: "the provider closed the connection" },
  faulty: { outcome: "non-result", kind: "check", reason: `${MARKERS.check}: it threw` },
  "no-answer": { outcome: "fail", kind: "no-answer" },
  rejected: { outcome: "fail", kind: "rejected" },
  format: { outcome: "fail", kind: "rejected" },
};
const versionOf = (id: string): string => sha256(`fixture task ${id}`);

/** A log being written for one campaign, the clock that stamps it and the condition its solves
 *  run under. */
function writer(log: string, t0: string, starter: string) {
  let now = Date.parse(t0);
  let solves = 0;
  let condition: typeof CONDITION | typeof MOVED_HOST = CONDITION;
  const ids = new Map<string, string>();
  const later = (seconds: number) => {
    now += seconds * 1000;
    setSystemTime(new Date(now));
  };
  const record = (kind: EventKind, data: JsonObject) => {
    later(7);
    append(log, kind, data);
  };
  /** A seat's turns and calls under `field`, each turn with one call, each with what it billed, the
   *  first numbered `first`. */
  const traced = (
    seat: "build" | "exam" | "draft" | "solve",
    named: JsonObject,
    steps: readonly (readonly [string, string, JsonValue, string])[],
    first = 1,
  ) => {
    for (const [at, [said, tool, args, result]] of steps.entries()) {
      const turn = at + first - 1;
      later(40);
      record(`${seat}.turn`, {
        ...named,
        turn: turn + 1,
        stopReason: "toolUse",
        error: null,
        responseModel: seat === "solve" ? MODEL : SEAT.model,
        usage: { input: 900, output: 160, cost: { total: 0.004 } },
        text: said,
      });
      record(`${seat}.call`, {
        ...named,
        turn: turn + 1,
        tool,
        args,
        isError: false,
        text: result,
        ms: 1800,
      });
    }
  };
  /** One solve: its condition, its start, its trace, its verdict and its end. */
  const solve = (asked: SolveAsked, attempt = 1): string => {
    const { task, harness, ends, comparison, heldOut } = asked;
    if (attempt === 1) solves += 1;
    const id = `s-${String(solves)}-${String(attempt)}`;
    const taskId = ids.get(task) ?? "";
    const recorded = recordCondition(log, { ...condition, task, harness });
    record("solve.started", {
      solve: id,
      condition: recorded,
      task: taskId,
      model: MODEL,
      effort: "high",
      limits: LIMITS,
      load: [2.1, 1.8, 1.5],
      cores: 8,
      ...keyIfDefined("comparison", comparison),
    });
    const answer = { count: heldOut ? `${MARKERS.answer}-${taskId}` : "3" };
    traced("solve", { solve: id }, [
      ["Reading the word and the rules.", "bash", { command: "cat task.json" }, "a short word"],
      ["Writing the count.", "write", { path: "answer.json", content: JSON.stringify(answer) }, "written"],
    ]);
    const verdict = VERDICTS[ends];
    if (verdict !== undefined) record("verdict", { solve: id, task: taskId, answer, ...verdict });
    later(150);
    record("solve.finished", {
      solve: id,
      ending: ENDINGS[ends],
      turns: 2,
      prompts: 1,
      billed: 0.03,
      harness,
      seconds: 160,
      load: [2, 1.8, 1.5],
    });
    // A non-result is solved again, as the runner solves it again (`solve`, src/solve/run.ts).
    return ends === "provider" || ends === "faulty" ? solve({ ...asked, ends: "pass" }, attempt + 1) : id;
  };
  /** The Referee's finding on a rejection: a reader's, with what it billed and its probes' rows. */
  const ruled = (solveId: string, taskId: string, ruling: Ruling) =>
    record("referee.finding", {
      solve: solveId,
      task: taskId,
      ruling,
      check: ruling === "check-defect" ? MARKERS.check : null,
      rule: ruling === "earned" ? "R1" : null,
      field: ruling === "earned" ? "count" : null,
      reason: `${MARKERS.check} read the count; ruled ${ruling}`,
      probes: [1],
      probeRows: [],
      turns: 3,
      billed: 0.02,
    });
  /** The host's ruling of an answer outside the format, which meters nothing. */
  const hostRuled = (solveId: string, taskId: string) =>
    record("referee.finding", {
      solve: solveId,
      task: taskId,
      ruling: "earned",
      check: null,
      rule: null,
      field: null,
      reason: "the answer does not follow the contract's format",
      probes: [],
    });
  return {
    log,
    starter,
    ids,
    record,
    traced,
    solve,
    ruled,
    hostRuled,
    later,
    setting: () => settingId(condition),
    /** The host's code moves: every solve from here runs under another setting id. */
    moveHost: () => {
      condition = MOVED_HOST;
    },
  };
}

/** The opening, the drafted exam, its reading and its freeze. */
function opened(w: Writer, project: string, prompt: string, budget: number, attended = false): void {
  w.record("campaign.opened", {
    project,
    ...keyIfDefined("attended", attended || undefined),
    budget: { dollars: budget, reserve: 0.5 },
    limit: 10,
    sessions: 1,
    patience: 6,
    seats: { builder: SEAT, examiner: SEAT, reviewer: SEAT },
    prompt,
    solver: { model: MODEL, effort: "high" },
    terms: { target: "6", solves: "2", level: "0.1", trigger: "0.25", practice: "2" },
  });
  w.record("draft.started", { session: "d-1", model: SEAT.model, effort: SEAT.effort, prompt });
  w.traced("draft", { session: "d-1" }, [
    ["Drafting the rules and one check a rule.", "draft_exam", { rules: 1 }, "The draft stands."],
  ]);
  w.record("exam.drafted", {
    session: "d-1",
    draft: {
      domain: "an invented domain",
      scope: "one short input",
      conventions: "whole numbers only",
      rules: [{ id: "R1", text: "the answer is the count the input asks for", source: "the prompt" }],
      checks: [{ id: MARKERS.check, rule: "R1" }],
      examples: [],
      controls: [],
    },
  });
  w.record("draft.finished", { session: "d-1", ended: "finished", turns: 1, billed: 0.16, seconds: 300 });
  w.record(MOVE, { move: "draft", why: "the campaign opened from a prompt", session: "d-1" });
  const checker = { contract: CONDITION.contract, checks: sha256("fixture checks") };
  w.record("checker.read", {
    ...checker,
    controls: 2,
    stored: 0,
    rows: [{ id: MARKERS.check, instrument: "authored", named: 1, caught: 1, missing: [] }],
    admitted: [MARKERS.check],
    faults: [],
  });
  w.record("contract.frozen", { ...checker, faults: 0 });
  w.record(MOVE, { move: "accept", why: "nobody has read the checker" });
}

/** An Examiner session that proposes `ids`, held out but for `refused`. */
function examined(w: Writer, session: string, ids: readonly string[], refused: readonly string[]): void {
  w.record("exam.started", {
    session,
    model: SEAT.model,
    effort: SEAT.effort,
    limits: { turns: 40 },
    checks: [MARKERS.check],
    examples: [],
  });
  w.traced("exam", { session }, [
    [
      "Writing inputs the reference may miscount.",
      "propose_tasks",
      { tasks: ids.map((id) => ({ id, hidden: `${MARKERS.hidden}-${id}` })) },
      "proposed",
    ],
    ["Done.", "finish", { note: "inputs with clustered letters" }, "finished"],
  ]);
  const held: string[] = [];
  for (const id of [...ids, ...refused]) {
    const version = versionOf(id);
    const practice = id.includes("-p");
    w.ids.set(version, id);
    w.record("task.proposed", {
      version,
      taskId: id,
      session,
      task: {
        taskId: id,
        family: "count",
        publicInput: { word: `zorbeia-${id}` },
        hidden: { expected: practice ? "3" : `${MARKERS.hidden}-${id}` },
      },
    });
    if (refused.includes(id)) {
      w.record("task.gate", {
        version,
        gate: 1,
        outcome: "refused",
        reason: `${MARKERS.check} cites no rule by id`,
      });
      w.record("task.state", { version, state: "refused", session });
    } else {
      w.record("task.gate", { version, gate: 1, outcome: "passed" });
      held.push(version);
    }
  }
  w.record("exam.finished", {
    session,
    ended: "finished",
    proposed: ids.length + refused.length,
    held,
    refused: refused.map(versionOf),
    turns: 2,
    billed: 0.12,
    seconds: 600,
  });
  w.record(MOVE, {
    move: "examine",
    why: "the campaign holds fewer tasks than a comparison scores",
    session,
  });
}

/** The practice tasks released, and the setting recorded by the first command that needs it. */
function prepared(w: Writer, practice: readonly string[]): void {
  for (const id of practice) w.record("task.state", { version: versionOf(id), state: "released" });
  w.record(MOVE, { move: "prepare", why: "no practice task is released" });
  w.record("campaign.setting", {
    solver: { model: MODEL, effort: "high" },
    minutes: 8,
    modelTurns: 10,
    tasks: null,
    target: 6,
  });
}

/** A Builder session from `parent` that practises on `practice` and leaves `harness`, or is left
 *  open. */
function built(
  w: Writer,
  session: string,
  { parent, harness, practice }: { parent: string; harness: string | null; practice: readonly string[] },
  ends: readonly Ends[],
): string[] {
  w.record("build.started", { session, parent, tasks: practice.map(versionOf), model: SEAT.model });
  w.traced("build", { session }, [
    [
      "Reading the rules and the practice tasks.",
      "read",
      { path: "harness/agent/BUILT_AGENTS.md" },
      "the guide is empty",
    ],
    [
      "Writing a guide on counting letter by letter.",
      "write",
      { path: "harness/agent/BUILT_AGENTS.md" },
      "written",
    ],
  ]);
  if (harness === null) return [];
  const made = ends.map((each, at) =>
    w.solve({ task: versionOf(practice[at % practice.length] ?? ""), harness, ends: each, heldOut: false }),
  );
  for (const [at, each] of ends.entries()) {
    if (each === "format") w.hostRuled(made[at] ?? "", practice[at % practice.length] ?? "");
  }
  w.traced("build", { session }, [["Checking that the harness opens.", "check_harness", {}, "it opens"]], 3);
  w.record("harness.version", { version: harness, parent, session, note: "count letter by letter" });
  w.record("build.finished", {
    session,
    ended: "finished",
    harness,
    changed: true,
    broken: null,
    crash: null,
    turns: 3,
    practiceSolves: ends.length,
    disputed: [],
    faultyChecks: [],
    reviewFaults: [],
    billed: 0.21,
    seconds: 1500,
  });
  w.record(MOVE, { move: "build", code: "build", why: "nothing new to compare", session });
  return made;
}

/** A comparison: its start, its solves, the Referee's rulings and its own report, or as many solves
 *  as `cutAfter` names and no report. It returns each solve by task id, side and number
 *  (`word-02 fresh 0`). */
function compare(w: Writer, planned: Planned): Map<string, string> {
  const { id, old, fresh, solves = 2 } = planned;
  const versions = Object.keys(planned.tasks).map(versionOf);
  w.record("comparison.started", {
    session: id,
    old,
    fresh,
    starter: w.starter,
    setting: w.setting(),
    solves,
    level: 0.1,
    trigger: 0.25,
    cap: CAP,
    tasks: versions,
    retained: [],
  });
  const made = new Map<string, string>();
  const rule = () => {
    for (const [solveAt, ruling] of Object.entries(planned.rulings ?? {})) {
      const [taskId = ""] = solveAt.split(" ");
      const solved = made.get(solveAt);
      if (solved !== undefined) w.ruled(solved, taskId, ruling);
    }
  };
  for (const [taskId, sides] of Object.entries(planned.tasks)) {
    const arms = [
      ["old", old, sides.old],
      ["fresh", fresh, sides.fresh],
    ] as const;
    for (const [side, harness, ends] of arms) {
      for (const [n, each] of ends.entries()) {
        // The Referee rules each rejection before it counts, so a comparison cut before its report
        // holds the rulings of the rejections it made.
        if (planned.cutAfter !== undefined && made.size >= planned.cutAfter) {
          rule();
          return made;
        }
        made.set(
          `${taskId} ${side} ${String(n)}`,
          w.solve({ task: versionOf(taskId), harness, ends: each, comparison: id, heldOut: true }),
        );
      }
    }
  }
  rule();
  const fixed = fixedIn(read(w.log), id);
  if (fixed === null) throw new Error(`comparison ${id} wrote no start`);
  const found = compared(read(w.log), fixed, NO_LABELS);
  const told = { old, fresh, starter: w.starter, ...found, disputed: [], capped: false, settled: null };
  w.record("comparison.reported", {
    session: id,
    tasks: versions.length,
    solves,
    level: 0.1,
    setting: w.setting(),
    broken: null,
    reviewFaults: [],
    // A report is strings, numbers and lists and records of them, as `write` in round.ts spreads it.
    ...asRecord(told),
  });
  w.record(MOVE, {
    move: "compare",
    code: "new",
    why: "a harness to compare",
    session: id,
    load: 1.6,
    cores: 8,
  });
  return made;
}

/** The operator's promotion of `harness`, with what it rests on as `promote.ts` records it. */
function promote(w: Writer, harness: string, from: string, despite?: string): void {
  w.record("harness.promoted", {
    harness,
    from,
    rests: comparedAs(read(w.log), harness).map((rest) => ({ ...rest })),
    ...keyIfDefined("despite", despite),
  });
  w.record(MOVE, { move: "promote", why: "a step read twice", harness });
}

/** The kept harnesses' `agent/` folders, each guide changed from its parent's, and an exam-side
 *  copy beside one that nothing may read. */
function keptStates(dir: string, digests: readonly string[]): void {
  const lines = ["# Guide", "", "Count letter by letter, and name each one counted."];
  for (const [at, digest] of digests.entries()) {
    const agent = join(dir, "states", digest, "agent");
    mkdirSync(agent, { recursive: true });
    writeFileSync(
      join(agent, "tools-spec.json"),
      `${JSON.stringify({ tools: ["read", "bash", "edit", "write"] })}\n`,
    );
    if (at === 0) continue;
    // Each version says which it is, so that a diff of two holds a line removed and a line added.
    const steps = Array.from(
      { length: at - 1 },
      (_, n) => `${String(n + 1)}. Say the count once, as a number.`,
    );
    const guide = [...lines, `Version ${String(at)} of this guide.`, ...steps];
    writeFileSync(join(agent, "BUILT_AGENTS.md"), `${guide.join("\n")}\n`);
  }
  const model = join(dir, "states", digests[1] ?? "", "correctness-model");
  mkdirSync(model, { recursive: true });
  writeFileSync(join(model, "expected.json"), `${JSON.stringify({ expected: MARKERS.hidden })}\n`);
}

/** A campaign's folder under `root`, refused where `root` is the repository's own. */
function folderOf(root: string, name: string): string {
  // The repository's own `.ana/` holds the operator's campaigns, and a fixture is none of them.
  if (resolve(root) === resolve(import.meta.dir, "../../..")) {
    throw new Error("a fixture is written under a directory of its own, never the repository's .ana/");
  }
  const dir = join(resolve(root), ".ana", "d2", name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The main campaign's first part: the exam, the first round, its repeat and the promotion it
 *  earned, the control after it and the second round, settled by a person's labels. */
function firstPart(w: Writer) {
  const { starter, a, b } = HARNESSES;
  const practice = ["word-p1", "word-p2"];
  opened(w, PROJECTS.vowels, PROMPT, 40);
  examined(w, "x-1", [...practice, ...range("word", 1, 12)], ["word-r1"]);
  prepared(w, practice);
  const [practiceSolve = ""] = built(w, "b-1", { parent: starter, harness: a, practice }, ["format", "pass"]);
  const first = compare(w, {
    id: "b-1",
    old: starter,
    fresh: a,
    tasks: {
      "word-01": { old: ["rejected", "rejected"], fresh: ["pass", "pass"] },
      "word-02": { old: ["no-answer", "rejected"], fresh: ["pass", "provider"] },
      "word-03": { old: ["pass", "pass"], fresh: ["pass", "pass"] },
      "word-04": { old: ["pass", "rejected"], fresh: ["rejected", "pass"] },
      "word-05": { old: ["rejected", "rejected"], fresh: ["rejected", "pass"] },
      "word-06": { old: ["no-answer", "no-answer"], fresh: ["no-answer", "rejected"] },
    },
    rulings: {
      "word-01 old 0": "earned",
      "word-01 old 1": "earned",
      "word-02 old 1": "earned",
      "word-04 old 1": "earned",
      "word-04 fresh 0": "earned",
      "word-05 old 0": "earned",
      "word-05 old 1": "earned",
      "word-05 fresh 0": "earned",
      "word-06 fresh 1": "earned",
    },
  });
  compare(w, {
    id: "r-1",
    old: starter,
    fresh: a,
    tasks: {
      "word-01": { old: ["rejected", "pass"], fresh: ["pass", "pass"] },
      "word-02": { old: ["no-answer", "no-answer"], fresh: ["pass", "pass"] },
      "word-03": { old: ["pass", "pass"], fresh: ["pass", "pass"] },
      "word-05": { old: ["rejected", "no-answer"], fresh: ["pass", "pass"] },
      "word-06": { old: ["no-answer", "no-answer"], fresh: ["no-answer", "no-answer"] },
      "word-07": { old: ["no-answer", "rejected"], fresh: ["pass", "rejected"] },
    },
    rulings: {
      "word-01 old 0": "earned",
      "word-05 old 0": "earned",
      "word-07 old 1": "earned",
      "word-07 fresh 1": "earned",
    },
  });
  promote(w, a, starter);
  examined(w, "x-2", range("word", 13, 16), []);
  const control = compare(w, {
    id: "c-1",
    old: a,
    fresh: starter,
    solves: 4,
    tasks: {
      "word-13": {
        old: ["pass", "pass", "pass", "pass"],
        fresh: ["no-answer", "rejected", "no-answer", "no-answer"],
      },
      "word-14": { old: ["pass", "rejected", "pass", "pass"], fresh: ["rejected", "pass", "pass", "pass"] },
      "word-15": { old: ["pass", "pass", "pass", "no-answer"], fresh: ["pass", "pass", "pass", "pass"] },
    },
    rulings: { "word-13 fresh 1": "earned", "word-14 old 1": "earned", "word-14 fresh 0": "unclear" },
  });
  built(w, "b-2", { parent: a, harness: b, practice }, ["pass", "no-answer"]);
  const second = compare(w, {
    id: "b-2",
    old: a,
    fresh: b,
    tasks: {
      "word-01": { old: ["pass", "pass"], fresh: ["pass", "faulty"] },
      "word-02": { old: ["pass", "pass"], fresh: ["rejected", "pass"] },
      "word-04": { old: ["rejected", "pass"], fresh: ["pass", "pass"] },
      "word-05": { old: ["rejected", "pass"], fresh: ["pass", "pass"] },
      "word-07": { old: ["pass", "pass"], fresh: ["pass", "pass"] },
      "word-16": { old: ["no-answer", "pass"], fresh: ["pass", "no-answer"] },
    },
    rulings: { "word-02 fresh 0": "check-defect", "word-04 old 0": "earned", "word-05 old 0": "unclear" },
  });
  w.later(3600);
  settleReading(
    w.log,
    "b-2",
    new Map<string, Ruling>([
      [second.get("word-02 fresh 0") ?? "", "earned"],
      [second.get("word-05 old 0") ?? "", "check-defect"],
    ]),
  );
  return {
    practiceSolve,
    heldOutSolve: first.get("word-01 fresh 0") ?? "",
    ruledSolve: first.get("word-01 old 0") ?? "",
    withheld: [first.get("word-06 fresh 1") ?? "", control.get("word-14 fresh 0") ?? ""],
  };
}

/** The main campaign's second part, after the host's code moved: the third round and its repeat,
 *  a promotion despite the rule, a round whose comparison was cut, a return to the starter, a
 *  comparison against it, and a Builder session open at the end. It returns the cut comparison's
 *  ruled rejection. */
function secondPart(w: Writer): string {
  const { starter, a, b, c, d } = HARNESSES;
  const practice = ["word-p1", "word-p2"];
  w.moveHost();
  built(w, "b-3", { parent: b, harness: c, practice }, ["pass", "pass"]);
  compare(w, {
    id: "b-3",
    old: a,
    fresh: c,
    tasks: {
      "word-08": { old: ["no-answer", "pass"], fresh: ["pass", "pass"] },
      "word-09": { old: ["rejected", "no-answer"], fresh: ["pass", "rejected"] },
      "word-10": { old: ["pass", "pass"], fresh: ["pass", "pass"] },
      "word-11": { old: ["pass", "pass"], fresh: ["rejected", "pass"] },
      "word-12": { old: ["no-answer", "no-answer"], fresh: ["pass", "no-answer"] },
      "word-13": { old: ["pass", "rejected"], fresh: ["pass", "pass"] },
    },
    rulings: { "word-09 old 0": "earned", "word-09 fresh 1": "earned", "word-11 fresh 0": "earned" },
  });
  compare(w, {
    id: "r-3",
    old: a,
    fresh: c,
    tasks: {
      "word-08": { old: ["pass", "pass"], fresh: ["pass", "pass"] },
      "word-10": { old: ["no-answer", "pass"], fresh: ["pass", "pass"] },
      "word-11": { old: ["pass", "pass"], fresh: ["no-answer", "pass"] },
      "word-12": { old: ["no-answer", "no-answer"], fresh: ["no-answer", "pass"] },
      "word-15": { old: ["pass", "pass"], fresh: ["pass", "pass"] },
      "word-16": { old: ["rejected", "no-answer"], fresh: ["no-answer", "rejected"] },
    },
    rulings: { "word-16 old 0": "earned", "word-16 fresh 1": "earned" },
  });
  promote(w, c, a, "the operator's reason, given with --despite");
  examined(w, "x-3", range("word", 17, 22), []);
  built(w, "b-4", { parent: c, harness: d, practice }, ["pass"]);
  const cut = compare(w, {
    id: "b-4",
    old: c,
    fresh: d,
    cutAfter: 5,
    tasks: {
      "word-17": { old: ["rejected", "no-answer"], fresh: ["pass", "pass"] },
      "word-18": { old: ["pass", "pass"], fresh: ["pass", "pass"] },
      "word-19": { old: ["pass", "pass"], fresh: ["pass", "pass"] },
    },
    rulings: { "word-17 old 0": "earned" },
  });
  promote(w, starter, c);
  compare(w, {
    id: "g-9",
    old: starter,
    fresh: b,
    tasks: {
      "word-17": { old: ["no-answer", "no-answer"], fresh: ["pass", "no-answer"] },
      "word-18": { old: ["pass", "pass"], fresh: ["pass", "pass"] },
      "word-19": { old: ["pass", "no-answer"], fresh: ["no-answer", "no-answer"] },
      "word-20": { old: ["rejected", "pass"], fresh: ["pass", "pass"] },
      "word-21": { old: ["no-answer", "no-answer"], fresh: ["no-answer", "no-answer"] },
      "word-22": { old: ["pass", "rejected"], fresh: ["pass", "pass"] },
    },
    rulings: { "word-20 old 0": "earned", "word-22 old 1": "earned" },
  });
  examined(w, "x-4", ["word-23"], []);
  built(w, "b-5", { parent: b, harness: null, practice }, []);
  return cut.get("word-17 old 0") ?? "";
}

/** A campaign in the same project with no comparison yet, opened `--attended`: its exam, its tasks
 *  and its practice. */
function earlyCampaign(root: string, name: string): void {
  const dir = folderOf(root, name);
  const w = writer(join(dir, LOG_FILE), "2026-09-25T09:00:00.000Z", HARNESSES.starter);
  opened(w, PROJECTS.vowels, PROMPT, 20, true);
  examined(w, "x-1", ["word-p8", "word-p9", ...range("word", 31, 36)], []);
  prepared(w, ["word-p8", "word-p9"]);
}

/** A campaign in another project that ended on its budget with two comparisons and no
 *  promotion. */
function unitsCampaign(root: string, name: string): void {
  const dir = folderOf(root, name);
  const w = writer(join(dir, LOG_FILE), "2026-09-20T09:00:00.000Z", UNITS.starter);
  const practice = ["unit-p1", "unit-p2"];
  opened(w, PROJECTS.units, UNITS_PROMPT, 6);
  examined(w, "x-1", [...practice, ...range("unit", 1, 6)], []);
  prepared(w, practice);
  built(w, "b-1", { parent: UNITS.starter, harness: UNITS.a, practice }, ["pass", "rejected"]);
  compare(w, {
    id: "b-1",
    old: UNITS.starter,
    fresh: UNITS.a,
    tasks: {
      "unit-01": { old: ["pass", "pass"], fresh: ["pass", "pass"] },
      "unit-02": { old: ["no-answer", "pass"], fresh: ["pass", "pass"] },
      "unit-03": { old: ["pass", "pass"], fresh: ["no-answer", "pass"] },
      "unit-04": { old: ["no-answer", "no-answer"], fresh: ["no-answer", "no-answer"] },
    },
  });
  // A control with the reference read against itself, whose second sample lost every task: 0 to 4,
  // which a one-sided test of wins reads as nothing and is a false step all the same. The halves
  // are mirrored in time, the first and last of a task's four solves against the two between.
  const lostLater = {
    old: ["pass", "no-answer", "no-answer", "pass"],
    fresh: ["pass", "pass", "pass", "pass"],
  } as const;
  compare(w, {
    id: "c-1",
    old: UNITS.a,
    fresh: UNITS.starter,
    solves: 4,
    tasks: { "unit-01": lostLater, "unit-02": lostLater, "unit-03": lostLater, "unit-04": lostLater },
  });
  built(w, "b-2", { parent: UNITS.a, harness: UNITS.b, practice }, ["pass", "pass"]);
  compare(w, {
    id: "b-2",
    old: UNITS.starter,
    fresh: UNITS.b,
    tasks: {
      "unit-01": { old: ["pass", "pass"], fresh: ["pass", "pass"] },
      "unit-05": { old: ["no-answer", "pass"], fresh: ["pass", "pass"] },
      "unit-06": { old: ["pass", "no-answer"], fresh: ["pass", "pass"] },
      "unit-03": { old: ["pass", "pass"], fresh: ["pass", "no-answer"] },
    },
  });
  w.record("campaign.ended", {
    ending: "budget",
    why: "less is left of the total than the next comparison would bill by what the last one did",
  });
  keptStates(dir, [UNITS.starter, UNITS.a, UNITS.b]);
}

/** Write the three campaigns under `root`, and say what they hold. */
export function writeFixtureCampaign(root: string): Fixture {
  const name = "fixture";
  const dir = folderOf(root, name);
  const log = join(dir, LOG_FILE);
  try {
    unitsCampaign(root, "units");
    earlyCampaign(root, "early");
    const w = writer(log, "2026-09-28T08:00:00.000Z", HARNESSES.starter);
    const said = firstPart(w);
    const unreportedSolve = secondPart(w);
    keptStates(dir, Object.values(HARNESSES));
    return {
      root: resolve(root),
      name,
      log,
      key: `${resolve(root).split("/").at(-1) ?? ""}/${name}`,
      early: "early",
      units: "units",
      projects: PROJECTS,
      harnesses: HARNESSES,
      awaiting: versionOf("word-06"),
      disputed: versionOf("word-05"),
      unreportedSolve,
      ...said,
    };
  } finally {
    setSystemTime();
  }
}

/** Every handler of the server, called directly over the campaigns under `root` in `tier`, as the
 *  router calls them (`api.ts`): what the page's tests render from. */
export function answersOver(root: string, tier: Tier) {
  const reading: Reading = { repo: root, trees: "directory", tier };
  return {
    campaigns: () => campaignsAnswer(reading, {}),
    campaign: (key: string) => campaignAnswer(reading, { key }),
    move: (key: string, move: string) => moveAnswer(reading, { key, move }),
    solve: (key: string, id: string) => solveAnswer(reading, { key, id }),
    tasks: (key: string) => tasksAnswer(reading, { key }),
    task: (key: string, id: string) => taskAnswer(reading, { key, id }),
    log: (query: Query<"log">) => logAnswer(reading, query),
    event: (key: string, index: number) => eventAnswer(reading, { key, index: String(index) }),
    harness: (key: string, digest: string) => harnessAnswer(reading, { key, digest }),
    harnessFile: (key: string, digest: string, path: string) =>
      harnessFileAnswer(reading, { key, digest, path }),
    harnessDiff: (key: string, a: string, b: string) => harnessDiffAnswer(reading, { key, a, b }),
  };
}

if (import.meta.main) {
  const [root] = Bun.argv.slice(2);
  if (root === undefined) throw new Error("usage: bun packages/ui/test/fixture-campaign.ts <dir>");
  const written = writeFixtureCampaign(root);
  console.log(`wrote ${written.log} (${String(read(written.log).length)} events), early and units beside it`);
  console.log(`start the page on it, in packages/ui: PORT=5184 bun serve.ts --repo ${written.root}`);
}
