// Behavioural and boundary tests for drafted exams (`src/examiner/draft.ts`), staging and offline
// acceptance (`tools/d2/exam.ts`), and campaign drafting lifecycle (`tools/d1b/draft.ts`).
import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { decide } from "../src/campaign/decide.ts";
import { type Draft, draftFaults, drafting, draftOf } from "../src/examiner/draft.ts";
import { examine, type Session } from "../src/examiner/session.ts";
import { authoredFaults } from "../src/kernel/acceptance.ts";
import { append, read } from "../src/kernel/log.ts";
import { examinerSessions, solvesIn } from "../src/kernel/solves.ts";
import { HOST_TOOLS_FILE, pinnedEngines } from "../src/kernel/verify.ts";
import { TOOL_TREE_DIR } from "../src/meta/bundle-layout.ts";
import { sha256OfFile } from "../src/meta/digest.ts";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "../src/meta/json-runtime.ts";
import { asRecord, type JsonObject, type JsonValue } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { draftCommand } from "../tools/d1b/draft.ts";
import { campaignLog, openCampaign, packNamed } from "../tools/d2/campaign.ts";
import { draftReading, stagedExamOf, stageExam } from "../tools/d2/exam.ts";
import { packControls, readPack, sweepResources } from "../tools/m0/stored-sweep.ts";
import {
  call,
  draftArgs,
  drafted,
  finish,
  invoke,
  NOTE,
  SOUND,
  seat,
  sweep,
  toolOf,
} from "./helpers/examiner-seat.ts";
import { scriptedModel } from "./helpers/fixture-pack.ts";

const FORMAT = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
const OBJECTIVE = { quantity: "mass in kg", direction: "lower" } as const;
const SOLVER = "claude/claude-opus-5-5";
const HIDDEN_BLIND_NOTE =
  "every validity check passed when each example's hidden values were swapped with another's: only the objective read hidden values, so validity checks test public properties alone";
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-draft-")));
const STEM = `test-draft-${String(runtimeProcess.pid)}`;
const campaigns: string[] = [];

const { unmeasured: _reason, ...SILENT } = SOUND;
const withTools = (tools: readonly string[]): Draft => ({
  ...SOUND,
  checks: SOUND.checks.map((check) => ({ ...check, tools })),
});
const MEASURED: Draft = {
  ...SILENT,
  objective: OBJECTIVE,
  evaluator: `${SOUND.evaluator}\nexport const objective = () => 1;`,
};

setDefaultTimeout(120_000);

afterAll(() => {
  sweep();
  rmSync(root, { recursive: true, force: true });
  for (const name of campaigns) rmSync(dirname(campaignLog(name)), { recursive: true, force: true });
});

function opened(
  name: string,
  attended = false,
  reviewer?: { readonly model: string; readonly effort: string },
): string[] {
  campaigns.push(name);
  const log = campaignLog(name);
  mkdirSync(dirname(log), { recursive: true });
  append(log, "campaign.opened", {
    prompt: "A fixture.",
    solver: { model: SOLVER, effort: "high" },
    ...keyIfDefined("seats", reviewer === undefined ? undefined : { reviewer }),
    attended,
  });
  return ["--name", name, "--examiner", SOLVER, "--solver", SOLVER];
}

const putting =
  (...drafts: Draft[]): Session<"draft"> =>
  (request) =>
    examine({
      ...request,
      ...scriptedModel([
        ...drafts.map((draft) => ["draft_exam", draftArgs(draft)] as const),
        ["finish", { note: NOTE }],
      ]),
    });

describe("draft shape and session gate", () => {
  it("enforces evaluator purity, syntax, exports, safe verifier tool names, and single objective decision", () => {
    const allowed: readonly Draft[] = [
      SOUND,
      MEASURED,
      { ...SOUND, evaluator: `${SOUND.evaluator}\nconst t = new Date(0).getTime();` },
      {
        ...SOUND,
        evaluator: `// import x; process.env; fetch("http://x"); Math.random()\nconst note = "import fetch( process.env Date.now()";\n${SOUND.evaluator}`,
      },
      withTools(["bash", "python3"]),
      { ...MEASURED, objectiveTools: ["python3"] },
    ];
    for (const draft of allowed) expect(draftFaults(draft)).toEqual([]);

    const rejected: readonly [Draft, string][] = [
      [{ ...SOUND, evaluator: `import "node:fs";\n${SOUND.evaluator}` }, "import"],
      [{ ...SOUND, evaluator: `${SOUND.evaluator}\nconst r = Math.random();` }, "random number or the clock"],
      [{ ...SOUND, evaluator: `${SOUND.evaluator}\nconst t = Date.now();` }, "random number or the clock"],
      [{ ...SOUND, evaluator: `${SOUND.evaluator}\nconst d = new Date();` }, "random number or the clock"],
      [
        { ...SOUND, evaluator: `${SOUND.evaluator}\nconst p = performance.now();` },
        "random number or the clock",
      ],
      [
        { ...SOUND, evaluator: `${SOUND.evaluator}\nconst id = crypto.randomUUID();` },
        "random number or the clock",
      ],
      [{ ...SOUND, evaluator: `${SOUND.evaluator}\nconst x = eval("1");` }, "dynamic code evaluation"],
      [{ ...SOUND, evaluator: `${SOUND.evaluator}\nconst f = new Function("return 1");` }, "dynamic code"],
      [{ ...SOUND, evaluator: `${SOUND.evaluator}\nconst e = process["env"];` }, "runtime's own objects"],
      [{ ...SOUND, evaluator: `export const checks = { "check-product": (req) => === ;` }, "did not compile"],
      [{ ...SOUND, evaluator: `export const other = {};` }, "does not export `checks`"],
      [{ ...MEASURED, evaluator: SOUND.evaluator }, "does not export `objective`"],
      [SILENT, "objective"],
      [{ ...MEASURED, unmeasured: "every answer is as good" }, "objective"],
      [withTools(["../sh"]), "invalid verifier tool"],
      [{ ...MEASURED, objectiveTools: ["a/b"] }, "invalid verifier tool"],
    ];
    for (const [draft, fact] of rejected) {
      const faults = draftFaults(draft);
      expect(faults).toHaveLength(1);
      expect(faults[0]).toContain(fact);
    }
  });

  it("refuses unnamed fields in accept controls across JSON Schema constructs while leaving reject controls free", () => {
    const settings: JsonObject = { channel: 0, clk_div_q8: 1000 };
    const pwmAs = (pwm: JsonObject): JsonObject => ({
      ...FORMAT,
      properties: { ...FORMAT.properties, pwm: { type: ["object", "null"], ...pwm } },
    });
    const carrying = (answerFormat: JsonValue): Draft => ({
      ...SOUND,
      answerFormat,
      accept: [2, 3, 4].map((base, task) => ({ task, answer: { answer: String(base * 6), pwm: settings } })),
    });
    for (const format of [pwmAs({}), pwmAs({ properties: { channel: { type: "integer" } } })]) {
      const faults = draftFaults(carrying(format));
      expect(faults).toHaveLength(3);
      expect(faults[0]).toContain("$.pwm.clk_div_q8");
      expect(faults[0]).toContain("does not name");
    }
    const both = { channel: { type: "integer" }, clk_div_q8: { type: "integer" } };
    for (const format of [
      pwmAs({ properties: both }),
      pwmAs({ additionalProperties: { type: "integer" } }),
      pwmAs({ anyOf: [{ properties: { duty: {} } }, { properties: { channel: {}, clk_div_q8: {} } }] }),
      pwmAs({ properties: both, anyOf: [{ required: ["channel"] }, { required: ["clk_div_q8"] }] }),
      pwmAs({ dependentSchemas: { channel: { properties: both } } }),
      { ...FORMAT, properties: { ...FORMAT.properties, pwm: { $ref: "#/$defs/pwm" } }, $defs: { pwm: {} } },
    ]) {
      expect(draftFaults(carrying(format))).toEqual([]);
    }
    const reject = [{ task: 0, answer: { answer: "13", pwm: settings }, check: "check-product" }];
    expect(draftFaults({ ...SOUND, answerFormat: pwmAs({}), reject })).toEqual([]);
  });

  it("blocks unshaped drafts before reading, spends no put on schema errors, and handles partial objectives", async () => {
    const lone: Draft = { ...SOUND, accept: SOUND.accept.slice(1), reject: [] };
    const s = seat("draft", [drafted(lone), drafted(SOUND), finish]);
    const reached: Draft[] = [];
    const examined = await examine({
      ...s.request,
      reading: async (draft: Draft) => {
        reached.push(draft);
        return [];
      },
    });
    expect(examined).toMatchObject({ ended: "stands", puts: 2 });
    expect(reached).toEqual([SOUND]);
    const loneFaults = draftFaults(lone);
    expect(loneFaults).toHaveLength(2);
    const told = s.of("draft.call")[0]?.text;
    for (const fault of loneFaults) expect(told).toContain(`- ${fault}`);
    expect(told).toMatch(/3.*drafts/u);
    expect(draftOf(read(s.log))).toEqual(SOUND);

    // Exhausting puts returns the terminal refusal line; a 1-char scope and measured+objectiveTools round-trip cleanly.
    const exhausted = seat("draft", [drafted(lone), finish]);
    await examine({ ...exhausted.request, limits: { ...exhausted.request.limits, puts: 1 } });
    expect(exhausted.of("draft.call")[0]?.text).toContain("This session can put no further draft");
    const withToolsDraft: Draft = { ...MEASURED, scope: "x", objectiveTools: ["python3"] };
    const measuredSeat = seat("draft", [drafted(withToolsDraft), finish]);
    expect(await examine(measuredSeat.request)).toMatchObject({ ended: "stands", puts: 1 });
    expect(draftOf(read(measuredSeat.log))).toEqual(withToolsDraft);

    // Schema-refused drafts spend no put.
    const { objective: _obj, ...unsaid } = draftArgs(SOUND);
    for (const refused of [
      unsaid,
      draftArgs({ ...SOUND, rules: SOUND.rules.map((r) => ({ ...r, source: "  " })) }),
      draftArgs({ ...SOUND, tasks: SOUND.tasks.map((t) => ({ ...t, family: " " })) }),
    ]) {
      const schemaSeat = seat("draft", [call("draft_exam", refused), drafted(SOUND), finish]);
      expect(await examine(schemaSeat.request)).toMatchObject({ ended: "stands", puts: 1 });
      expect(schemaSeat.of("draft.finished")).toMatchObject([{ stands: true, tries: 1 }]);
    }

    // Half-specified objective is treated as no decision (spends a put, rejected by draftFaults).
    for (const objective of [
      { quantity: OBJECTIVE.quantity },
      { quantity: OBJECTIVE.quantity, none: "nothing is left to prefer" },
    ]) {
      const halfSeat = seat("draft", [
        call("draft_exam", { ...draftArgs(SILENT), objective }),
        drafted(SOUND),
        finish,
      ]);
      expect(await examine(halfSeat.request)).toMatchObject({ ended: "stands", puts: 2 });
      expect(halfSeat.of("draft.call")[0]?.text).toContain("objective");
      expect(draftOf(read(halfSeat.log))).toEqual(SOUND);
    }
  });

  it("stands on the first clean put with prompt guidance, from_file support, and log backwards-compatibility", async () => {
    const s = seat("draft", [drafted(SOUND), finish]);
    expect(await examine(s.request)).toMatchObject({ ended: "stands", puts: 1 });
    expect(s.of("draft.call").map(({ text }) => text)).toEqual([
      "The draft stands: it is the campaign's exam. The session ends here.",
    ]);
    expect(solvesIn(read(s.log))).toEqual([]);
    expect(s.of("draft.finished")).toMatchObject([{ ended: "stands", stands: true, tries: 1 }]);
    expect(s.of("draft.finished")[0]).not.toHaveProperty("measurement");
    for (const phrase of [
      "draft_exam validates the whole draft and returns any faults",
      "never search for, fetch, or copy tasks from public benchmarks",
      "penalising wrong or hedged claims",
      "runtime.tools.run",
      "coupled domain invariants",
    ]) {
      expect(s.sent[0]).toContain(phrase);
    }
    expect(s.sent[0]).not.toMatch(/starter harness|is then solved/u);
    expect(s.sent.join("\n")).toMatch(
      /held to 20 turns of the solver's own[^.]*, and 30 minutes, and a comparison solves each task 2 times under each harness\./u,
    );

    // Home `from_file` resolution (inline JSON, JSON-stringified object, raw `.ts` source) vs homeless.
    const home = realpathSync(mkdtempSync(join(tmpdir(), "ana-draft-home-")));
    try {
      writeFileSync(join(home, "evaluator.json"), JSON.stringify(SOUND.evaluator));
      writeFileSync(join(home, "format.json"), JSON.stringify(SOUND.answerFormat));
      writeFileSync(join(home, "evaluator.ts"), SOUND.evaluator);
      const homeSeat = seat("draft", []);
      const mode = drafting({ ...homeSeat.request, reading: async () => [] }, async (act) => act(), home);
      expect(toolOf(mode).description).toContain("from_file");
      expect(JSON.stringify(toolOf(mode).parameters)).toContain('"from_file"');
      const args = {
        ...draftArgs(SOUND),
        evaluator: { from_file: "evaluator.json" },
        answer_format: { from_file: "format.json" },
      };
      await invoke(toolOf(mode), "put", args);
      expect(draftOf(read(homeSeat.log))).toEqual(SOUND);
      expect(
        toolOf(mode).prepareArguments?.({
          ...args,
          evaluator: JSON.stringify({ from_file: "evaluator.json" }),
        }),
      ).toMatchObject({ evaluator: SOUND.evaluator });
      expect(
        toolOf(mode).prepareArguments?.({ ...args, evaluator: { from_file: "evaluator.ts" } }),
      ).toMatchObject({ evaluator: SOUND.evaluator });
      expect(toolOf(drafting(homeSeat.request, async (act) => act())).description).not.toContain("from_file");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }

    // Legacy `exam.drafted` logs without `unmeasured` and `examinerSessions` accounting.
    for (const old of [SILENT, { ...SILENT, objective: OBJECTIVE }]) {
      const log = join(root, `old-${String(old.objective !== undefined)}.jsonl`);
      append(log, "exam.drafted", {
        session: "d-1",
        draft: parseJsonAs<JsonObject>(capturedJsonStringify(old)),
      });
      expect(draftOf(read(log))).toEqual(old);
    }
    const sessionsLog = join(root, "sessions.jsonl");
    for (const [kind, session] of [
      ["draft.started", "d-1"],
      ["exam.started", "x-1"],
      ["build.started", "b-1"],
    ] as const) {
      append(sessionsLog, kind, { session });
    }
    expect(examinerSessions(read(sessionsLog))).toEqual(new Set(["d-1", "x-1"]));
  });
});

describe("staging and offline reading", () => {
  it("stages packs idempotently without leaking hidden controls or unmeasured rationale", () => {
    const staged = stageExam(join(root, "staged"), SOUND);
    expect(stageExam(join(root, "staged"), SOUND)).toEqual(staged);
    expect(staged.bundle).toMatch(/\/exams\/[0-9a-f]{16}\/bundle$/u);
    expect(stagedExamOf(join(root, "staged", "empty.jsonl"))).toBeNull();
    const { brief, tasks } = readPack(staged.bundle);
    expect(tasks.map(({ taskId }) => taskId)).toEqual(["ex-001", "ex-002", "ex-003"]);
    expect(brief.ruleDecisions).toMatchObject([
      { id: "R1", source: SOUND.rules[0]?.source, visibility: "public" },
    ]);
    expect(packControls(staged.bundle)).toHaveLength(4);
    const resources = new Map(sweepResources(brief).map(({ name, content }) => [name, content]));
    expect(resources.get("public-scope")).toEqual([
      { domain: SOUND.domain, scope: SOUND.scope, conventions: SOUND.conventions },
    ]);
    expect(resources.get("public-rule-decisions")).toEqual([{ ...SOUND.rules[0], visibility: "public" }]);
    expect(readFileSync(join(staged.checks, "evaluator.ts"), "utf8")).toBe(SOUND.evaluator);
    expect(() => readFileSync(join(staged.checks, "controls.json"), "utf8")).toThrow();

    // `unmeasured` text must never appear in any staged file; declared objective is staged.
    const modelFiles = (draft: Draft) =>
      ["brief.json", "tasks.json", "controls.json", "evaluator.ts"].map((file) =>
        readFileSync(
          join(stageExam(join(root, "unmeasured"), draft).bundle, "correctness-model", file),
          "utf8",
        ),
      );
    expect(modelFiles(SOUND)).toEqual(modelFiles({ ...SOUND, unmeasured: "another reason" }));
    expect(readPack(stageExam(join(root, "unmeasured"), MEASURED).bundle).brief.objective).toEqual(OBJECTIVE);
  });

  it("reads sound, lax, form-only, unloadable, and missing-export evaluators accurately", async () => {
    expect((await draftReading(join(root, "read"), SOUND, 2)).faults).toEqual([]);
    expect((await draftReading(join(root, "read"), MEASURED, 2)).faults).toEqual([]);

    const lax = { ...SOUND, evaluator: `export const checks = { "check-product": () => true };\n` };
    const laxFaults = (await draftReading(join(root, "read"), lax, 2)).faults;
    expect(laxFaults).toHaveLength(8);
    for (const [index, facts] of [
      ["ex-001", "check-product", "reject control", "pass"],
      ["check-product", "refused nothing"],
      ...["ex-001", "ex-002", "ex-003"].map((id) => [id, "do-nothing", "pass"]),
      ...["ex-001", "ex-002", "ex-003"].map((id) => [id, "passed every other example"]),
    ].entries()) {
      for (const fact of facts) expect(laxFaults[index]).toContain(fact);
    }

    const formOnly = {
      ...SOUND,
      evaluator: `export const checks = { "check-product": (req) => /^[0-9]+$/u.test(req.artifact.answer) };\n`,
      reject: [{ task: 0, answer: { answer: "x" }, check: "check-product" }],
    };
    const formFaults = (await draftReading(join(root, "read"), formOnly, 2)).faults;
    expect(formFaults).toHaveLength(3);
    for (const fault of formFaults) expect(fault).toContain("passed every other example");

    const broken = {
      ...SOUND,
      evaluator: `export const checks = { "check-product": (req) => req.artifact.answer === ;\n`,
    };
    const [syntaxFault, ...rest] = (await draftReading(join(root, "read"), broken, 2)).faults;
    expect(rest).toEqual([]);
    for (const fact of ["ex-00", "check-product", "did not load", "Unexpected ;"]) {
      expect(syntaxFault).toContain(fact);
    }

    expect(
      (await draftReading(join(root, "read"), { ...MEASURED, evaluator: SOUND.evaluator }, 2)).faults.some(
        (f) => f.includes("objective"),
      ),
    ).toBe(true);
    const undefinedCheck = (
      await draftReading(
        join(root, "read"),
        { ...SOUND, evaluator: SOUND.evaluator.replace("check-product", "check-other") },
        2,
      )
    ).faults;
    expect(undefinedCheck.some((f) => f.includes("check-product"))).toBe(true);
  });

  it("verifies deliverable files, archive entries, hidden-value sensitivity, and factual notes", async () => {
    // Plain deliverable file and archive member checks pass with files and fail without.
    const report: Draft = {
      ...SOUND,
      evaluator: `export const checks = {\n  "check-product": (req) => req.artifact.answer === String(req.publicTask.publicInput.base * 6) && req.files.some((f) => f.path === "report.md" && f.text === "six times"),\n};\n`,
      accept: SOUND.accept.map((c) => ({ ...c, files: [{ path: "report.md", text: "six times" }] })),
    };
    expect((await draftReading(join(root, "read"), report, 2)).faults).toEqual([]);
    expect(
      (await draftReading(join(root, "read"), { ...report, accept: SOUND.accept }, 2)).faults.join("\n"),
    ).toContain("accept control");

    const book: Draft = {
      ...SOUND,
      evaluator: `export const checks = {\n  "check-product": (req) => req.artifact.answer === String(req.publicTask.publicInput.base * 6) && req.files.some((f) => f.path === "book.xlsx" && f.base64 !== "" && (f.entries ?? []).some((e) => e.text === "<v>6</v>")),\n};\n`,
      accept: SOUND.accept.map((c) => ({
        ...c,
        files: [{ path: "book.xlsx", entries: [{ path: "xl/worksheets/sheet1.xml", text: "<v>6</v>" }] }],
      })),
    };
    expect((await draftReading(join(root, "read"), book, 2)).faults).toEqual([]);
    const flatBook: Draft = {
      ...book,
      accept: SOUND.accept.map((c) => ({ ...c, files: [{ path: "book.xlsx", text: "<v>6</v>" }] })),
    };
    expect((await draftReading(join(root, "read"), flatBook, 2)).faults.join("\n")).toContain(
      "accept control",
    );

    // Hidden values: unread fails, check-deciding passes silently, objective-only (including key throw) emits factual note.
    const unread = { ...SOUND, tasks: SOUND.tasks.map((t, seed) => ({ ...t, hidden: { seed } })) };
    expect((await draftReading(join(root, "read"), unread, 2)).faults).toEqual([
      expect.stringContaining("hidden values had no effect on any accept control"),
    ]);

    const factors = [5, 6, 7] as const;
    const hiddenDecided: Draft = {
      ...SOUND,
      evaluator: `export const checks = {\n  "check-product": (req) => req.artifact.answer === String(req.publicTask.publicInput.base * req.hidden.factor),\n};\n`,
      tasks: SOUND.tasks.map((t, i) => ({ ...t, hidden: { factor: factors[i] ?? 0 } })),
      accept: SOUND.tasks.map((t, i) => ({
        task: i,
        answer: { answer: String(Number(asRecord(t.publicInput)?.base) * Number(factors[i])) },
      })),
    };
    const decidedRead = await draftReading(join(root, "read"), hiddenDecided, 2);
    expect(decidedRead.faults).toEqual([]);
    expect(decidedRead.read?.reading.notes).toEqual([]);

    const keyChecked: Draft = {
      ...MEASURED,
      objective: { quantity: "score", direction: "lower" },
      tasks: SOUND.tasks.map((t, i) => ({ ...t, hidden: { [`k${String(i)}`]: i + 1 } })),
      evaluator: [
        'export const checks = { "check-product": (req) => req.artifact.answer === String(req.publicTask.publicInput.base * 6) };',
        "export function objective(req) {",
        "  const v = req.hidden[`k${String(req.publicTask.publicInput.base - 2)}`];",
        '  if (typeof v !== "number") throw new Error("missing hidden key");',
        "  return v;",
        "}",
      ].join("\n"),
    };
    const noteRead = await draftReading(join(root, "hidden-note"), keyChecked, 2);
    expect(noteRead.faults).toEqual([]);
    expect(noteRead.read?.reading.notes).toEqual([HIDDEN_BLIND_NOTE]);

    // Partial cross-example pass emits a factual note without faulting.
    const partial: Draft = {
      ...SOUND,
      evaluator: `export const checks = { "check-product": (req) => req.artifact.answer === String(req.publicTask.publicInput.base * 6) || (req.publicTask.publicInput.base === 3 && req.artifact.answer === "12") };\n`,
    };
    const partialRead = await draftReading(join(root, "partial-note"), partial, 2);
    expect(partialRead.faults).toEqual([]);
    expect(partialRead.read?.reading.notes).toEqual([
      "the accept control of ex-001 also passed 1 of 2 other examples",
    ]);
  });

  it("dispatches declared host tools via host-tools.json manifest, keeps drafted checks author-decided, pins real binaries, and refuses missing/undeclared tools", async () => {
    const hostEngined: Draft = {
      ...MEASURED,
      checks: [{ id: "check-product", rule: "R1", assertion: "via bash wrapping python3", tools: ["bash"] }],
      objective: { quantity: "error", direction: "lower" },
      objectiveTools: ["python3"],
      tasks: SOUND.tasks.map((t, i) => ({ ...t, hidden: { target: (i + 2) * 5 } })),
      evaluator: [
        "export const checks = {",
        '  "check-product": async (req, runtime) => {',
        "    const res = await runtime.tools.run({",
        '      toolId: "bash",',
        String.raw`      args: ["-c", "python3 -c 'import json, sys; d = json.load(sys.stdin); a = d[\"artifact\"][\"answer\"]; print(a.isdigit() and int(a) == d[\"publicTask\"][\"publicInput\"][\"base\"] * 6)'"],`,
        "      stdin: JSON.stringify(req),",
        "    });",
        '    return res.exitCode === 0 && res.stdout.trim() === "True";',
        "  },",
        "};",
        "export async function objective(req, runtime) {",
        "  const res = await runtime.tools.run({",
        '    toolId: "python3",',
        "    args: [\"-c\", \"import json, sys; d = json.load(sys.stdin); print(abs(int(d['artifact']['answer']) - d['hidden']['target']))\"],",
        "    stdin: JSON.stringify(req),",
        "  });",
        "  return Number(res.stdout.trim());",
        "}",
      ].join("\n"),
    };
    const dir = join(root, "engines");
    const ok = await draftReading(dir, hostEngined, 2);
    expect(ok.faults).toEqual([]);
    const checks = ok.read?.reading.checks ?? [];
    expect(checks.map(({ id, instrument, missing }) => ({ id, instrument, missing }))).toEqual([
      { id: "check-product", instrument: "author", missing: [] },
      { id: "objective", instrument: "author", missing: [] },
    ]);
    // Host-forwarded tools in a drafted exam never bypass Rule 10 / `--hitl` admission.
    expect(authoredFaults(checks, new Set())).toHaveLength(2);
    expect(ok.read?.reading.notes).toEqual([HIDDEN_BLIND_NOTE]);
    const staged = stageExam(dir, hostEngined);
    // No shell wrappers are generated in `.toolchain/bin/`; provenance lives in `host-tools.json`.
    expect(existsSync(join(staged.bundle, TOOL_TREE_DIR, "bin", "bash"))).toBe(false);
    expect(existsSync(join(staged.bundle, TOOL_TREE_DIR, "bin", "python3"))).toBe(false);
    expect(
      parseJsonAs<{ origin: string; tools: string[] }>(
        readFileSync(join(staged.bundle, TOOL_TREE_DIR, HOST_TOOLS_FILE), "utf8"),
      ),
    ).toEqual({
      origin: "draft",
      tools: ["bash", "python3"],
    });
    const pinned = pinnedEngines({ checks: staged.checks, tools: join(staged.bundle, TOOL_TREE_DIR) });
    expect(pinned.map((e) => e.name)).toEqual(["bash", "python3"]);
    for (const engine of pinned) {
      expect(engine.path).not.toContain(TOOL_TREE_DIR);
      expect(engine.sha256).toBe(sha256OfFile(realpathSync(engine.path)));
    }

    // Even a non-shell host executable (`git`) stays `author` when forwarded via `host-tools.json`,
    // whereas a binary physically installed inside `.toolchain/bin/` hashes its target and updates cleanly.
    const hostGit: Draft = {
      ...SOUND,
      checks: [{ id: "check-product", rule: "R1", assertion: "via host git", tools: ["git"] }],
      evaluator: [
        "export const checks = {",
        '  "check-product": async (req, runtime) => {',
        '    const got = await runtime.tools.run({ toolId: "git", args: ["hash-object", "--stdin"], stdin: String(req.artifact.answer) });',
        '    const want = await runtime.tools.run({ toolId: "git", args: ["hash-object", "--stdin"], stdin: String(req.publicTask.publicInput.base * 6) });',
        "    return got.exitCode === 0 && want.exitCode === 0 && got.stdout === want.stdout;",
        "  },",
        "};",
      ].join("\n"),
    };
    const extDir = join(root, "external-engine");
    const extOk = await draftReading(extDir, hostGit, 2);
    expect(extOk.faults).toEqual([]);
    expect(extOk.read?.reading.checks).toMatchObject([
      { id: "check-product", instrument: "author", missing: [] },
    ]);
    expect(authoredFaults(extOk.read?.reading.checks ?? [], new Set())).toHaveLength(1);

    // Updating the binary behind a pack-installed tool symlink changes its pinned sha256.
    const customTools = join(root, "custom-tools");
    const realBin = join(root, "real-engine.sh");
    mkdirSync(join(customTools, "bin"), { recursive: true });
    writeFileSync(realBin, "#!/bin/sh\necho v1\n");
    chmodSync(realBin, 0o755);
    symlinkSync(realBin, join(customTools, "bin", "git"));
    const extStaged = stageExam(extDir, hostGit);
    const before = pinnedEngines({ checks: extStaged.checks, tools: customTools }).find(
      (e) => e.name === "git",
    );
    writeFileSync(realBin, "#!/bin/sh\necho v2\n");
    const after = pinnedEngines({ checks: extStaged.checks, tools: customTools }).find(
      (e) => e.name === "git",
    );
    expect(before?.sha256).toBeDefined();
    expect(after?.sha256).not.toBe(before?.sha256);

    // Examiner-installed `.toolchain/` executables (and sibling files) freeze into the offline verifier cell
    // ahead of host PATH, stay `author` under Rule 10 (`origin: "draft"`), refresh on retries, and run
    // offline after `home` is deleted.
    const home = realpathSync(mkdtempSync(join(tmpdir(), "ana-draft-toolchain-")));
    const customDir = join(root, "custom-toolchain");
    const binDir = join(home, TOOL_TREE_DIR, "bin");
    const libDir = join(home, TOOL_TREE_DIR, "lib");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, "factor.txt"), "5\n");
    const engineBin = join(binDir, "scale-engine");
    writeFileSync(
      engineBin,
      [
        "#!/bin/sh",
        'dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"',
        'factor="$(cat "$dir/lib/factor.txt")"',
        'read -r base ans; [ "$ans" = "$((base * factor))" ] && echo OK || echo BAD',
        "",
      ].join("\n"),
    );
    chmodSync(engineBin, 0o755);
    const customDraft: Draft = {
      ...SOUND,
      checks: [{ id: "check-product", rule: "R1", assertion: "via scale-engine", tools: ["scale-engine"] }],
      evaluator: [
        "export const checks = {",
        '  "check-product": async (req, rt) => {',
        '    const res = await rt.tools.run({ toolId: "scale-engine", stdin: `${req.publicTask.publicInput.base} ${req.artifact.answer}\\n` });',
        '    return res.exitCode === 0 && res.stdout.trim() === "OK";',
        "  },",
        "};",
      ].join("\n"),
    };
    expect((await draftReading(customDir, customDraft, 2, home)).faults.length).toBeGreaterThan(0);
    // Fixing `.toolchain/lib/factor.txt` in `home` refreshes the staged toolchain even on identical draft JSON.
    writeFileSync(join(libDir, "factor.txt"), "6\n");
    const customOk = await draftReading(customDir, customDraft, 2, home);
    expect(customOk.faults).toEqual([]);
    // Rule 10: Examiner-installed tools cannot bypass operator admission (`authoredFaults` stays 1).
    expect(authoredFaults(customOk.read?.reading.checks ?? [], new Set())).toHaveLength(1);
    rmSync(home, { recursive: true, force: true });
    // After `home` is gone, the frozen staged bundle still runs offline and pins the installed executable directly.
    const frozen = stageExam(customDir, customDraft);
    expect(
      parseJsonAs<{ origin: string; tools: string[] }>(
        readFileSync(join(frozen.bundle, ".toolchain", HOST_TOOLS_FILE), "utf8"),
      ),
    ).toEqual({ origin: "draft", tools: [] });
    const customPinned = pinnedEngines({ checks: frozen.checks, tools: join(frozen.bundle, ".toolchain") });
    expect(customPinned).toHaveLength(1);
    expect(customPinned[0]?.name).toBe("scale-engine");
    expect(customPinned[0]?.external).toBe(false);
    expect(customPinned[0]?.sha256).toBe(sha256OfFile(customPinned[0]?.path ?? ""));
    expect((await draftReading(customDir, customDraft, 2)).faults).toEqual([]);

    // Hostile `.toolchain/` shapes: broken symlink, symlinked `.toolchain`, and script naming `home` all fail cleanly.
    const badHome = realpathSync(mkdtempSync(join(tmpdir(), "ana-draft-bad-toolchain-")));
    mkdirSync(join(badHome, ".toolchain", "bin"), { recursive: true });
    symlinkSync("/no/such/target", join(badHome, ".toolchain", "bin", "scale-engine"));
    expect(() => stageExam(join(root, "broken-link"), customDraft, badHome)).toThrow("broken symlink");
    rmSync(join(badHome, ".toolchain", "bin", "scale-engine"));
    const namedScript = join(badHome, ".toolchain", "bin", "scale-engine");
    writeFileSync(namedScript, `#!/bin/sh\ncat "${badHome}/x"\n`);
    chmodSync(namedScript, 0o755);
    expect(() => stageExam(join(root, "named-home"), customDraft, badHome)).toThrow("name your home");
    rmSync(join(badHome, ".toolchain"), { recursive: true, force: true });
    symlinkSync(root, join(badHome, ".toolchain"));
    expect(() => stageExam(join(root, "symlink-tree"), customDraft, badHome)).toThrow("must be a directory");
    rmSync(badHome, { recursive: true, force: true });

    // Static evaluator scanner: regexes with quotes, strings inside `${...}`, and nested templates do not false-positive,
    // while regex/template desyncs, bare Date()/Function(), indirect eval, process destructuring/optional chaining, and import() are caught.
    for (const clean of [
      `export const checks = { "check-product": (r) => /["']/.test("fetch()") || /\\/\\//.test(String(r.artifact.answer)) };\n`,
      'export const checks = { "check-product": (r) => `${r.artifact.answer || "Date.now()"}`.length > 0 };\n',
      'export const checks = { "check-product": () => `outer ${`inner Math.random()`}`.length > 0 };\n',
    ]) {
      expect(draftFaults({ ...SOUND, evaluator: clean })).toEqual([]);
    }
    for (const bypass of [
      `export const checks = { "check-product": () => { const a = /'/; return Math.random() > 0 && "'".length > 0; } };\n`,
      'export const checks = { "check-product": () => { const s = `${`}`}`; return Math.random() > 0; } };\n',
      'export const checks = { "check-product": (r) => `${r.artifact.answer === "}" && Math.random()}`.length > 0 };\n',
      `export const checks = { "check-product": () => Date().length > 0 };\n`,
      `export const checks = { "check-product": () => new Date(...[]).getTime() > 0 };\n`,
      `export const checks = { "check-product": () => Function("return true")() };\n`,
      `export const checks = { "check-product": () => (0, eval)("true") };\n`,
      `export const checks = { "check-product": () => Boolean(process?.env) };\n`,
      `export const checks = { "check-product": () => { const { env } = process; return Boolean(env); } };\n`,
      `export const checks = { "check-product": async () => Boolean(await import("node:fs")) };\n`,
    ]) {
      expect(draftFaults({ ...SOUND, evaluator: bypass }).length, bypass).toBeGreaterThan(0);
    }

    // Undeclared tool invocation and missing host binary both fail cleanly.
    const undeclared = await draftReading(
      join(root, "undeclared"),
      {
        ...SOUND,
        evaluator: `export const checks = { "check-product": async (_req, rt) => (await rt.tools.run({ toolId: "sh", args: ["-c", "true"] })).exitCode === 0 };\n`,
      },
      2,
    );
    expect(undeclared.faults.join("\n")).toContain("which it does not declare");
    const missing = await draftReading(join(root, "missing"), withTools(["no-such-engine-xyz"]), 2);
    expect(missing.faults.join("\n")).toContain(
      "no-such-engine-xyz, which is not on the verifier's tool path",
    );
  });
});

describe("campaign draft lifecycle", () => {
  it("ends the campaign after three failed drafts across two sessions", async () => {
    await expect(draftCommand([])).rejects.toThrow("name --name, --session and --examiner");
    const name = `${STEM}-spent`;
    const flags = opened(name);
    const unformed: Draft = { ...SOUND, answerFormat: { type: "string" } };
    await draftCommand([...flags, "--session", "d-1"], putting(unformed));
    await draftCommand([...flags, "--session", "d-2"], putting(unformed, unformed));
    const events = read(campaignLog(name));
    expect(draftOf(events)).toBeNull();
    const decided = decide(events, {
      patience: 3,
      unprepared: false,
      practice: null,
      wanted: { target: 12, level: 0.02, solves: 2 },
      pastStop: null,
      prompted: true,
      admits: [],
      left: null,
      promotions: null,
    });
    expect(decided).toMatchObject({ move: "end", ending: "exam" });
    expect(decided.why).toContain("3 drafts in 2 sessions did not stand");
  });

  it("freezes unattended drafts matching openCampaign and holds --hitl drafts for operator admission", async () => {
    for (const attended of [false, true]) {
      const name = `${STEM}-kept-${String(attended)}`;
      await draftCommand([...opened(name, attended), "--session", "d-1"], putting(SOUND));
      const events = read(campaignLog(name));
      const readings = events.filter(({ kind }) => kind === "checker.read");
      expect(readings).toHaveLength(1);
      expect(readings[0]?.data).toMatchObject({ admitted: attended ? [] : ["check-product"] });
      expect(readings[0]?.data.faults).toEqual(
        attended ? [expect.stringContaining("--admit check-product")] : [],
      );
      const frozen = events.filter(({ kind }) => kind === "contract.frozen");
      expect(frozen).toHaveLength(attended ? 0 : 1);
      const { checker } = await openCampaign(packNamed({ name }));
      expect(readings[0]?.data).toMatchObject({ ...checker });
      if (!attended) expect(frozen[0]?.data).toMatchObject({ ...checker });
    }
  });

  it("audits up to two passes using reviewer.effort, stops early on sound/skipped, and skips when no reviewer is configured", async () => {
    const defectName = `${STEM}-audit-defect`;
    const seenPasses: {
      effort: string;
      pass: number | undefined;
      prior: readonly string[] | undefined;
    }[] = [];
    await draftCommand(
      [
        ...opened(defectName, false, { model: SOLVER, effort: "low" }),
        "--session",
        "d-1",
        "--examiner-effort",
        "high",
      ],
      putting(SOUND, SOUND, SOUND),
      async (reader, target) => {
        seenPasses.push({ effort: reader.effort, pass: target.pass, prior: target.priorFindings });
        return {
          verdict: "defects",
          findings: [{ kind: "vacuous-pass", task: "ex-001", probe: 1, reason: "wrong value passed" }],
          summary: "vacuous check",
          probes: [],
        };
      },
    );
    expect(seenPasses).toHaveLength(2);
    expect(seenPasses[0]).toEqual({ effort: "low", pass: 1, prior: [] });
    expect(seenPasses[1]?.effort).toBe("low");
    expect(seenPasses[1]?.pass).toBe(2);
    expect(seenPasses[1]?.prior?.[0]).toContain("vacuous-pass on ex-001");
    expect(draftOf(read(campaignLog(defectName)))).toEqual(SOUND);

    for (const verdict of ["sound", "skipped"] as const) {
      const name = `${STEM}-audit-${verdict}`;
      let calls = 0;
      await draftCommand(
        [...opened(name, false, { model: SOLVER, effort: "medium" }), "--session", "d-1"],
        putting(SOUND),
        async () => {
          calls += 1;
          return { verdict, findings: [], summary: verdict, probes: [] };
        },
      );
      expect(calls).toBe(1);
      expect(draftOf(read(campaignLog(name)))).toEqual(SOUND);
    }

    const noReviewer = `${STEM}-audit-none`;
    let skippedCalls = 0;
    await draftCommand([...opened(noReviewer), "--session", "d-1"], putting(SOUND), async () => {
      skippedCalls += 1;
      return { verdict: "sound", findings: [], summary: "unused", probes: [] };
    });
    expect(skippedCalls).toBe(0);
  });
});
