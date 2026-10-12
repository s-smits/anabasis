// The server's readings of a real log: held to the folds they pass through, to `bun run runs view`,
// and to the wall between the two tiers (the brief of 11 October, sections 7 and 8).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { reported, toLabel } from "../../../src/builder/comparison.ts";
import { campaignOf } from "../../../src/builder/handover.ts";
import { pairings } from "../../../src/kernel/compare.ts";
import { LOG_FILE, read } from "../../../src/kernel/log.ts";
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../../../src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "../../../src/meta/json-runtime.ts";
import { asRecord, isString, type JsonObject } from "../../../src/meta/json-shape.ts";
import { tmpdir } from "../../../src/meta/os.ts";
import { join } from "../../../src/meta/path.ts";
import { overview } from "../../../tools/wri/read.ts";
import { spawnTextSync } from "../../../test/helpers/bun-spawn-sync.ts";
import {
  type AnswerOf,
  type Endpoint,
  NO_PROJECT,
  type Outcome,
  PARAMETERS,
  type Query,
  type Tier,
  TOKEN_HEADER,
} from "../src/models.ts";
import { handleApiRequest } from "../src/server/api.ts";
import { campaignsFound, loaded } from "../src/server/logs.ts";
import { triggerKeepsRulings } from "../src/server/withheld.ts";
import { type Fixture, MARKERS, writeFixtureCampaign } from "./fixture-campaign.ts";

/** A copy of the fixture's root, and its campaign's folder. */
interface Copied {
  readonly root: string;
  readonly dir: string;
}

const TOKEN = "fake-token-of-the-readings-test";
const REPOSITORY = realpathSync(join(import.meta.dir, "../../.."));
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-ui-readings-")));
let fixture: Fixture;
let copies = 0;

let KEY = "";

beforeAll(() => {
  fixture = writeFixtureCampaign(join(scratch, "main"));
  KEY = fixture.key;
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** One request as the page sends it, against the campaigns under `root`: its status, its body
 *  as text, and that body parsed. */
async function ask<Name extends Endpoint>(
  endpoint: Name,
  query: Query<Name>,
  tier: Tier,
  root: string = fixture.root,
): Promise<{ readonly status: number; readonly text: string; readonly answer: AnswerOf<Name> }> {
  const values: Readonly<Record<string, string | undefined>> = query;
  const { required, optional } = PARAMETERS[endpoint];
  const search = new URLSearchParams(
    [...required, ...optional].flatMap((name) => {
      const value = values[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
  const response = handleApiRequest(
    { repo: root, trees: "directory", token: TOKEN, examSide: tier === "exam" },
    new Request(`http://127.0.0.1:5173/api/${endpoint}?${search.toString()}`, {
      headers: { host: "127.0.0.1:5173", [TOKEN_HEADER]: TOKEN },
    }),
  );
  const text = await response.text();
  return { status: response.status, text, answer: parseJsonAs<AnswerOf<Name>>(text) };
}

/** The place in the log of the main campaign's move `id` of kind `step`. */
async function placeOf(step: "examiner" | "builder" | "comparison", id: string): Promise<string> {
  const { answer } = await ask("campaign", { key: KEY }, "default");
  const move = answer.moves.find((each) => each.step === step && each.id === id);
  if (move === undefined) throw new Error(`no ${step} ${id} in the fixture`);
  return String(move.index);
}

/** A copy of the fixture's root, to break in one way. */
function copy(): Copied {
  copies += 1;
  const root = join(scratch, `copy-${String(copies)}`);
  cpSync(fixture.root, root, { recursive: true });
  return { root, dir: join(root, ".ana", "d2", fixture.name) };
}

/** Every answer the server gives of the fixture in `tier`, as the text it sends: every endpoint,
 *  every move, solve, task, page of the log, harness, harness file and pair of harnesses. */
async function everything(tier: Tier): Promise<string[]> {
  const texts: string[] = [];
  const said = async <Name extends Endpoint>(endpoint: Name, query: Query<Name>) => {
    const { status, text, answer } = await ask(endpoint, query, tier);
    expect({ endpoint, query, status }).toEqual({ endpoint, query, status: 200 });
    texts.push(text);
    return answer;
  };
  await said("campaigns", {});
  const reading = await said("campaign", { key: KEY });
  for (const move of reading.moves) await said("move", { key: KEY, move: String(move.index) });
  const grid = await said("tasks", { key: KEY });
  for (const row of grid.rows) await said("task", { key: KEY, id: row.version });
  const solves = new Set<string>();
  for (let offset = 0; ; offset += 100) {
    const page = await said("log", { key: KEY, offset: String(offset) });
    for (const row of page.events) if (row.solve !== null) solves.add(row.solve);
    if (!page.hasMore) break;
  }
  for (const id of solves) await said("solve", { key: KEY, id });
  const digests = reading.harnesses.flatMap(({ digest }) => (digest === null ? [] : [digest]));
  for (const digest of digests) {
    const { files } = await said("harness", { key: KEY, digest });
    for (const { path } of files) await said("harness-file", { key: KEY, digest, path });
  }
  for (const [at, a] of digests.entries()) {
    const b = digests[at + 1];
    if (b !== undefined) await said("harness-diff", { key: KEY, a, b });
  }
  return texts;
}

describe("a campaign's reading", () => {
  test("passes the steps of campaignOf through whole, a comparison's rulings by kind only where none is withheld, and names the move runs view names", async () => {
    const { answer: reading } = await ask("campaign", { key: KEY }, "default");
    const events = read(fixture.log);
    // A comparison's rulings are the handover's: by kind, or their sum where one is withheld.
    const expected = campaignOf(events).steps.map((step, at) => {
      const shown = reading.moves[at];
      if (step.step !== "comparison" || shown?.step !== "comparison") return step;
      const { earned, unclear } = step.rulings;
      const rulings = shown.rulings.withheld
        ? { withheld: true, ruled: earned + unclear + step.rulings["check-defect"] }
        : { withheld: false, kinds: step.rulings };
      return { ...step, rulings };
    });
    // Both through JSON, as the page receives them.
    const steps = reading.moves.map(
      ({ index: _index, startedAt: _started, endedAt: _ended, ...step }) => step,
    );
    expect(capturedJsonParse(capturedJsonStringify(steps))).toEqual(
      capturedJsonParse(capturedJsonStringify(expected)),
    );
    // The view, run as the operator runs it, in a worktree that holds the fixture's campaign.
    const tree = realpathSync(mkdtempSync(join(scratch, "tree-")));
    cpSync(join(fixture.root, ".ana"), join(tree, ".ana"), { recursive: true });
    expect(spawnTextSync("git", ["init", "--quiet"], { cwd: tree }).status).toBe(0);
    const viewed = spawnTextSync("bun", [join(REPOSITORY, "tools/runs/cli.ts"), "view", fixture.name], {
      cwd: tree,
    });
    expect(viewed.stderr).toBe("");
    expect(viewed.stdout.trimEnd().split("\n").at(-1)?.trim()).toBe(reading.nextMove?.line);
    expect(reading.nextMove?.line.length).toBeGreaterThan(0);
  });

  test("splits each comparison's tasks into outcomes that sum to its tally, and orders a repeat, a control, a cut comparison and the promotions", async () => {
    const { answer: reading } = await ask("campaign", { key: KEY }, "default");
    expect(reading.comparisons.map(({ id, kind, repeats, cut }) => [id, kind, repeats, cut])).toEqual([
      ["b-1", "candidate", null, false],
      ["r-1", "repeat", "b-1", false],
      ["c-1", "control", null, false],
      ["b-2", "candidate", null, false],
      ["b-3", "candidate", null, false],
      ["r-3", "repeat", "b-3", false],
      ["b-4", "candidate", null, true],
      ["g-9", "candidate", null, false],
    ]);
    for (const { id, outcomes, tally } of reading.comparisons) {
      if (id === "b-4") continue;
      if (outcomes === null || tally === null) throw new Error(`${id} reported and has no outcomes`);
      expect({
        wins: outcomes.won,
        losses: outcomes.lost,
        ties: outcomes.tiedEvery + outcomes.tiedSome + outcomes.tiedNone,
      }).toEqual(tally);
    }
    // The setting changes once, between the second round and the third.
    const settings = reading.comparisons.map(({ setting }) => setting);
    expect(new Set(settings).size).toBe(2);
    expect(settings.findIndex((setting) => setting !== settings[0])).toBe(4);
    const { starter, a, b, c, d } = fixture.harnesses;
    expect(
      reading.promotions.map(({ harness, afterComparison, toStarter, despite }) => [
        harness,
        afterComparison,
        toStarter,
        despite !== null,
      ]),
    ).toEqual([
      [a, "r-1", false, false],
      [c, "r-3", false, true],
      [starter, "b-4", true, false],
    ]);
    expect(reading.harnesses.map(({ digest, reference, latest }) => [digest, reference, latest])).toEqual([
      [starter, true, false],
      [a, false, false],
      [b, false, false],
      [c, false, false],
      [d, false, true],
    ]);
    // Each card's comparisons are the ones that measured it, each by its own move's place.
    for (const card of reading.harnesses) {
      const measured = reading.comparisons.flatMap((bar) =>
        bar.fresh === card.digest ? [[bar.id, bar.move]] : [],
      );
      expect(card.comparedIn.map(({ id, move }) => [id, move])).toEqual(measured);
    }
    const kinds = reading.comparisons.flatMap(({ rulings }) => (rulings.withheld ? [] : [rulings.kinds]));
    expect([kinds.some((each) => each["check-defect"] > 0), kinds.length > 0]).toEqual([true, true]);
    expect(reading.open).toEqual(["b-5"]);
    expect(reading.spend.at(-1)?.cumulative).toBeCloseTo(reading.row.billed, 9);
  });
});

describe("what a comparison came to", () => {
  test("gives each comparison the table's row its move recorded, and none where no move recorded one", async () => {
    const { answer: reading } = await ask("campaign", { key: KEY }, "default");
    const named = reading.comparisons.map((bar) => bar.named);
    expect(named.filter((each) => each !== null).length).toBeGreaterThan(0);
    for (const each of named) {
      if (each !== null) expect(each).toEqual({ code: "new", why: "a harness to compare" });
    }
  });

  test("names every task a comparison fixed: its outcome, set aside, or why its report left it out", async () => {
    const { answer: reading } = await ask("campaign", { key: KEY }, "default");
    for (const bar of reading.comparisons) {
      if (bar.outcomes === null || bar.leftOut === null) {
        expect({ id: bar.id, reading: bar.reading, leftOut: bar.leftOut }).toEqual({
          id: bar.id,
          reading: null,
          leftOut: null,
        });
        continue;
      }
      const { won, lost, tiedEvery, tiedSome, tiedNone, aside } = bar.outcomes;
      const { disputed, short, withdrawn } = bar.leftOut;
      const parts = [won, lost, tiedEvery, tiedSome, tiedNone, aside, disputed, short, withdrawn];
      expect({ id: bar.id, sum: parts.reduce((sum, each) => sum + each, 0) }).toEqual({
        id: bar.id,
        sum: bar.tasks,
      });
    }
    // b-2 fixed six tasks, and a person's label of a check defect disputed one of them.
    expect(reading.comparisons.find(({ id }) => id === "b-2")?.leftOut).toEqual({
      disputed: 1,
      short: 0,
      withdrawn: 0,
    });
  });

  test("splits each tied task by the reference's validity, as its own solves' endings in the log say", async () => {
    const endings = new Map(
      read(fixture.log).flatMap(({ kind, data }) =>
        kind === "solve.finished" && isString(data.solve)
          ? [[data.solve, asRecord(data.ending)?.outcome]]
          : [],
      ),
    );
    const valid = (id: string) => endings.get(id) === "pass";
    const detail = (await ask("move", { key: KEY, move: await placeOf("comparison", "b-1") }, "default"))
      .answer;
    if (detail.kind !== "comparison") throw new Error("b-1 is a comparison");
    const told = detail.tasks.map(({ taskId, outcome, old, fresh }) => {
      const [before, after] = [old.map(({ id }) => valid(id)), fresh.map(({ id }) => valid(id))];
      const won = pairings({ task: "", old: before, fresh: after });
      const reference = before.filter(Boolean).length;
      let expected: Outcome = reference === before.length ? "tiedEvery" : "tiedSome";
      if (reference === 0) expected = "tiedNone";
      if (won.fresh !== won.old) expected = won.fresh > won.old ? "won" : "lost";
      return [taskId, outcome === "aside" ? "aside" : expected, outcome];
    });
    expect(told.map(([taskId, , outcome]) => [taskId, outcome])).toEqual(
      told.map(([taskId, expected]) => [taskId, expected]),
    );
    // The comparison holds each kind of tie, so that two swapped would fail above.
    const kinds = new Set(told.map(([, expected]) => expected));
    expect(["tiedEvery", "tiedSome", "tiedNone"].every((kind) => kinds.has(kind))).toBe(true);
  });

  test("cuts each side of a set-aside task to its solves a side, so that an A/A reading's further arm is no part of the reference's", async () => {
    const { answer: grid } = await ask("tasks", { key: KEY }, "default");
    const column = grid.columns.findIndex(({ id }) => id === "c-1");
    const aside = grid.rows.flatMap(({ id, cells }) => {
      const cell = cells[column];
      return cell?.outcome === "aside" ? [[id, cell.old.solves, cell.fresh.solves]] : [];
    });
    expect(aside).toEqual([["word-14", 2, 2]]);
    const detail = (await ask("move", { key: KEY, move: await placeOf("comparison", "c-1") }, "default"))
      .answer;
    if (detail.kind !== "comparison") throw new Error("c-1 is a comparison");
    const task = detail.tasks.find(({ outcome }) => outcome === "aside");
    expect([task?.old.length, task?.fresh.length]).toEqual([2, 2]);
  });

  test("lists a comparison with no report by the tasks its start fixed and its solves so far, with no outcome", async () => {
    const { answer: reading } = await ask("campaign", { key: KEY }, "default");
    const cut = reading.comparisons.find(({ id }) => id === "b-4");
    const detail = (await ask("move", { key: KEY, move: String(cut?.move ?? -1) }, "default")).answer;
    if (detail.kind !== "comparison") throw new Error("b-4 is a comparison");
    expect(detail.tasks.map(({ taskId, outcome }) => [taskId, outcome])).toEqual([
      ["word-17", null],
      ["word-18", null],
      ["word-19", null],
    ]);
    const solves = detail.tasks.flatMap(({ old, fresh }) => [...old, ...fresh]);
    expect([solves.length, cut?.begun]).toEqual([5, 5]);
    expect(detail.tasks.map(({ withheld }) => withheld)).toEqual(["report", null, null]);
  });

  test("counts an A/A reading as a step where either sample wins by the level, as the whole-run reader does", async () => {
    const units = `${KEY.split("/")[0] ?? ""}/${fixture.units}`;
    const { answer: reading } = await ask("campaign", { key: units }, "default");
    const control = reading.comparisons.find(({ noise }) => noise !== null);
    // The second sample lost every task: a one-sided test of its wins reads nothing.
    expect([control?.noise?.tally, (control?.noise?.p ?? 0) > (control?.level ?? 1)]).toEqual([
      { wins: 0, losses: 4, ties: 0 },
      true,
    ]);
    const false_steps = overview(
      read(join(fixture.root, ".ana", "d2", fixture.units, "log.jsonl")),
    ).triggers.filter(
      ({ name, detail }) =>
        name === "REFERENCE AGAINST ITSELF" && detail.includes("reads a step where none can be"),
    );
    expect([reading.counters.controls, reading.counters.controlSteps]).toEqual([1, false_steps.length]);
    expect(false_steps.length).toBe(1);
  });

  test("says apart the two things that wait for a person's label: tasks, and set-aside rejections of unsettled comparisons", async () => {
    const { answer: reading } = await ask("campaign", { key: KEY }, "default");
    const events = read(fixture.log);
    const unsettled = reading.comparisons.flatMap(({ id }) =>
      reported(events, id)?.settled === null ? toLabel(events, id).aside : [],
    );
    expect(reading.counters.labels).toEqual({ tasks: reading.supply.awaiting, rejections: unsettled.length });
    expect([reading.counters.labels.tasks, reading.counters.labels.rejections]).toEqual([1, 2]);
  });
});

describe("the wall between the tiers", () => {
  test("holds every hidden value, answer and check name out of every default-tier answer, which the exam tier shows", async () => {
    const shown = (await everything("default")).join("\n");
    const exam = (await everything("exam")).join("\n");
    const found = (text: string) => Object.values(MARKERS).map((marker) => [marker, text.includes(marker)]);
    expect(found(shown)).toEqual(Object.values(MARKERS).map((marker) => [marker, false]));
    expect(found(exam)).toEqual(Object.values(MARKERS).map((marker) => [marker, true]));
  });

  test("gives a Builder session's turns and calls in the default tier, and an Examiner session's in the exam tier alone", async () => {
    for (const tier of ["default", "exam"] as const) {
      const builder = (await ask("move", { key: KEY, move: await placeOf("builder", "b-1") }, tier)).answer;
      const examiner = (await ask("move", { key: KEY, move: "x-1" }, tier)).answer;
      if (builder.kind !== "session" || examiner.kind !== "session") {
        throw new Error("b-1 and x-1 are sessions");
      }
      expect((builder.turns?.length ?? 0) > 0 && (builder.calls?.length ?? 0) > 0).toBe(true);
      expect(["turns" in examiner, "calls" in examiner]).toEqual(
        tier === "exam" ? [true, true] : [false, false],
      );
    }
  });

  test("gives a practice solve's trace in the default tier, and a held-out solve's in the exam tier alone", async () => {
    const practice = (await ask("solve", { key: KEY, id: fixture.practiceSolve }, "default")).answer;
    const heldOut = (await ask("solve", { key: KEY, id: fixture.heldOutSolve }, "default")).answer;
    expect([practice.heldOut, "trace" in practice, heldOut.heldOut, "trace" in heldOut]).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(["verdict" in heldOut, "ruling" in heldOut]).toEqual([false, false]);
    const shown = (await ask("solve", { key: KEY, id: fixture.heldOutSolve }, "exam")).answer;
    expect(["trace" in shown, "verdict" in shown, "ruling" in shown]).toEqual([true, true, true]);
  });

  test("withholds a ruling in both tiers while a person's label of its rejection is still to come, and shows a label that stands", async () => {
    for (const id of fixture.withheld) {
      for (const tier of ["default", "exam"] as const) {
        const { answer } = await ask("solve", { key: KEY, id }, tier);
        expect({ id, tier, ruling: "ruling" in answer, row: "ruling" in answer.solve }).toEqual({
          id,
          tier,
          ruling: false,
          row: false,
        });
      }
    }
    const settled = (await ask("move", { key: KEY, move: await placeOf("comparison", "b-2") }, "exam"))
      .answer;
    if (settled.kind !== "comparison") throw new Error("b-2 is a comparison");
    const labelled = settled.tasks
      .flatMap(({ fresh }) => fresh)
      .find(({ ending }) => ending?.outcome === "fail" && ending.kind === "rejected");
    expect(labelled?.ruling).toBe("earned");
    expect((await ask("solve", { key: KEY, id: labelled?.id ?? "" }, "exam")).answer.ruling?.by).toBe(
      "label",
    );
  });
});

describe("the rulings and the endings each tier may see", () => {
  test("sends a comparison's rulings by kind only while none of them is withheld, in both tiers", async () => {
    for (const tier of ["default", "exam"] as const) {
      const { answer: reading, text } = await ask("campaign", { key: KEY }, tier);
      const withheld = reading.comparisons.map(({ id, rulings }) => [id, rulings.withheld]);
      // b-1 holds a rejection of a task that waits for a label, c-1 and b-3 one set aside in a
      // comparison nobody settled (b-3's unruled), and b-4 never reported; the others are settled
      // or set nothing aside.
      expect(withheld).toEqual([
        ["b-1", true],
        ["r-1", false],
        ["c-1", true],
        ["b-2", false],
        ["b-3", true],
        ["r-3", false],
        ["b-4", true],
        ["g-9", false],
      ]);
      for (const move of reading.moves) {
        if (move.step !== "comparison") continue;
        const bar = reading.comparisons.find(({ id }) => id === move.id);
        expect({ id: move.id, rulings: move.rulings }).toEqual({
          id: move.id,
          rulings: bar?.rulings ?? move.rulings,
        });
        expect(bar).toBeDefined();
      }
      // Where one is withheld, nothing of the comparison names a kind.
      const parsed = capturedJsonParse(text);
      expect(capturedJsonStringify(parsed).match(/"kinds":/g)?.length).toBe(2 * 4);
      expect(reading.comparisons.find(({ id }) => id === "c-1")?.rulings).toEqual({
        withheld: true,
        ruled: 3,
      });
    }
  });

  test("withholds every ruling of a comparison that has not reported, in both tiers", async () => {
    for (const tier of ["default", "exam"] as const) {
      const { answer } = await ask("solve", { key: KEY, id: fixture.unreportedSolve }, tier);
      expect({
        tier,
        withheld: answer.withheld,
        ruling: "ruling" in answer,
        row: "ruling" in answer.solve,
      }).toEqual({
        tier,
        withheld: "report",
        ruling: false,
        row: false,
      });
    }
  });

  test("leaves out the reader's count of set-aside rejections by side for a comparison whose rulings are withheld", async () => {
    for (const tier of ["default", "exam"] as const) {
      const { answer: reading } = await ask("campaign", { key: KEY }, tier);
      const sides = reading.reader.triggers.flatMap(({ name, detail }) =>
        name === "SET ASIDE BY SIDE" ? [detail.split(": ")[0]] : [],
      );
      const withheld = new Set(
        reading.comparisons.flatMap(({ id, rulings }) => (rulings.withheld ? [id] : [])),
      );
      expect(sides.filter((id) => withheld.has(id ?? ""))).toEqual([]);
    }
  });

  test("leaves out the reader's counts over every ruling while any ruling of the log is withheld", () => {
    // The fixture's reader fires neither count, so the rule is asked directly: of the main
    // campaign, which holds withheld rulings, and of the one with no comparison, which holds none.
    const found = campaignsFound({ repo: fixture.root, trees: "directory" }).found;
    const logOf = (name: string) => {
      const campaign = found.find((each) => each.name === name);
      const log = campaign === undefined ? null : loaded(campaign).log;
      if (log === null) throw new Error(`no log of ${name}`);
      return log;
    };
    for (const name of ["EARNED WITHOUT A PROBE", "REPLAY MOVED THE VERDICT"] as const) {
      expect(triggerKeepsRulings(logOf(fixture.name), { name, detail: "1 of 3" })).toBe(false);
      expect(triggerKeepsRulings(logOf(fixture.early), { name, detail: "1 of 3" })).toBe(true);
    }
    expect(triggerKeepsRulings(logOf(fixture.name), { name: "NO PRACTICE", detail: "b-1: 1" })).toBe(true);
  });

  test("shows a campaign finished by its Builder as ended", async () => {
    const { root, dir } = copy();
    const why = "the Builder ended its campaign conversation";
    appendFileSync(
      join(dir, "log.jsonl"),
      `${JSON.stringify({
        at: "2026-10-12T12:00:00.000Z",
        kind: "campaign.ended",
        data: { ending: "finished", why },
      })}\n`,
    );
    const shown = await ask("campaigns", {}, "default", root);
    expect(shown.answer.campaigns.find(({ name }) => name === fixture.name)).toMatchObject({
      status: "ended",
      ending: { ending: "finished", why },
    });
  });

  test("sends an ending's reason where the controller words it, and the kind alone of an environment's in the default tier", async () => {
    const { root } = copy();
    const marker = "error-quartz-0101";
    appendFileSync(
      join(root, ".ana", "d2", fixture.early, "log.jsonl"),
      `${JSON.stringify({ at: "2026-09-25T12:00:00.000Z", kind: "campaign.ended", data: { ending: "environment", why: `${marker}: the step threw`, move: "build" } })}\n`,
    );
    const shown = await ask("campaigns", {}, "default", root);
    const rows = new Map(shown.answer.campaigns.map((row) => [row.name, row.ending]));
    expect(rows.get(fixture.early)).toEqual({ ending: "environment" });
    expect(shown.text.includes(marker)).toBe(false);
    expect(rows.get(fixture.units)?.why).toContain("less is left of the total");
    const key = `${root.split("/").at(-1) ?? ""}/${fixture.early}`;
    expect((await ask("campaign", { key }, "default", root)).text.includes(marker)).toBe(false);
    const exam = await ask("campaigns", {}, "exam", root);
    expect(exam.answer.campaigns.find(({ name }) => name === fixture.early)?.ending?.why).toBe(
      `${marker}: the step threw`,
    );
  });

  test("holds the crash an environment ending quotes out of the next move in the default tier, before the ending is logged and after", async () => {
    const { root, dir } = copy();
    const marker = "crash-basalt-0202";
    const key = `${root.split("/").at(-1) ?? ""}/${fixture.name}`;
    const event = (at: string, kind: string, data: JsonObject) => `${JSON.stringify({ at, kind, data })}\n`;
    for (const at of ["01", "02", "03"]) {
      appendFileSync(
        join(dir, "log.jsonl"),
        event(`2026-09-29T${at}:00:00.000Z`, "exam.finished", {
          session: `e-crash-${at}`,
          ended: "crashed",
          crash: `${marker}: the provider refused`,
          held: [],
        }),
      );
    }
    const open = await ask("campaign", { key }, "default", root);
    expect(open.answer.nextMove).toMatchObject({ move: "end", ending: "environment" });
    expect(open.text.includes(marker)).toBe(false);
    expect(open.answer.nextMove?.line).toBe(
      `the campaign ends (environment): ${open.answer.nextMove?.why ?? ""}`,
    );
    const openExam = (await ask("campaign", { key }, "exam", root)).answer.nextMove;
    expect([openExam?.why, openExam?.line].map((said) => said?.includes(marker))).toEqual([true, true]);
    appendFileSync(
      join(dir, "log.jsonl"),
      event("2026-09-29T04:00:00.000Z", "campaign.ended", {
        ending: "environment",
        why: `${marker}: the provider refused`,
        move: "examine",
      }),
    );
    const ended = await ask("campaign", { key }, "default", root);
    expect(ended.answer.row.ending).toEqual({ ending: "environment" });
    expect(ended.text.includes(marker)).toBe(false);
    expect((await ask("campaign", { key }, "exam", root)).answer.row.ending?.why).toContain(marker);
  });
});

describe("what the server cannot read", () => {
  test("reads a log whose last line is torn without that line, and says so", async () => {
    const { root, dir } = copy();
    appendFileSync(join(dir, "log.jsonl"), '{"at":"2026-09-28T16:00:00.000Z","kind":"solve.turn"');
    const { answer } = await ask("campaigns", {}, "default", root);
    expect(answer.campaigns.map(({ name }) => name)).toEqual([fixture.name, fixture.early, fixture.units]);
    expect(answer.issues.map(({ level, message }) => [level, message.split(":")[0]])).toEqual([
      ["warning", "the last line is torn"],
    ]);
  });

  test("lists no row for a log with a line that is no event, and names the log in an error", async () => {
    const { root, dir } = copy();
    appendFileSync(join(dir, "log.jsonl"), "not an event\n");
    const { answer } = await ask("campaigns", {}, "default", root);
    expect(answer.campaigns.map(({ name }) => name)).toEqual([fixture.early, fixture.units]);
    expect(answer.issues).toMatchObject([
      { level: "error", source: `${root.split("/").at(-1) ?? ""}/.ana/d2/fixture/log.jsonl` },
    ]);
  });

  test("says when a harness's folder is missing, refuses a path that leaves agent/, and follows no link out of it", async () => {
    const { root, dir } = copy();
    const { a, b } = fixture.harnesses;
    rmSync(join(dir, "states", b, "agent"), { recursive: true });
    symlinkSync(
      join(dir, "states", a, "correctness-model", "expected.json"),
      join(dir, "states", a, "agent", "expected.json"),
    );
    const key = `${root.split("/").at(-1) ?? ""}/fixture`;
    const missing = (await ask("harness", { key, digest: b }, "exam", root)).answer;
    expect([missing.files, missing.issues.map(({ level }) => level)]).toEqual([[], ["error"]]);
    const listed = (await ask("harness", { key, digest: a }, "exam", root)).answer;
    expect(listed.files.map(({ path }) => path)).toEqual(["agent/BUILT_AGENTS.md", "agent/tools-spec.json"]);
    expect(listed.issues.map(({ source }) => source)).toEqual(["agent/expected.json"]);
    for (const path of [
      "agent/expected.json",
      "agent/../correctness-model/expected.json",
      "correctness-model/expected.json",
    ]) {
      const file = (await ask("harness-file", { key, digest: a, path }, "exam", root)).answer;
      expect({ path, value: file.value, refused: file.issues.map(({ level }) => level) }).toEqual({
        path,
        value: null,
        refused: ["error"],
      });
    }
    const unknown = (await ask("harness", { key, digest: "f".repeat(64) }, "exam", root)).answer;
    expect(unknown.issues.map(({ message }) => message)).toEqual([
      "the log names no harness by this digest, so nothing under states/ is read for it",
    ]);
  });

  test("lists a file whose diff runs past the server's bound with no diff and an issue, and diffs the files beside it", async () => {
    const { root, dir } = copy();
    const { a, b } = fixture.harnesses;
    // Two texts that share no line: about 11 seconds of the diff's work on the review's host.
    writeFileSync(join(dir, "states", a, "agent", "lines.txt"), "a\n".repeat(8000));
    writeFileSync(join(dir, "states", b, "agent", "lines.txt"), "b\n".repeat(8000));
    writeFileSync(join(dir, "states", a, "agent", "notes.md"), "first\n");
    writeFileSync(join(dir, "states", b, "agent", "notes.md"), "second\n");
    const key = `${root.split("/").at(-1) ?? ""}/${fixture.name}`;
    const { answer } = await ask("harness-diff", { key, a, b }, "default", root);
    expect(answer.files.map(({ path, diff }) => [path, diff === null ? null : diff.includes("@@")])).toEqual([
      ["agent/BUILT_AGENTS.md", true],
      ["agent/lines.txt", null],
      ["agent/notes.md", true],
    ]);
    expect(answer.issues.map(({ level, source }) => [level, source])).toEqual([
      ["warning", "agent/lines.txt"],
    ]);
  });

  test("refuses a harness whose agent folder is a link, to the exam side's copy beside it or to its own folder", async () => {
    for (const target of ["correctness-model", ".."]) {
      const { root, dir } = copy();
      const { a } = fixture.harnesses;
      const agent = join(dir, "states", a, "agent");
      rmSync(agent, { recursive: true });
      symlinkSync(target, agent);
      const key = `${root.split("/").at(-1) ?? ""}/fixture`;
      const listed = await ask("harness", { key, digest: a }, "default", root);
      expect({
        target,
        files: listed.answer.files,
        levels: listed.answer.issues.map(({ level }) => level),
      }).toEqual({
        target,
        files: [],
        levels: ["error"],
      });
      for (const path of [
        "agent/expected.json",
        "agent/correctness-model/expected.json",
        "agent/agent/BUILT_AGENTS.md",
      ]) {
        const file = await ask("harness-file", { key, digest: a, path }, "default", root);
        expect({
          target,
          path,
          value: file.answer.value,
          leaked: file.text.includes(MARKERS.hidden),
        }).toEqual({
          target,
          path,
          value: null,
          leaked: false,
        });
      }
      const diff = await ask("harness-diff", { key, a: fixture.harnesses.starter, b: a }, "default", root);
      expect({ target, leaked: diff.text.includes(MARKERS.hidden) }).toEqual({ target, leaked: false });
    }
  });

  test("lists each campaign under the project its opening names, and one whose opening names none apart", async () => {
    const { answer } = await ask("campaigns", {}, "default");
    const projects = Object.fromEntries(answer.campaigns.map(({ name, project }) => [name, project]));
    expect(projects).toEqual({
      [fixture.name]: fixture.projects.vowels,
      [fixture.early]: fixture.projects.vowels,
      [fixture.units]: fixture.projects.units,
    });
    // An opening written before a project was named, as every log before 12 October holds: no
    // project is guessed for it from its prompt or its name.
    const { root } = copy();
    const units = join(root, ".ana", "d2", fixture.units, LOG_FILE);
    const unnamed = readFileSync(units, "utf8").replaceAll(`"project":"${fixture.projects.units}",`, "");
    expect(unnamed).not.toContain(fixture.projects.units);
    writeFileSync(units, unnamed);
    const listed = (await ask("campaigns", {}, "default", root)).answer.campaigns;
    expect(listed.find(({ name }) => name === fixture.units)?.project).toBe(NO_PROJECT);
    expect(listed.find(({ name }) => name === fixture.name)?.project).toBe(fixture.projects.vowels);
  });

  test("reads a log again only once its size or its time moved, and keeps it otherwise", () => {
    const { root, dir } = copy();
    const found = campaignsFound({ repo: root, trees: "directory" }).found.find(
      ({ name }) => name === fixture.name,
    );
    if (found === undefined) throw new Error("the copy holds no campaign");
    const first = loaded(found).log;
    expect(loaded(found).log).toBe(first);
    appendFileSync(
      join(dir, "log.jsonl"),
      `${JSON.stringify({ at: "2026-09-28T16:00:00.000Z", kind: "campaign.word", data: { stop: "a pause" } })}\n`,
    );
    const again = loaded(found).log;
    expect(again).not.toBe(first);
    expect(again?.events.length).toBe((first?.events.length ?? 0) + 1);
  });
});
