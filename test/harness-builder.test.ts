import { afterAll, describe, expect, it, setDefaultTimeout, spyOn } from "bun:test";
import { examine } from "../src/examiner/session.ts";
import { append, LOG_FILE, type LogEvent, read } from "../src/kernel/log.ts";
import { pendingWords } from "../src/campaign/word.ts";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { flagsOf, opened, type Seats } from "../tools/d2/campaign-terms.ts";
import { closeCommand } from "../tools/d2/close.ts";
import { harnessBuilder } from "../tools/d2/harness-builder.ts";
import { importCommand } from "../tools/d2/import.ts";
import { packetOf, settleCommand } from "../tools/d2/settle.ts";
import { wordCommand } from "../tools/d2/word.ts";
import { harnessesOf } from "../tools/runs/registry.ts";
import { scriptedSeats } from "../tools/runs/rehearse.ts";
import {
  FORMAT,
  type FixtureTask,
  fixtureTasks,
  gradedOf,
  layOutPack,
  OPENED_FROM,
  scriptedModel,
} from "./helpers/fixture-pack.ts";
import { anyOf, arrayWith, containing, objectWith } from "./helpers/matchers.ts";

const REPO = resolve(import.meta.dir, "..");
const FIXTURE = join(REPO, "test", "fixtures", "harness-min");
const STEM = `test-hb-${String(runtimeProcess.pid)}`;
const OPENED = "campaign.opened";
const PROJECT = "fixture-products";
const MOVED = "campaign.move";
const SMALL = fixtureTasks(7);
const TASKS = fixtureTasks(16);
const scripted = scriptedModel;
const GRADED = gradedOf(TASKS);
const GRADED_SMALL = gradedOf(SMALL);
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-hb-")));
const names: string[] = [];

setDefaultTimeout(600_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  for (const name of names) rmSync(join(REPO, ".ana", "d2", name), { recursive: true, force: true });
});

function draftedOf(tasks: readonly FixtureTask[]) {
  const exam = {
    domain: "Fixture products",
    scope: "A task gives a base and asks for six times it.",
    conventions: "The answer is a decimal string without a sign.",
    rules: [
      { id: "R1", statement: "The answer is the base times six.", source: "A fixture: no field states it." },
    ],
    answer_format: FORMAT,
    checks: [{ id: "check-product", rule: "R1", assertion: "The answer is six times the base." }],
    evaluator: `export const checks = {\n  "check-product": (req) => req.artifact.answer === String(req.publicTask.publicInput.base * 6),\n};\n`,
    tasks: tasks.map(({ family, publicInput, hidden }) => ({ family, public_input: publicInput, hidden })),
    accept_controls: tasks.map(({ publicInput }, task) => ({
      task,
      answer: { answer: String(publicInput.base * 6) },
    })),
    reject_controls: [{ task: 0, answer: { answer: "13" }, check: "check-product" }],
    objective: { none: "A fixture: every task has one product, and no product is better than another." },
  };
  const examples = tasks.map(({ publicInput }, index) => ({
    taskId: `ex-${String(index + 1).padStart(3, "0")}`,
    answer: { answer: String(publicInput.base * 6) },
    refusedBy: null,
  }));
  return { exam, examples };
}

function seeded(name: string, tasks: readonly FixtureTask[] = SMALL): string[] {
  names.push(name);
  const folder = join(REPO, ".ana", "d2", name);
  if (!existsSync(join(folder, LOG_FILE))) layOutPack(folder, tasks);
  writeFileSync(join(folder, "seed.json"), `${JSON.stringify({ from: null, events: 0 })}\n`);
  return ["--name", name, "--project", PROJECT, ...OPENED_FROM, "--admit", "check-product"];
}

const of = (name: string, kind: string): JsonObject[] =>
  read(join(REPO, ".ana", "d2", name, LOG_FILE)).flatMap((event: LogEvent) =>
    event.kind === kind ? [event.data] : [],
  );

const answering = (strayed: string[] = [], graded = GRADED) =>
  scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, graded, strayed);

const idle: NonNullable<Seats["examine"]> = (request) =>
  examine({
    ...request,
    ...scripted([
      ["finish", { note: "No further tasks." }],
      ["finish", { note: "No further tasks." }],
    ]),
  });

describe("the campaign's executing Bun and opening guards", () => {
  it("refuses a mismatched Bun pin from its tree manifest before writing a campaign", () => {
    const tree = join(root, "pinned");
    mkdirSync(tree);
    cpSync(join(REPO, "tools"), join(tree, "tools"), { recursive: true });
    for (const part of ["src", "vendor", "node_modules"]) symlinkSync(join(REPO, part), join(tree, part));
    const manifest = parseJsonAs<JsonObject>(readFileSync(join(REPO, "package.json"), "utf8"));
    writeFileSync(
      join(tree, "package.json"),
      JSON.stringify({ ...manifest, packageManager: "bun@0.0.1", engines: { bun: "0.0.1" } }),
    );
    const opening = ["--project", PROJECT, "--prompt", "Multiply a base by six.", "--budget", "100"];
    const seats = ["builder", "examiner", "reviewer", "solver"].flatMap((seat) => [
      `--${seat}`,
      "claude/claude-opus-5-5",
    ]);
    const result = runSync(
      [
        capturedExecPath,
        join(tree, "tools/d2/harness-builder.ts"),
        "--name",
        "pinned",
        ...opening,
        ...seats,
        "--moves",
        "0",
      ],
      {
        cwd: root,
        env: { PATH: "/usr/bin:/bin", HOME: root, CLAUDE_CODE_OAUTH_TOKEN: "fixture", ANA_TEST_TMPDIR: root },
      },
    );
    expect(result.exitCode).toBe(1);
    expect(decodeOutput(result.stderr)).toContain(`${join(tree, "package.json")}: `);
    expect(decodeOutput(result.stderr)).toContain(`executing Bun ${Bun.version}`);
    expect(existsSync(join(tree, ".ana"))).toBe(false);
  });

  it("enforces opening, reviewer, budget-word, paid-target, credential, and empty-move guards", async () => {
    const ledName = `${STEM}-led-term`;
    const ledLog = join(REPO, ".ana", "d2", ledName, LOG_FILE);
    names.push(ledName);
    const ledFlags = flagsOf(["--name", ledName, "--project", PROJECT, ...OPENED_FROM]);
    opened(ledLog, ledFlags, "scripted");
    const [firstOpen] = read(ledLog);
    append(ledLog, OPENED, { ...firstOpen?.data, led: true });
    expect(opened(ledLog, ledFlags, "scripted")).not.toHaveProperty("led");
    expect(read(ledLog)).toHaveLength(2);

    const reviewerLog = join(root, "terms", "reviewer", LOG_FILE);
    const termFlags = (...more: string[]) =>
      flagsOf(["--name", "terms", "--project", PROJECT, ...OPENED_FROM, "--budget", "100", ...more]);
    expect(() => opened(reviewerLog, termFlags(), "paid")).toThrow("--reviewer");
    expect(read(reviewerLog)).toEqual([]);
    expect(opened(reviewerLog, termFlags(), "scripted")).toMatchObject({ seats: { reviewer: null } });
    expect(() => opened(reviewerLog, termFlags(), "paid")).toThrow("--reviewer");
    const model = "claude/claude-opus-5-5";
    expect(opened(reviewerLog, termFlags("--reviewer", model), "paid").seats.reviewer?.model).toBe(model);
    expect(opened(reviewerLog, termFlags(), "paid").seats.reviewer?.model).toBe(model);

    const budgetLog = join(root, "terms", "budget", LOG_FILE);
    const budgetFlags = flagsOf(["--name", "terms", "--project", PROJECT, ...OPENED_FROM, "--budget", "300"]);
    expect(opened(budgetLog, budgetFlags, "scripted").budget?.dollars).toBe(300);
    append(budgetLog, "campaign.word", { word: "budget", dollars: 50 });
    expect(opened(budgetLog, budgetFlags, "scripted", pendingWords(read(budgetLog))).budget?.dollars).toBe(
      50,
    );
    expect(pendingWords(read(budgetLog))).toEqual([]);

    const refusedFirst = `${STEM}-refused-first`;
    names.push(refusedFirst);
    await expect(
      harnessBuilder(
        [
          "--name",
          refusedFirst,
          "--project",
          PROJECT,
          "--solver",
          model,
          "--prompt",
          "Multiply a base by six.",
        ],
        { seated: answering([], GRADED_SMALL) },
      ),
    ).rejects.toThrow("a rehearsal seats no Examiner");
    expect(of(refusedFirst, "campaign.setting")).toHaveLength(1);
    expect(of(refusedFirst, "campaign.move")).toEqual([]);
    expect(of(refusedFirst, "campaign.ended")).toEqual([]);

    const smallName = `${STEM}-small`;
    const seatFlags = ["builder", "examiner", "reviewer"].flatMap((seat) => [`--${seat}`, model]);
    const paid = [...seeded(smallName, SMALL), "--budget", "100", ...seatFlags];
    const [token, key] = [Bun.env.CLAUDE_CODE_OAUTH_TOKEN, Bun.env.OPENROUTER_API_KEY];
    Bun.env.CLAUDE_CODE_OAUTH_TOKEN = "a-login";
    delete Bun.env.OPENROUTER_API_KEY;
    try {
      await expect(harnessBuilder([...paid, "--target", "7", "--dry-run"])).rejects.toThrow(
        "name a --target of at least 8",
      );
      expect(await harnessBuilder([...paid, "--target", "8", "--dry-run"])).toMatchObject({ move: "accept" });
      await expect(
        harnessBuilder([
          ...paid,
          "--solver",
          "openrouter/deepseek/deepseek-v4.1-flash-1017",
          "--target",
          "8",
          "--dry-run",
        ]),
      ).rejects.toThrow("its provider holds no credential");
    } finally {
      if (token === undefined) delete Bun.env.CLAUDE_CODE_OAUTH_TOKEN;
      else Bun.env.CLAUDE_CODE_OAUTH_TOKEN = token;
      if (key === undefined) delete Bun.env.OPENROUTER_API_KEY;
      else Bun.env.OPENROUTER_API_KEY = key;
    }

    const emptyMove = `${STEM}-empty-move`;
    await expect(
      harnessBuilder(seeded(emptyMove, SMALL), {
        seated: answering([], GRADED_SMALL),
        prepare: async () => 0,
      }),
    ).rejects.toThrow("the move changed nothing");
    expect(of(emptyMove, "campaign.ended")).toMatchObject([{ ending: "environment", move: "prepare" }]);

    expect(() => wordCommand(["--name", `${STEM}-missing`, "--stop", "x"])).toThrow(
      "has no opening on record",
    );
    expect(() => wordCommand(["--name", ledName, "--stop", "x", "--budget", "5"])).toThrow("one word");
    expect(() => wordCommand(["--name", ledName, "--cause", "the host was loaded"])).toThrow();
  });

  it("ends open build, exam, and draft sessions as killed before its first move, and never twice", async () => {
    const name = `${STEM}-cut`;
    const flags = [
      ...seeded(name, SMALL),
      "--patience",
      "1",
      "--target",
      "5",
      "--level",
      "0.125",
      "--practice",
      "2",
    ];
    const solves = answering([], GRADED_SMALL);
    const seats: Seats = {
      seated: (campaign, given) => ({
        ...solves(campaign, given),
        builder: scripted([["finish", { note: "Done." }]]),
      }),
      examine: idle,
    };
    await harnessBuilder([...flags, "--moves", "2"], seats);
    const log = join(REPO, ".ana", "d2", name, LOG_FILE);
    const usage = { cost: { total: 0.25 } };
    for (const kind of ["exam", "build", "draft"] as const) {
      const session = kind === "exam" ? "x-1" : `${kind[0]}-1`;
      append(log, `${kind}.started`, { session });
      append(log, `${kind}.turn`, { session, usage });
    }
    const before = read(log).length;
    await harnessBuilder([...flags, "--moves", "1"], seats);
    const after = read(log).slice(before);
    const cut = { ended: "killed", crash: null, turns: 1, billed: 0.25 };
    expect(after.slice(0, 2)).toMatchObject([
      { kind: "build.finished", data: { session: "b-1", ...cut } },
      { kind: "exam.finished", data: { session: "x-1", ...cut } },
    ]);
    expect(after.find(({ kind }) => kind === "draft.finished")).toMatchObject({
      data: { session: "d-1", ...cut },
    });
    expect(after.findIndex(({ kind }) => kind === MOVED)).toBeGreaterThan(2);
    await harnessBuilder([...flags, "--moves", "0"], seats);
    expect(read(log).filter(({ data }) => data.ended === "killed")).toHaveLength(3);
  });
});

describe.concurrent("end-to-end campaign lifecycles, settlement, and handover", () => {
  it("runs --hitl promotion, load-wait, retained ratio, revert, blind settlement, and handover", async () => {
    const name = `${STEM}-climb`;
    const flags = [...seeded(name, TASKS), "--practice", "2", "--target", "8", "--patience", "1"];
    const strayed: string[] = [];
    const written = [41, 42, 43, 44, 45, 46, 47, 48, 49, 50].map((base) => ({
      family: "fixture",
      public_input: { base },
      hidden: null,
    }));
    const proposingAfter =
      (ready: Promise<void>): Seats["examine"] =>
      (request) =>
        examine({
          ...request,
          ...scripted([
            {
              wait: async () => {
                await ready;
                return ["propose_tasks", { tasks: written }];
              },
            },
            ["finish", { note: "Ten more." }],
            ["finish", { note: "Ten more." }],
          ]),
        });
    const seats: Seats = { seated: answering(strayed), examine: proposingAfter(Promise.resolve()) };
    let loaded = true;
    const host = {
      load: () => {
        const once = loaded && of(name, "comparison.started").length > 0;
        loaded &&= !once;
        return once ? 99 : 0;
      },
      cores: 4,
      waitMs: 1,
      sleep: Bun.sleep,
    };

    const waits = await harnessBuilder([...flags, "--hitl"], { ...seats, host });
    expect(waits).toMatchObject({ move: "promote" });
    const kept = read(join(REPO, ".ana", "d2", name, LOG_FILE));
    const waited = kept.findIndex(({ kind }) => kind === "campaign.waited");
    expect(of(name, "campaign.waited")).toEqual([
      objectWith({ comparison: "g-1", load: 99, cores: 4, ms: anyOf(Number) }),
    ]);
    const held = kept[waited]?.data.task;
    expect(waited).toBeLessThan(
      kept.findLastIndex(({ kind, data }) => kind === "solve.started" && data.task === held),
    );
    expect(of(name, MOVED).filter(({ load }) => load !== undefined)).toEqual([]);
    for (const made of of(name, MOVED).filter(({ move }) => move === "compare")) {
      expect(made.args).toEqual(arrayWith(["--level", "0.02"]));
    }
    const [first] = of(name, "comparison.reported");
    expect(first).toMatchObject({
      reading: "step",
      scored: { wins: 8, losses: 0, ties: 0 },
      settled: "unsettled",
    });
    expect(of(name, "harness.promoted")).toEqual([]);
    expect(await harnessBuilder(flags, seats)).toMatchObject({ move: "promote" });
    expect(of(name, OPENED).at(-1)).toMatchObject({ attended: true });

    const asked = Promise.withResolvers<void>();
    const next = await harnessBuilder([...flags, "--no-hitl", "--moves", "3"], {
      seated: (campaign, given) => ({
        ...seats.seated(campaign, given),
        builder: scripted([
          ["bash", { command: `printf '\\nA line.\\n' >> "$HOME/harness/agent/BUILT_AGENTS.md"` }],
          {
            wait: async () => {
              asked.resolve();
              return ["compare", {}];
            },
          },
          ["finish", { note: "Nothing more." }],
        ]),
      }),
      examine: proposingAfter(asked.promise),
    });
    expect(of(name, OPENED).at(-1)).not.toHaveProperty("attended");
    expect(of(name, "harness.promoted")).toMatchObject([{ harness: first?.fresh }]);
    expect(of(name, "exam.finished")).toMatchObject([{ session: "x-1", proposed: 10, ended: "supplied" }]);
    expect(next).toMatchObject({ move: "compare", fresh: "starter", reference: "promoted" });

    const after = await harnessBuilder([...flags, "--moves", "1"], seats);
    const { tasks, retained } = of(name, "comparison.started").at(-1) ?? {};
    const [scored = 0, beside = 0] = [tasks, retained].map((set) => (Array.isArray(set) ? set.length : 0));
    expect(beside).toBe(Math.ceil((scored - beside) / 3));
    expect(beside).toBeGreaterThan(Math.floor((scored - beside) / 3));
    expect(of(name, "comparison.reported").at(-1)).toMatchObject({
      session: "g-2",
      reading: "no-step",
      valid: { old: [11, 0, 0], fresh: [11, 0, 0], informative: { old: 3, fresh: 3 } },
    });
    expect(after).toMatchObject({ move: "revert", harness: first?.starter });
    expect(strayed).toEqual([]);

    const pack = ["--name", name];
    const folder = join(REPO, ".ana", "d2", name, "settle-g-1");
    const file = join(folder, "labels.json");
    const packet = () =>
      parseJsonAs<{ rejections: JsonObject; passes: JsonObject }>(readFileSync(file, "utf8"));
    const lastOf = () => of(name, "comparison.reported").findLast(({ session }) => session === "g-1");
    await settleCommand([...pack, "--session", "g-1"]);
    const drawn = Object.keys(packet().passes);
    expect(Object.keys(packet().rejections)).toEqual([]);
    expect(drawn).toHaveLength(3);
    rmSync(file);
    await settleCommand([...pack, "--session", "g-1"]);
    expect(Object.keys(packet().passes)).toEqual(drawn);
    const shown = readFileSync(join(folder, `${drawn[0]}.json`), "utf8");
    expect(Object.keys(parseJsonAs<{ contract: JsonObject }>(shown).contract)).toEqual(
      arrayWith(["scope", "conventions", "rules", "answerFormat"]),
    );
    expect(shown).not.toContain(first?.fresh ?? "");
    const [a = "", b = "", c = ""] = drawn;
    const answer = (labels: JsonObject) =>
      writeFileSync(file, JSON.stringify({ rejections: {}, passes: labels }));
    answer({ [a]: "sound", [b]: "wrng", [c]: "sound" });
    await expect(settleCommand([...pack, "--session", "g-1"])).rejects.toThrow(
      "holds what is no label (sound, wrong, unclear) for 1 answer",
    );
    answer({ [a]: "sound", [b]: "", [c]: "sound" });
    await settleCommand([...pack, "--session", "g-1"]);
    expect(lastOf()).toMatchObject({ settled: "unsettled" });
    answer({ [a]: "sound", [b]: "wrong", [c]: "sound" });
    const said = spyOn(console, "log");
    await settleCommand([...pack, "--session", "g-1"]);
    const lines = said.mock.calls.map(([line]) => (isString(line) ? line : ""));
    said.mockRestore();
    expect(lines).toContain("3 labelled passes: sound 2, wrong 1, unclear 0; wrong rate 0.33 (1/3 decided)");
    await settleCommand([...pack, "--session", "g-1"]);
    expect(lastOf()).toMatchObject({
      reading: "step",
      scored: { wins: 8, losses: 0, ties: 0 },
      settled: { labelled: 0, passes: { [a]: "sound", [b]: "wrong", [c]: "sound" } },
    });
    expect(of(name, "comparison.reported").filter(({ session }) => session === "g-1")).toHaveLength(2);

    const to = join(root, "handover");
    await expect(closeCommand([...pack, "--to", join(REPO, ".ana", "handover")])).rejects.toThrow(
      "lies inside the repository",
    );
    const handed = await closeCommand([...pack, "--to", to]);
    expect((await closeCommand([...pack, "--to", to])).harness).toBe(handed.harness);
    const other = join(root, "other");
    mkdirSync(other);
    writeFileSync(join(other, "notes.txt"), "");
    await expect(closeCommand([...pack, "--to", other])).rejects.toThrow(
      "holds something besides a handover",
    );
    const inside = harnessesOf(REPO, `test-${crypto.randomUUID()}`);
    try {
      const starterHandover = await closeCommand([...pack, "--to", inside, "--harness", "starter"]);
      expect(starterHandover.harness).not.toBe(handed.harness);
      expect(readFileSync(join(inside, "REPORT.md"), "utf8")).toContain("which is not the reference harness");
    } finally {
      rmSync(inside, { recursive: true, force: true });
    }
    const report = readFileSync(join(to, "REPORT.md"), "utf8");
    expect(report).toContain("settled 1 comparison, and 1 comparison is unsettled");
    expect(report).toContain("## The chance of a false promotion\n\n- Epoch 1:");
    expect(report).not.toContain("ex-001");
    expect(report).not.toContain("check-product");
    const links = readdirSync(join(to, "harness"), { recursive: true }).filter((entry) =>
      lstatSync(join(to, "harness", String(entry))).isSymbolicLink(),
    );
    expect(links).toEqual([]);
    expect(readFileSync(join(to, "RULES.md"), "utf8")).toContain("- R1: The answer is the base times six.");

    const before = read(join(REPO, ".ana", "d2", name, LOG_FILE)).length;
    const trial = join(root, "handover-solved");
    await expect(closeCommand([...pack, "--to", trial, "--solve", "no-such-task"])).rejects.toThrow(
      "--solve no-such-task: the campaign holds no task by that id",
    );
    rmSync(trial, { recursive: true, force: true });
    const solved = await closeCommand([...pack, "--to", trial, "--solve", "ex-001"], answering(strayed));
    expect(solved).toMatchObject({ harness: handed.harness, solved: ["pass"] });
    expect(read(join(REPO, ".ana", "d2", name, LOG_FILE))).toHaveLength(before);
  });

  it("opens from a prompt, retries an invalid draft, waits under --hitl, and locks setting and level", async () => {
    const name = `${STEM}-prompt`;
    names.push(name);
    const folder = join(REPO, ".ana", "d2", name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "seed.json"), `${JSON.stringify({ from: null, events: 0 })}\n`);
    const prompt = "Multiplying a base by six, as a fixture.";
    const solver = ["--solver", "claude/claude-opus-5-5"];
    const flags = [
      "--name",
      name,
      "--project",
      PROJECT,
      ...solver,
      "--practice",
      "2",
      "--solve-minutes",
      "8",
      "--target",
      "5",
      "--level",
      "0.125",
      "--solves",
      "3",
      "--patience",
      "2",
    ];
    const { exam, examples } = draftedOf(SMALL);
    const wrong = {
      ...exam,
      reject_controls: [{ task: 0, answer: { answer: "12" }, check: "check-product" }],
    };
    const strayed: string[] = [];
    const seats: Seats = {
      seated: scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, examples, strayed),
      draft: (request) =>
        examine({
          ...request,
          ...scripted([
            ["draft_exam", wrong],
            ["draft_exam", exam],
          ]),
        }),
    };
    await expect(harnessBuilder(["--name", name], seats)).rejects.toThrow(
      "give the prompt the campaign opens from",
    );
    expect(await harnessBuilder([...flags, "--prompt", prompt, "--dry-run"], seats)).toMatchObject({
      move: "draft",
    });
    expect(existsSync(join(folder, LOG_FILE))).toBe(false);

    const fresh = `${STEM}-fresh`;
    names.push(fresh);
    const opening = ["--name", fresh, ...solver, "--prompt", prompt, "--patience", "1", "--moves", "0"];
    await expect(harnessBuilder(opening, seats)).rejects.toThrow("name --project");
    await expect(harnessBuilder([...opening, "--project", "a/b"], seats)).rejects.toThrow("--project a/b");
    expect(existsSync(join(REPO, ".ana", "d2", fresh))).toBe(false);
    expect(await harnessBuilder([...opening, "--project", PROJECT], seats)).toMatchObject({ move: "draft" });
    await expect(
      harnessBuilder(["--name", fresh, "--project", "elsewhere", "--moves", "0"], seats),
    ).rejects.toThrow(`this campaign belongs to project ${PROJECT}, and keeps it`);

    const waits = await harnessBuilder([...flags, "--prompt", prompt, "--hitl"], seats);
    expect(waits).toMatchObject({ move: "end", ending: "exam" });
    expect(of(name, "campaign.setting")).toMatchObject([{ minutes: 8, target: 5, solves: 3 }]);
    expect(of(name, "draft.finished")).toMatchObject([{ session: "d-1", stands: true, tries: 2 }]);
    expect(of(name, "checker.read").at(-1)?.faults).toEqual([containing("--admit check-product")]);
    expect(of(name, "contract.frozen")).toEqual([]);

    const next = await harnessBuilder(["--name", name, "--no-hitl", "--moves", "3"], seats);
    expect(of(name, "comparison.started")).toMatchObject([{ solves: 3 }]);
    expect(of(name, "comparison.started")[0]?.tasks).toHaveLength(5);
    expect(of(name, "comparison.reported")).toMatchObject([
      { reading: "step", scored: { wins: 5, losses: 0, ties: 0 } },
    ]);
    expect(next).toMatchObject({ move: "promote", code: "step" });
    expect(strayed).toEqual([]);

    await harnessBuilder(["--name", name, "--minutes", "200", "--moves", "0"], seats);
    expect(of(name, OPENED).at(-1)).toMatchObject({
      project: PROJECT,
      terms: { practice: "2", minutes: "200" },
    });
    await expect(
      harnessBuilder(["--name", name, "--solve-minutes", "30", "--moves", "0"], seats),
    ).rejects.toThrow("--solve-minutes 30 names another setting than the campaign's");
    const before = read(join(REPO, ".ana", "d2", name, LOG_FILE)).length;
    await expect(harnessBuilder(["--name", name, "--level", "0.05", "--moves", "0"], seats)).rejects.toThrow(
      "--level 0.05: the campaign's comparisons began at level 0.125",
    );
    expect(read(join(REPO, ".ana", "d2", name, LOG_FILE))).toHaveLength(before);
    await harnessBuilder(["--name", name, "--level", "0.125", "--moves", "0"], seats);
  });

  it("hands over a harness's links as links, and leaves nothing where the copy is not the harness", async () => {
    const name = `${STEM}-links`;
    seeded(name, SMALL);
    const pack = ["--name", name];
    const host = join(root, "host-file.txt");
    writeFileSync(host, "HOST-FILE-CANARY\n");
    const built = join(root, "linked", "harness");
    cpSync(FIXTURE, built, { recursive: true });
    mkdirSync(join(built, ".toolchain", "bin"), { recursive: true });
    symlinkSync(host, join(built, ".toolchain", "bin", "leak"));
    const kept = await importCommand(["--name", name, "--harness", built]);
    append(join(REPO, ".ana", "d2", name, LOG_FILE), "harness.promoted", { harness: kept.digest });
    const to = join(root, "handover-linked");
    expect(await closeCommand([...pack, "--to", to])).toMatchObject({ harness: kept.digest });
    expect(lstatSync(join(to, "harness", ".toolchain")).isDirectory()).toBe(true);
    expect(readlinkSync(join(to, "harness", ".toolchain", "bin", "leak"))).toBe(host);
    const guide = join(kept.dir, "agent", "BUILT_AGENTS.md");
    renameSync(guide, join(kept.dir, "agent", "guide.md"));
    symlinkSync(join(kept.dir, "agent", "guide.md"), guide);
    const refused = join(root, "handover-refused");
    await expect(closeCommand([...pack, "--to", refused])).rejects.toThrow(
      "agent/BUILT_AGENTS.md links outside the harness",
    );
    expect(readdirSync(refused)).toEqual([]);
  });
});

describe.concurrent("a campaign's recovery from throws and pauses", () => {
  const LIMIT = "You've hit your limit · resets 11pm (UTC)";
  const stoppingHost = (name: string, nth: number) => {
    const sleeps: number[] = [];
    let now = Date.now();
    const host = {
      load: () => 0,
      cores: 1,
      waitMs: 1,
      now: () => now,
      sleep: async (ms: number) => {
        if (sleeps.push(ms) !== nth) return;
        wordCommand(["--name", name, "--stop", "done"]);
        now += 10_000_000;
      },
    };
    return { host, sleeps };
  };

  it("waits out a provider limit and a network crash, then holds a pause before the next move", async () => {
    const name = `${STEM}-recover`;
    const flags = [...seeded(name, SMALL), "--practice", "2", "--target", "5", "--level", "0.125"];
    const log = join(REPO, ".ana", "d2", name, LOG_FILE);
    const { host, sleeps } = stoppingHost(name, 3);
    let tries = 0;
    const handover = join(root, "handover-on-end");
    const paused = await harnessBuilder([...flags, "--handover", handover, "--moves", "5"], {
      seated: answering([], GRADED_SMALL),
      host,
      prepare: async () => {
        tries += 1;
        if (tries === 1) throw new Error(LIMIT);
        if (tries === 2) {
          append(log, "build.started", { session: "b-crash" });
          append(log, "build.finished", {
            session: "b-crash",
            ended: "crashed",
            crash: "ECONNRESET",
            turns: 0,
            billed: 0,
          });
          throw new Error("crashed");
        }
        append(log, "campaign.word", { word: "pause" });
        return 1;
      },
    });
    expect(paused).toMatchObject({ move: "end", ending: "operator" });
    expect(tries).toBe(3);
    expect(of(name, "campaign.waited").map(({ for: why }) => why)).toEqual(["provider", "network"]);
    expect(sleeps).toHaveLength(3);
    expect(existsSync(join(handover, "REPORT.md"))).toBe(true);
    const events = read(log);
    const at = (kind: string, key: string, value: string) =>
      events.findIndex((event) => event.kind === kind && event.data[key] === value);
    expect(at("campaign.waited", "for", "network")).toBeLessThan(at("campaign.word", "word", "pause"));
  });

  it("ends on the environment where a move throws after a session that finished whole", async () => {
    const name = `${STEM}-noncrash`;
    const log = join(REPO, ".ana", "d2", name, LOG_FILE);
    await expect(
      harnessBuilder([...seeded(name, SMALL), "--moves", "2"], {
        seated: answering([], GRADED_SMALL),
        host: stoppingHost(name, 0).host,
        prepare: async () => {
          append(log, "build.finished", { session: "b-ok", ended: "finished", turns: 1, billed: 0 });
          throw new Error("plain failure");
        },
      }),
    ).rejects.toThrow("plain failure");
    expect(of(name, "campaign.ended")).toMatchObject([{ ending: "environment" }]);
  });

  it("holds a pause before an exam is drafted, on the host's default wall", async () => {
    const name = `${STEM}-undrafted`;
    names.push(name);
    const { host, sleeps } = stoppingHost(name, 2);
    let drafts = 0;
    const prompt = [
      "--prompt",
      "Multiplying a base by six, as a fixture.",
      "--solver",
      "claude/claude-opus-5-5",
    ];
    const ended = await harnessBuilder(["--name", name, "--project", PROJECT, ...prompt, "--moves", "2"], {
      seated: answering([], GRADED_SMALL),
      host,
      draft: async () => {
        drafts += 1;
        append(join(REPO, ".ana", "d2", name, LOG_FILE), "campaign.word", { word: "pause" });
        throw new Error(LIMIT);
      },
    });
    expect(ended).toMatchObject({ move: "end", ending: "operator" });
    expect(drafts).toBe(1);
    expect(sleeps).toHaveLength(2);
  });
});

describe("a comparison's packet for a person", () => {
  it("holds every rejection that set a task aside, and three earned rejections and three passes drawn by the comparison's id", () => {
    const named = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) => `${prefix}-${String(index)}`);
    const aside = named("aside", 12);
    const [earned, passed] = [named("earned", 9), named("pass", 9)];
    const packet = packetOf({ aside, others: earned }, passed, "g-1");
    expect(packet.rejections.slice(0, 12)).toEqual(aside);
    expect(packet.rejections.slice(12)).toHaveLength(3);
    expect(packet.rejections.slice(12).every((solve) => earned.includes(solve))).toBe(true);
    expect(packet.passes).toHaveLength(3);
    expect(packet.passes.every((solve) => passed.includes(solve))).toBe(true);
    expect(packetOf({ aside, others: earned.toReversed() }, passed.toReversed(), "g-1")).toEqual(packet);
    expect(packetOf({ aside, others: earned }, passed, "g-2")).not.toEqual(packet);
    expect(packetOf({ aside: [], others: ["e"] }, ["p", "q"], "g-1")).toEqual({
      rejections: ["e"],
      passes: arrayWith(["p", "q"]),
    });
  });
});
