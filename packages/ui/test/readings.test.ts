// The server's readings of a real log: control readings, log integrity and the wall between tiers.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { read } from "../../../src/kernel/log.ts";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../../../src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "../../../src/meta/json-runtime.ts";
import { asRecord, type JsonObject } from "../../../src/meta/json-shape.ts";
import { tmpdir } from "../../../src/meta/os.ts";
import { join } from "../../../src/meta/path.ts";
import { type AnswerOf, type Endpoint, type Query, type Tier, TOKEN_HEADER } from "../src/models.ts";
import { handleApiRequest } from "../src/server/api.ts";
import { campaignsFound } from "../src/server/logs.ts";
import { campaignReading, campaignRow } from "../src/server/reading.ts";
import { type Fixture, MARKERS, writeFixtureCampaign, writeLedCampaign } from "./fixture-campaign.ts";

/** A copy of the fixture's root, and its campaign's folder. */
interface Copied {
  readonly root: string;
  readonly dir: string;
}

const TOKEN = "fake-token-of-the-readings-test";
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
  const search = new URLSearchParams(
    Object.entries(values).flatMap(([name, value]) => (value === undefined ? [] : [[name, value]])),
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

describe("what a comparison came to", () => {
  test("counts an A/A step only when both tests clear the level in the same direction", async () => {
    const units = `${KEY.split("/")[0] ?? ""}/${fixture.units}`;
    const { answer: controlReading } = await ask("campaign", { key: units }, "default");
    // At two solves a side b-1 and b-2 carry an A/A too, the first solve against the second.
    const control = controlReading.comparisons.find(({ id }) => id === "c-1");
    // The second sample lost every task: a one-sided test of its wins reads nothing.
    expect([control?.noise?.tally, (control?.noise?.p ?? 0) > (control?.level ?? 1)]).toEqual([
      { wins: 0, losses: 4, ties: 0 },
      true,
    ]);
    expect([controlReading.counters.controls, controlReading.counters.controlSteps]).toEqual([3, 1]);
    const found = campaignsFound({ repo: fixture.root, trees: "directory" }).found.find(
      ({ name }) => name === fixture.units,
    );
    if (found === undefined) throw new Error("the units campaign exists");
    const events = read(found.path);
    for (const [unbilled, steps] of [
      [[0, 0, 0, 0], 0],
      [[1, 1, 1, -1], 0],
      [[1, 1, 1, 1], 0],
      [[-1, -1, -1, -1], 1],
    ] as const) {
      const log = {
        events: events.map((event) => {
          const noise = asRecord(event.data.noise);
          return event.kind === "comparison.reported" && noise !== null
            ? { ...event, data: { ...event.data, noise: { ...noise, unbilled } } }
            : event;
        }),
      };
      const row = campaignRow(found, log, { process: null, tier: "default" });
      const reading = campaignReading(found, log, { row, tier: "default", issues: [] });
      expect([reading.counters.controls, reading.counters.controlSteps]).toEqual([3, steps]);
    }
  });
});

describe("what carried a comparison's wins", () => {
  test("names the measure of every won and lost task and of no tie, and sums each side to the tally", async () => {
    const { answer } = await ask("campaign", { key: KEY }, "default");
    const reported = answer.comparisons.filter((bar) => bar.tally !== null && bar.carried !== null);
    expect(reported.length).toBeGreaterThan(0);
    const sum = ({ validity, objective, bill }: { validity: number; objective: number; bill: number }) =>
      validity + objective + bill;
    for (const bar of reported) {
      expect({ id: bar.id, won: sum(bar.carried?.won ?? { validity: 0, objective: 0, bill: 0 }) }).toEqual({
        id: bar.id,
        won: bar.tally?.wins ?? -1,
      });
      expect({ id: bar.id, lost: sum(bar.carried?.lost ?? { validity: 0, objective: 0, bill: 0 }) }).toEqual({
        id: bar.id,
        lost: bar.tally?.losses ?? -1,
      });
      const { answer: detail } = await ask("move", { key: KEY, move: String(bar.move) }, "default");
      if (detail.kind !== "comparison") throw new Error(`${bar.id} is a comparison`);
      for (const task of detail.tasks) {
        const decided = task.outcome === "won" || task.outcome === "lost";
        expect({ task: task.task, outcome: task.outcome, carried: task.carried !== null }).toEqual({
          task: task.task,
          outcome: task.outcome,
          carried: decided,
        });
      }
    }
    // A comparison with no report has nothing carried.
    expect(answer.comparisons.filter((bar) => bar.tally === null).every((bar) => bar.carried === null)).toBe(
      true,
    );
  });
});

describe("an open Builder session's practice solves", () => {
  test("lists the solves its head counts, past an Examiner session the Builder began", async () => {
    const root = join(scratch, "led");
    const key = writeLedCampaign(root);
    const { answer: reading } = await ask("campaign", { key }, "default", root);
    const session = reading.moves.find((move) => move.step === "builder" && move.id === "b-1");
    expect(session?.step === "builder" ? session.practiceSolves : null).toBe(1);
    const { answer } = await ask("move", { key, move: String(session?.index) }, "default", root);
    expect(answer.kind === "session" ? answer.solves.length : null).toBe(1);
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

  test("withholds a ruling in both tiers while a person's label of its rejection is still to come, and shows a label that stands", async () => {
    for (const id of fixture.withheld) {
      for (const tier of ["default", "exam"] as const) {
        const { answer } = await ask("solve", { key: KEY, id }, tier);
        expect({
          id,
          tier,
          withheld: answer.withheld,
          ruling: "ruling" in answer,
          row: "ruling" in answer.solve,
        }).toEqual({
          id,
          tier,
          withheld: "label",
          ruling: false,
          row: false,
        });
      }
    }
    const { answer: campaign } = await ask("campaign", { key: KEY }, "default");
    const move = campaign.moves.find((each) => each.step === "comparison" && each.id === "b-2");
    expect(move).toBeDefined();
    const settled = (await ask("move", { key: KEY, move: String(move?.index) }, "exam")).answer;
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
    expect(open.answer.nextMove?.line).toContain("environment");
    expect(open.answer.nextMove?.line).toContain(open.answer.nextMove?.why ?? "missing reason");
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
});

describe("the harness boundary", () => {
  test("says when a harness's folder is missing, refuses a path into the exam side's copy, and follows no link into it", async () => {
    const { root, dir } = copy();
    const { a, b } = fixture.harnesses;
    rmSync(join(dir, "states", b), { recursive: true });
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
    expect([unknown.files, unknown.issues.map(({ level }) => level)]).toEqual([[], ["error"]]);
  });

  test("follows a link in a harness no further than the campaign's kept harnesses, and never into the exam side's copy", async () => {
    for (const target of ["correctness-model", ".."]) {
      const { root, dir } = copy();
      const { a } = fixture.harnesses;
      const agent = join(dir, "states", a, "agent");
      rmSync(agent, { recursive: true });
      symlinkSync(target, agent);
      const key = `${root.split("/").at(-1) ?? ""}/fixture`;
      const listed = await ask("harness", { key, digest: a }, "default", root);
      for (const path of [
        "agent/expected.json",
        "agent/correctness-model/expected.json",
        `agent/${a}/correctness-model/expected.json`,
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
      expect({
        target,
        leaked: [listed.text, diff.text].some((text) => text.includes(MARKERS.hidden)),
      }).toEqual({
        target,
        leaked: false,
      });
    }
  });
});

describe("programs kept with a harness", () => {
  test("lists a harness's programs through its .toolchain link, sends a binary with no value, diffs them, and follows no link out of states/", async () => {
    const { root, dir } = copy();
    const { a, b } = fixture.harnesses;
    const states = join(dir, "states");
    for (const [digest, tree, said] of [
      [a, "tree-a", "one"],
      [b, "tree-b", "two"],
    ] as const) {
      mkdirSync(join(states, tree, "bin"), { recursive: true });
      // A program is a file a command can run by name, so each is executable.
      writeFileSync(
        join(states, tree, "bin", "count"),
        `#!/bin/sh\n# count [task.json]\n# Prints ${said}.\necho ${said}\n`,
        { mode: 0o755 },
      );
      writeFileSync(join(states, tree, "bin", "engine"), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1]), {
        mode: 0o755,
      });
      symlinkSync(`../${tree}`, join(states, digest, ".toolchain"));
    }
    symlinkSync(tmpdir(), join(states, "tree-b", "bin", "host"));
    mkdirSync(join(states, "tree-b", "correctness-model"));
    writeFileSync(join(states, "tree-b", "correctness-model", "expected.json"), MARKERS.hidden);
    const key = `${root.split("/").at(-1) ?? ""}/${fixture.name}`;
    const listed = await ask("harness", { key, digest: b }, "default", root);
    expect(listed.answer.files.map(({ path }) => path).toSorted()).toEqual([
      ".toolchain/bin/count",
      ".toolchain/bin/engine",
      "agent/BUILT_AGENTS.md",
      "agent/tools-spec.json",
    ]);
    expect(listed.answer.issues.map(({ level, source }) => [level, source])).toEqual([
      ["warning", ".toolchain/bin/host"],
    ]);
    expect(listed.text.includes(MARKERS.hidden)).toBe(false);
    // A program carries its head comment, past the shebang; a binary and the agent's files none.
    expect(Object.fromEntries(listed.answer.files.map(({ path, about }) => [path, about]))).toEqual({
      ".toolchain/bin/count": "count [task.json]\nPrints two.",
      ".toolchain/bin/engine": null,
      "agent/BUILT_AGENTS.md": null,
      "agent/tools-spec.json": null,
    });
    expect(listed.text.includes(states)).toBe(false);
    const fileAt = async (path: string) =>
      (await ask("harness-file", { key, digest: b, path }, "default", root)).answer;
    const [program, engine] = [await fileAt(".toolchain/bin/count"), await fileAt(".toolchain/bin/engine")];
    expect([program.content, program.value, engine.content, engine.value]).toEqual([
      "text",
      "#!/bin/sh\n# count [task.json]\n# Prints two.\necho two\n",
      "other",
      null,
    ]);
    const diff = (await ask("harness-diff", { key, a, b }, "default", root)).answer;
    expect(diff.files.map(({ path, change }) => [path, change])).toEqual([
      [".toolchain/bin/count", "changed"],
      ["agent/BUILT_AGENTS.md", "changed"],
    ]);
  });
});
