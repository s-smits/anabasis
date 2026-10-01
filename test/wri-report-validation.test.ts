/**
 * What `validate-reports.ts` binds and what it rejects. A report is joined to its task by name,
 * to its launch by prompt digest, and to its assigned lanes by heading; under each lane heading it
 * owes the four report sections, and every finding names one owner from the closed set.
 */
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join, resolve } from "../src/meta/path.ts";
import { spawnTextSync } from "./helpers/bun-spawn-sync.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import {
  ANGLE_COUNT,
  FIX_AUTHORITY,
  ISOLATED_ANGLES,
  leafPrompt,
} from "../.claude/skills/whole-run-investigation/scripts/catalogue-shape.ts";
import {
  FINDING_OWNERS,
  REPORT_SECTIONS,
} from "../.claude/skills/whole-run-investigation/scripts/manifest-reporting.ts";
import { afterAll, describe, expect, it } from "bun:test";

const root = resolve(import.meta.dirname, "..");
const script = join(root, ".claude/skills/whole-run-investigation/scripts/validate-reports.ts");
const launcher = join(root, ".claude/skills/codex-luna-swarm/scripts/luna-sessions.ts");

const LANE = "lane_05";
const TRUTH = "lane_30";
const TRIGGER = "Starts from block 1's product validity chain.";

/** One lane section with every owed subsection, either with no finding or with the given ones. */
function laneReport(heading: string, findings = "none"): string {
  return [
    `## ${heading}`,
    "",
    "### Started from",
    `startsFrom: lane 05: ${TRIGGER}`,
    "",
    "### Evidence read",
    "- /campaigns/demo/runs/run-1/claim.json",
    "",
    "### Findings",
    findings,
    "",
    "### Not established",
    "Whether the second variant repeats the failure.",
    "",
  ].join("\n");
}

function admission(name: string, lanes: number[], mode = "targeted") {
  return {
    schema: "wri-progressive-admission/v2",
    mode,
    state: "active",
    identityKey: name,
    lanes,
    triggers: lanes.map(() => TRIGGER),
  };
}

/** The ground-truth hardware task, which may write only its own scratch under the review. */
function hardwareTask(dir: string) {
  return {
    name: TRUTH,
    task: `assignedSession: ${TRUTH}\nassignedLanes: 30\n\nRun the ground truth.`,
    admission: admission(TRUTH, [30]),
    scratch: join(dir, "hw-scratch", TRUTH),
  };
}

function fixture({ launch = true } = {}) {
  const dir = scratchDir("ana-wri-reports-");
  const output = join(dir, "output");
  mkdirSync(output);
  const tasks = join(dir, "tasks.json");
  const summary = join(output, "summary.json");
  const report = join(output, "lane_05.md");
  writeFileSync(
    tasks,
    JSON.stringify([
      {
        name: LANE,
        task: "assignedSession: lane_05\nassignedLanes: 05\n\nReview the oracle.",
        admission: admission(LANE, [5]),
      },
    ]),
  );
  writeFileSync(report, laneReport(LANE));
  writeFileSync(
    summary,
    JSON.stringify({
      schemaVersion: 1,
      type: "luna_sessions.completed",
      outputDir: output,
      sessions: [{ name: LANE, status: "completed", exitCode: 0, reportPath: report }],
    }),
  );
  if (launch) writeLaunch({ dir, output, tasks, summary });
  return { dir, output, tasks, summary, report, result: join(output, "wri-report-validation.json") };
}

/** The launch record of the summary's kind, naming every task in tasks.json, without the input
 *  that binds prompt digests. */
function writeLaunch(f: { dir: string; output: string; tasks: string; summary: string }) {
  const { dir, output, tasks, summary } = f;
  const rows: { name: string }[] = JSON.parse(readFileSync(tasks, "utf8"));
  const kind: string = JSON.parse(readFileSync(summary, "utf8")).type;
  const sessions = rows.map(({ name }) => ({
    name,
    workdir: dir,
    sandbox: "read-only",
    ownedPaths: [],
    promptSha256: "0".repeat(64),
  }));
  writeFileSync(
    join(output, "launch.json"),
    JSON.stringify({ type: kind.replace(/\.completed$/u, ".launch"), outputDir: output, sessions }),
  );
}

function run(tasks: string, summary: string) {
  return spawnTextSync(Bun.argv[0]!, [script, "--tasks", tasks, "--summary", summary]);
}

/** One lane of a native review: the prompt the manifest composes for a Claude subagent, byte for
 *  byte as `--transport native` writes it beside tasks.json, and the report the primary saved from
 *  that subagent under `native-output/`. */
function nativeLane(f: { dir: string; tasks: string }, name: string): string {
  const instructions = "shared instructions";
  writeFileSync(join(f.dir, "instructions.md"), `${instructions}\n`);
  const task: string = JSON.parse(readFileSync(f.tasks, "utf8")).find(
    (row: { name: string }) => row.name === name,
  ).task;
  mkdirSync(join(f.dir, "prompts"), { recursive: true });
  writeFileSync(
    join(f.dir, "prompts", `${name}.md`),
    `${instructions}\n\n---\n\n# Your assignment\n\n${task}\n\n${FIX_AUTHORITY}\n`,
  );
  mkdirSync(join(f.dir, "native-output"), { recursive: true });
  const report = join(f.dir, "native-output", `${name}.md`);
  writeFileSync(report, laneReport(name));
  return report;
}

/** Add one open-lane task to the fixture's manifest, after the tasks it already holds. */
function addTask(f: { tasks: string }, lane: number): string {
  const name = `lane_${String(lane).padStart(2, "0")}`;
  const tasks = JSON.parse(readFileSync(f.tasks, "utf8"));
  tasks.push({
    name,
    task: `assignedSession: ${name}\nassignedLanes: ${name.slice(5)}\n\nReview the next question.`,
    admission: admission(name, [lane]),
  });
  writeFileSync(f.tasks, JSON.stringify(tasks));
  return name;
}

function receiptOf(f: { result: string }) {
  return JSON.parse(readFileSync(f.result, "utf8"));
}

/** The refusal a finding owner outside the closed set earns. */
function unlistedOwner(owner: string): string {
  return `## ${LANE}: finding owner \`${owner}\` is not one of ${FINDING_OWNERS.join(", ")}`;
}

/** Rewrite the fixture's summary so one report stands under the given session name. */
function renameSession(f: ReturnType<typeof fixture>, name: string, report = f.report) {
  writeFileSync(
    f.summary,
    JSON.stringify({
      schemaVersion: 1,
      type: "luna_sessions.completed",
      outputDir: f.output,
      sessions: [{ name, status: "completed", exitCode: 0, reportPath: report }],
    }),
  );
}

afterAll(cleanupScratch);

describe("WRI report validation", () => {
  it("binds one completed report to its task and assigned heading", () => {
    const f = fixture();
    const result = run(f.tasks, f.summary);
    const receipt = receiptOf(f);

    expect(result.status).toBe(0);
    expect(receipt.schema).toBe("wri-report-validation/v3");
    expect(receipt.complete).toBe(true);
    expect(receipt.rows[0].assignedLanes).toEqual(["05"]);
    expect(receipt.rows[0].reportedLanes).toEqual(["05"]);
    expect(receipt.rows[0].reportSha256).toHaveLength(64);
    expect(receipt.launchBinding.state).toBe("incomplete");
    expect(receipt.launchBinding.promptDigestsBound).toBe(false);
    // The accepted report carries exactly the sections the manifest instructs, so a renamed section
    // is a change to both the instruction and this fixture.
    for (const section of REPORT_SECTIONS) {
      expect(readFileSync(f.report, "utf8")).toContain(`### ${section}\n`);
    }
  });

  it("refuses a report whose launch record is absent", () => {
    const f = fixture({ launch: false });
    const result = run(f.tasks, f.summary);
    const receipt = receiptOf(f);

    expect(result.status).toBe(1);
    expect(receipt.complete).toBe(false);
    expect(receipt.launchBinding).toEqual({
      state: "invalid",
      issues: ["launch.json is absent, so the reports' prompt identity cannot be bound"],
      promptDigestsBound: false,
    });
  });

  // Four of five reviews on 2026-10-01 read launchBinding invalid for one cause: the launcher runs a
  // hardware lane inside its own scratch, and the validator projected every task to {name, task}
  // under the one launch workdir.
  it("binds a current Luna collection with a hardware lane in its own scratch, and refuses the retired luna_lanes record names", () => {
    const f = fixture();
    const instructions = join(f.dir, "instructions.md");
    writeFileSync(instructions, "shared instructions\n");
    const hardware = hardwareTask(f.dir);
    const { scratch } = hardware;
    mkdirSync(scratch, { recursive: true });
    const open = JSON.parse(readFileSync(f.tasks, "utf8"))[0];
    writeFileSync(f.tasks, JSON.stringify([open, hardware]));
    const taskBytes = readFileSync(f.tasks);
    const instructionBytes = readFileSync(instructions);
    const hash = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const workdir = realpathSync(f.dir);
    const launcherTasks = join(f.dir, "luna-tasks.json");
    writeFileSync(
      launcherTasks,
      JSON.stringify([
        { name: LANE, task: open.task },
        {
          name: hardware.name,
          task: hardware.task,
          workdir: scratch,
          sandbox: "workspace-write",
          ownedPaths: [scratch],
        },
      ]),
    );
    for (const name of [LANE, TRUTH]) writeFileSync(join(f.dir, `report-${name}.md`), laneReport(name));
    const fakeCodex = join(f.dir, "fake-codex");
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env bun
const args = Bun.argv.slice(2);
const out = args[args.indexOf("--output-last-message") + 1];
await Bun.write(out, Bun.file(${JSON.stringify(`${f.dir}/report-`)} + out.split("/").pop()));
console.log(JSON.stringify({ type: "thread.started", thread_id: "thread_test_123" }));
`,
      { mode: 0o700 },
    );
    rmSync(f.output, { recursive: true });
    // The launch manifest-compose dispatches: the launcher tasks file, the instructions file and the
    // measured worktree.
    expect(
      spawnTextSync(Bun.argv[0]!, [
        launcher,
        "--tasks-file",
        launcherTasks,
        "--instructions-file",
        instructions,
        "--workdir",
        workdir,
        "--codex-bin",
        fakeCodex,
        "--output-dir",
        f.output,
        "--reasoning-effort",
        "max",
      ]).status,
    ).toBe(0);
    writeFileSync(
      join(f.output, "wri-launch-input.json"),
      JSON.stringify({
        schema: "wri-luna-launch-input/v1",
        outputDir: f.output,
        workdir,
        tasksPath: f.tasks,
        launcherTasksPath: launcherTasks,
        tasksSha256: hash(taskBytes),
        launcherTasksSha256: hash(readFileSync(launcherTasks)),
        instructionsPath: instructions,
        instructionsSha256: hash(instructionBytes),
        tasks: [open, hardware].map((row) => ({
          name: row.name,
          taskSha256: hash(new TextEncoder().encode(row.task)),
          admissionSha256: hash(new TextEncoder().encode(JSON.stringify(row.admission))),
          promptSha256: hash(
            new TextEncoder().encode(leafPrompt("shared instructions", row.task, row.scratch ?? null)),
          ),
        })),
      }),
    );
    const result = run(f.tasks, f.summary);
    const receipt = receiptOf(f);
    expect(receipt.launchBinding.issues).toEqual([]);
    expect(result.status).toBe(0);
    expect(receipt.complete).toBe(true);
    expect(receipt.launchBinding.state).toBe("bound");
    expect(receipt.launchBinding.promptDigestsBound).toBe(true);
    expect(receipt.launchBinding.tasksSha256).toBe(hash(taskBytes));

    const launchPath = join(f.output, "launch.json");
    // The input is read from the sidecar alone: the same bytes inside launch.json bind nothing.
    const sidecar = join(f.output, "wri-launch-input.json");
    const launchBytes = readFileSync(launchPath);
    const sidecarBytes = readFileSync(sidecar);
    const embedded = {
      ...JSON.parse(launchBytes.toString("utf8")),
      input: JSON.parse(sidecarBytes.toString("utf8")),
    };
    writeFileSync(launchPath, JSON.stringify(embedded));
    rmSync(sidecar);
    run(f.tasks, f.summary);
    expect(receiptOf(f).launchBinding.promptDigestsBound).toBe(false);
    writeFileSync(launchPath, launchBytes);
    writeFileSync(sidecar, sidecarBytes);

    const launch = JSON.parse(readFileSync(launchPath, "utf8"));
    const summary = JSON.parse(readFileSync(f.summary, "utf8"));
    // A record type no launcher writes is read as neither a launch nor a summary.
    launch.type = "luna_lanes.launch";
    writeFileSync(launchPath, JSON.stringify(launch));
    const retiredLaunch = run(f.tasks, f.summary);
    expect(retiredLaunch.status).toBe(1);
    expect(receiptOf(f).launchBinding).toMatchObject({
      state: "invalid",
      issues: expect.arrayContaining(["launch.json is not a Luna launch record"]),
    });

    summary.type = "luna_lanes.completed";
    writeFileSync(f.summary, JSON.stringify(summary));
    const retiredSummary = run(f.tasks, f.summary);
    expect(retiredSummary.status).toBe(2);
    expect(retiredSummary.stderr).toContain("summary.json is not a completed Luna summary");
  });

  it("lets a hardware session write its own scratch and no read-only session write anything", () => {
    const f = fixture({ launch: false });
    const hardware = hardwareTask(f.dir);
    const { scratch } = hardware;
    const open = JSON.parse(readFileSync(f.tasks, "utf8"))[0];
    writeFileSync(f.tasks, JSON.stringify([open, hardware]));
    const hardwareReport = join(f.output, "lane_30.md");
    writeFileSync(hardwareReport, laneReport(TRUTH));
    writeFileSync(
      f.summary,
      JSON.stringify({
        schemaVersion: 1,
        type: "luna_sessions.completed",
        outputDir: f.output,
        sessions: [
          { name: LANE, status: "completed", exitCode: 0, reportPath: f.report },
          { name: TRUTH, status: "completed", exitCode: 0, reportPath: hardwareReport },
        ],
      }),
    );
    const launchWith = (rows: { sandbox: string; ownedPaths: string[] }[]): string[] => {
      writeFileSync(
        join(f.output, "launch.json"),
        JSON.stringify({
          type: "luna_sessions.launch",
          outputDir: f.output,
          sessions: [LANE, TRUTH].map((name, at) => ({
            name,
            workdir: f.dir,
            promptSha256: "0".repeat(64),
            ...rows[at],
          })),
        }),
      );
      run(f.tasks, f.summary);
      return receiptOf(f).launchBinding.issues;
    };
    const sandboxIssues = (issues: string[]) => issues.filter((row) => /sandbox|ownedPaths/.test(row));
    const readOnly = { sandbox: "read-only", ownedPaths: [] };
    const owner = { sandbox: "workspace-write", ownedPaths: [scratch] };
    expect(sandboxIssues(launchWith([readOnly, owner]))).toEqual([]);
    expect(sandboxIssues(launchWith([owner, owner]))).toEqual([
      "launch.sessions[0].sandbox must be read-only",
      "launch.sessions[0].ownedPaths must be an empty array",
    ]);
    expect(sandboxIssues(launchWith([readOnly, { ...owner, ownedPaths: [scratch, f.dir] }]))).toEqual([
      "launch.sessions[1].ownedPaths must name only its hardware scratch",
    ]);
    expect(sandboxIssues(launchWith([readOnly, readOnly]))).toEqual([
      "launch.sessions[1].sandbox must be workspace-write for its hardware scratch",
      "launch.sessions[1].ownedPaths must name only its hardware scratch",
    ]);
    // A scratch on a session with no hardware lane is refused before any launch is read.
    writeFileSync(f.tasks, JSON.stringify([{ ...open, scratch }, hardware]));
    expect(run(f.tasks, f.summary).stderr).toContain("scratch is set on a session with no hardware lane");
  });

  it("rejects a present but stale Luna launch record", () => {
    const f = fixture();
    writeFileSync(
      join(f.output, "launch.json"),
      JSON.stringify({
        type: "luna_sessions.launch",
        outputDir: f.output,
        sessions: [{ name: "wrong", promptSha256: "a".repeat(64) }],
      }),
    );
    const result = run(f.tasks, f.summary);
    const receipt = receiptOf(f);
    expect(result.status).toBe(1);
    expect(receipt.complete).toBe(false);
    expect(receipt.launchBinding).toMatchObject({
      state: "invalid",
      issues: expect.arrayContaining(["launch session order/identity differs from tasks"]),
    });
  });

  it("rejects a completed report that expands or omits its assigned lanes", () => {
    const f = fixture();
    writeFileSync(f.report, laneReport("lane_06"));
    const result = run(f.tasks, f.summary);
    const receipt = receiptOf(f);

    expect(result.status).toBe(1);
    expect(receipt.complete).toBe(false);
    expect(receipt.rows[0].issues).toContain("out-of-scope lane headings: 06");
    expect(receipt.rows[0].issues).toContain("assigned lane headings missing or repeated: 05");
  });

  it("requires each owed report section once, in order and non-empty", () => {
    const f = fixture();
    const refused: [string, string][] = [
      [
        laneReport(LANE).replace("### Findings\nnone\n\n", ""),
        "## lane_05: section `### Findings` missing or repeated",
      ],
      [
        laneReport(LANE).replace("### Started from\n", "### Started from\n### Started from\n"),
        "## lane_05: section `### Started from` missing or repeated",
      ],
      [
        laneReport(LANE).replace("Whether the second variant repeats the failure.\n", ""),
        "## lane_05: section `### Not established` is empty",
      ],
      [
        laneReport(LANE).replace(
          "### Findings\nnone\n\n### Not established\nWhether the second variant repeats the failure.\n",
          "### Not established\nWhether the second variant repeats the failure.\n\n### Findings\nnone\n",
        ),
        "## lane_05: report sections are out of order",
      ],
    ];
    for (const [report, issue] of refused) {
      writeFileSync(f.report, report);
      expect(run(f.tasks, f.summary).status).toBe(1);
      expect(receiptOf(f).rows[0].issues).toContain(issue);
    }
  });

  it("reads each finding's owner through the Markdown a report wraps it in, and checks the word", () => {
    // Seven of 36 lane reports on 2026-09-30 were refused for these wrappers alone, each naming a
    // listed owner: the whole line in a code span, a bold label, a backticked value, a gloss after it.
    const f = fixture();
    const wrapped = [
      "- The oracle accepts a wrong answer.\n  owner: correctness-model/evaluator.ts",
      "- The oracle accepts a wrong answer.\n  `owner: correctness-model/evaluator.ts`  ",
      "- The judge cited no rule.\n- **Owner:** `judge`",
      "- The gate refused a host fault.\n  owner: controller-source (`src/correctness-bundle/solvability.ts`; gate F2-5)",
      "- The wall was shared.\n  **owner:** environment  ",
    ].join("\n");
    writeFileSync(f.report, laneReport(LANE, wrapped));
    expect(run(f.tasks, f.summary).status).toBe(0);
    expect(receiptOf(f).rows[0].issues).toEqual([]);
    const refused: [string, string][] = [
      ["- The oracle accepts a wrong answer.", "## lane_05: findings name no owner"],
      ["- The oracle accepts a wrong answer.\n  owner: evaluator", unlistedOwner("evaluator")],
      ["- The oracle accepts a wrong answer.\n  `owner: evaluator`", unlistedOwner("evaluator")],
    ];
    for (const [findings, issue] of refused) {
      writeFileSync(f.report, laneReport(LANE, findings));
      expect(run(f.tasks, f.summary).status).toBe(1);
      expect(receiptOf(f).rows[0].issues).toContain(issue);
    }
  });

  it("reads an owner labelled inside the finding's own line", () => {
    // lane_30 of custom-opus-198d70-hw (2026-09-30) led each finding with its verdict and owner in
    // one bold span, and was refused as naming no owner.
    const f = fixture();
    const inline = [
      "- **Risk — owner: `controller-source`.** **Denominator:** 21 verified cases. **Observation:** the context stated the outcomes.",
      "- **Fine — owner: `correctness-model/evaluator.ts`.** **Denominator:** 21 verified cases.",
      "- The wall was shared (owner: environment).",
      "- The judge cited no rule.\n  owner: judge.",
    ].join("\n");
    writeFileSync(f.report, laneReport(LANE, inline));
    expect(run(f.tasks, f.summary).status).toBe(0);
    expect(receiptOf(f).rows[0].issues).toEqual([]);
    writeFileSync(
      f.report,
      laneReport(LANE, "- **Risk — owner: `evaluator`.** The oracle accepts a wrong answer."),
    );
    expect(run(f.tasks, f.summary).status).toBe(1);
    expect(receiptOf(f).rows[0].issues).toContain(unlistedOwner("evaluator"));
  });

  it("rejects a failed session and a report outside the launcher output", () => {
    const f = fixture();
    const outside = join(f.dir, "outside.md");
    writeFileSync(outside, "## lane_05\n");
    writeFileSync(
      f.summary,
      JSON.stringify({
        schemaVersion: 1,
        type: "luna_sessions.completed",
        outputDir: f.output,
        sessions: [{ name: LANE, status: "failed", exitCode: 1, reportPath: outside }],
      }),
    );
    const result = run(f.tasks, f.summary);
    const receipt = receiptOf(f);

    expect(result.status).toBe(1);
    expect(receipt.rows[0].issues[0]).toContain("terminal status is failed");
    expect(receipt.rows[0].issues[1]).toContain("outside outputDir");
  });

  it("refuses a summary whose session identity or order differs from the tasks", () => {
    const f = fixture();
    renameSession(f, "lane_06");
    const result = run(f.tasks, f.summary);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("summary session order/identity differs from tasks");
  });

  it("accepts a native review's saved reports against the prompts the manifest composed", () => {
    const f = fixture({ launch: false });
    rmSync(f.output, { recursive: true });
    nativeLane(f, LANE);
    const out = join(f.dir, "wri-report-validation.json");
    const validate = () => spawnTextSync(Bun.argv[0]!, [script, "--tasks", f.tasks, "--out", out]);
    const receipt = () => JSON.parse(readFileSync(out, "utf8"));

    expect(validate().status).toBe(0);
    expect(receipt()).toMatchObject({ complete: true, summaryPath: null, launchBinding: null });
    expect(receipt().rows[0]).toMatchObject({ transport: "native", status: "accepted-for-adjudication" });

    // A prompt edited after the manifest composed it is not the prompt the lane was assigned.
    const prompt = join(f.dir, "prompts", `${LANE}.md`);
    writeFileSync(prompt, `${readFileSync(prompt, "utf8")}Also read the verifier output.\n`);
    expect(validate().status).toBe(1);
    expect(receipt().rows[0].issues).toContain(
      `prompts/${LANE}.md differs from the prompt the manifest composes`,
    );
    rmSync(join(f.dir, "native-output", `${LANE}.md`));
    expect(validate().status).toBe(1);
    expect(receipt().rows[0].issues).toEqual(["no Luna session and no native report names this task"]);
  });

  it("joins a review whose lanes ran partly on Luna and partly native, and refuses a lane reported twice", () => {
    const f = fixture();
    const native = addTask(f, 6);
    nativeLane(f, native);

    expect(run(f.tasks, f.summary).status).toBe(0);
    const receipt = receiptOf(f);
    expect(receipt.complete).toBe(true);
    expect(receipt.rows.map((row: { transport: string }) => row.transport)).toEqual(["luna", "native"]);

    // A lane no transport reported is missing work, not a refusal of the whole collection.
    addTask(f, 8);
    expect(run(f.tasks, f.summary).status).toBe(1);
    expect(receiptOf(f).rows[2]).toMatchObject({ transport: null, status: "rejected" });

    nativeLane(f, LANE);
    expect(run(f.tasks, f.summary).status).toBe(1);
    expect(receiptOf(f).rows[0].issues).toEqual(["reported both by a Luna session and by a native report"]);
  });

  it("refuses an inactive admission, an older admission schema and a lane without its trigger", () => {
    const inactive = fixture();
    const inactiveTasks = JSON.parse(readFileSync(inactive.tasks, "utf8"));
    inactiveTasks[0].admission.state = "inactive";
    writeFileSync(inactive.tasks, JSON.stringify(inactiveTasks));
    const inactiveResult = run(inactive.tasks, inactive.summary);
    expect(inactiveResult.status).toBe(2);
    expect(inactiveResult.stderr).toContain("inactive progressive admission");

    const older = fixture();
    const olderTasks = JSON.parse(readFileSync(older.tasks, "utf8"));
    olderTasks[0].admission = { ...olderTasks[0].admission, schema: "wri-progressive-admission/v1" };
    writeFileSync(older.tasks, JSON.stringify(olderTasks));
    const olderResult = run(older.tasks, older.summary);
    expect(olderResult.status).toBe(2);
    expect(olderResult.stderr).toContain("admission schema must be wri-progressive-admission/v2");

    const untriggered = fixture();
    const untriggeredTasks = JSON.parse(readFileSync(untriggered.tasks, "utf8"));
    untriggeredTasks[0].admission.triggers = [];
    writeFileSync(untriggered.tasks, JSON.stringify(untriggeredTasks));
    const untriggeredResult = run(untriggered.tasks, untriggered.summary);
    expect(untriggeredResult.status).toBe(2);
    expect(untriggeredResult.stderr).toContain("triggers must name one trigger per assigned lane");
  });

  it("requires every open lane in an exhaustive admission and lets an unfired isolated lane stay out", () => {
    const f = fixture();
    const open = Array.from({ length: ANGLE_COUNT }, (_, index) => index + 1).filter(
      (lane) => !ISOLATED_ANGLES.has(lane),
    );
    const tasks = open.map((lane) => {
      const number = String(lane).padStart(2, "0");
      const name = `lane_${number}`;
      writeFileSync(join(f.output, `${name}.md`), laneReport(name));
      return {
        name,
        task: `assignedSession: ${name}\nassignedLanes: ${number}\n`,
        admission: admission(name, [lane], "exhaustive"),
      };
    });
    writeFileSync(f.tasks, JSON.stringify(tasks));
    writeFileSync(
      f.summary,
      JSON.stringify({
        schemaVersion: 1,
        type: "luna_sessions.completed",
        outputDir: f.output,
        sessions: tasks.map(({ name }) => ({
          name,
          status: "completed",
          exitCode: 0,
          reportPath: join(f.output, `${name}.md`),
        })),
      }),
    );
    writeLaunch(f);
    expect(run(f.tasks, f.summary).status).toBe(0);
    writeFileSync(f.tasks, JSON.stringify(tasks.slice(0, -1)));
    const missing = run(f.tasks, f.summary);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain(
      `exhaustive progressive admission must cover every open lane exactly once; missing ${String(open.at(-1)).padStart(2, "0")}`,
    );
  });

  it("refuses a misspelled flag before reading anything", () => {
    const f = fixture();
    const result = spawnTextSync(Bun.argv[0]!, [script, "--tasks", f.tasks, "--sumary", f.summary]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`unknown option "--sumary"`);
  });

  it("writes a structured refusal receipt when the summary is missing", () => {
    const f = fixture();
    rmSync(f.summary);
    const result = run(f.tasks, f.summary);
    const receipt = receiptOf(f);
    expect(result.status).toBe(2);
    expect(receipt.schema).toBe("wri-report-validation/v3");
    expect(receipt.complete).toBe(false);
    expect(receipt.rows).toEqual([]);
    expect(receipt.issues[0]).toContain("ENOENT");
  });

  it("requires the declared heading of a directed task and the sections under it", () => {
    const f = fixture();
    const tasks = JSON.parse(readFileSync(f.tasks, "utf8"));
    tasks[0] = {
      name: "devil",
      task: "assignedSession: devil\nexpectedHeading: ## devil\n\nReport one contradiction.",
      admission: admission("devil", []),
    };
    writeFileSync(f.tasks, JSON.stringify(tasks));
    writeFileSync(f.report, "## other\n\nWrong heading.\n");
    renameSession(f, "devil");
    const result = run(f.tasks, f.summary);
    const receipt = receiptOf(f);
    expect(result.status).toBe(1);
    expect(receipt.rows[0].issues).toContain("out-of-scope report headings: other");
    expect(receipt.rows[0].issues).toContain("expected heading missing or repeated: devil");

    writeFileSync(f.report, "## devil\n\nOne contradiction, no sections.\n");
    expect(run(f.tasks, f.summary).status).toBe(1);
    expect(receiptOf(f).rows[0].issues).toContain("## devil: section `### Findings` missing or repeated");

    writeFileSync(f.report, laneReport("devil"));
    writeLaunch(f);
    expect(run(f.tasks, f.summary).status).toBe(0);
    expect(receiptOf(f).rows[0].expectedHeading).toBe("devil");
  });

  it("rejects a lane assigned to two sessions", () => {
    const f = fixture();
    const tasks = JSON.parse(readFileSync(f.tasks, "utf8"));
    tasks.push({
      name: "lane_05_again",
      task: "assignedSession: lane_05_again\nassignedLanes: 05\n\nReview the oracle again.",
      admission: admission("lane_05_again", [5]),
    });
    writeFileSync(f.tasks, JSON.stringify(tasks));
    const duplicate = run(f.tasks, f.summary);
    expect(duplicate.status).toBe(2);
    expect(duplicate.stderr).toContain("progressive admission assigns lane 05 more than once");
  });
});
