/**
 * What `validate-reports.mjs` binds and what it rejects. A report is joined to its task by name,
 * to its launch by prompt digest, and to its assigned lanes by heading; under each lane heading it
 * owes the four report sections, and every finding names one owner from the closed set.
 */
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join, resolve } from "../src/meta/path.ts";
import { spawnTextSync } from "./helpers/bun-spawn-sync.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import {
  ANGLE_COUNT,
  ISOLATED_ANGLES,
} from "../.claude/skills/whole-run-investigation/scripts/catalogue-shape.mjs";
import {
  FINDING_OWNERS,
  REPORT_SECTIONS,
} from "../.claude/skills/whole-run-investigation/scripts/manifest-reporting.mjs";
import { afterAll, describe, expect, it } from "bun:test";

const root = resolve(import.meta.dirname, "..");
const script = join(root, ".claude/skills/whole-run-investigation/scripts/validate-reports.mjs");
const launcher = join(root, ".claude/skills/codex-luna-swarm/scripts/luna-sessions.mjs");

const LANE = "lane_05";
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

function receiptOf(f: { result: string }) {
  return JSON.parse(readFileSync(f.result, "utf8"));
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
    expect(receipt.schema).toBe("wri-report-validation/v2");
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

  it("binds a current Luna collection and refuses the retired luna_lanes record names", () => {
    const f = fixture();
    const instructions = join(f.dir, "instructions.md");
    writeFileSync(instructions, "shared instructions\n");
    const taskBytes = readFileSync(f.tasks);
    const instructionBytes = readFileSync(instructions);
    const hash = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const taskRow = JSON.parse(taskBytes.toString("utf8"))[0];
    const { task } = taskRow;
    const workdir = realpathSync(f.dir);
    const promptSha256 = hash(
      new TextEncoder().encode(
        `shared instructions\n\n${task.trim()}\n\nAuthority: read-only. Do not edit files or change external state.`,
      ),
    );
    const launcherTasks = join(f.dir, "luna-tasks.json");
    writeFileSync(launcherTasks, JSON.stringify([{ name: LANE, task }]));
    const reportBody = join(f.dir, "report-body.md");
    writeFileSync(reportBody, laneReport(LANE));
    const fakeCodex = join(f.dir, "fake-codex");
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env bun
const args = Bun.argv.slice(2);
await Bun.write(args[args.indexOf("--output-last-message") + 1], Bun.file(${JSON.stringify(reportBody)}));
console.log(JSON.stringify({ type: "thread.started", thread_id: "thread_test_123" }));
`,
      { mode: 0o700 },
    );
    const manifest = join(f.dir, "manifest.json");
    writeFileSync(
      manifest,
      JSON.stringify({
        workdir,
        instructions: "shared instructions",
        sessions: [{ name: LANE, task }],
      }),
    );
    rmSync(f.output, { recursive: true });
    expect(
      spawnTextSync(Bun.argv[0]!, [
        launcher,
        "--manifest",
        manifest,
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
        tasks: [
          {
            name: LANE,
            taskSha256: hash(new TextEncoder().encode(task)),
            admissionSha256: hash(new TextEncoder().encode(JSON.stringify(taskRow.admission))),
            promptSha256,
          },
        ],
      }),
    );
    const result = run(f.tasks, f.summary);
    const receipt = receiptOf(f);
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

  it("requires each owed report section once, in order, with an owner on every finding", () => {
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
      [laneReport(LANE, "- The oracle accepts a wrong answer."), "## lane_05: findings name no owner"],
      [
        laneReport(LANE, "- The oracle accepts a wrong answer.\n  owner: evaluator"),
        `## lane_05: finding owner \`evaluator\` is not one of ${FINDING_OWNERS.join(", ")}`,
      ],
    ];
    for (const [report, issue] of refused) {
      writeFileSync(f.report, report);
      expect(run(f.tasks, f.summary).status).toBe(1);
      expect(receiptOf(f).rows[0].issues).toContain(issue);
    }
    writeFileSync(
      f.report,
      laneReport(
        LANE,
        "- The oracle accepts a wrong answer.\n  owner: correctness-model\n- The judge cited no rule.\n  owner: judge",
      ),
    );
    expect(run(f.tasks, f.summary).status).toBe(0);
    expect(receiptOf(f).rows[0].issues).toEqual([]);
  });

  it("names the nine FeedbackOwner members from src plus the two review-only owners", () => {
    const source = readFileSync(join(root, "src/author/campaign-types.ts"), "utf8");
    const declared = /const FEEDBACK_OWNERS = \[([^\]]+)\]/.exec(source)?.[1];
    if (declared === undefined) throw new Error("campaign-types.ts declares no FEEDBACK_OWNERS");
    const owners = [...declared.matchAll(/"([a-z-]+)"/g)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    );
    expect(owners).toHaveLength(9);
    expect(FINDING_OWNERS.slice(0, owners.length)).toEqual(owners);
    expect(FINDING_OWNERS.slice(owners.length)).toEqual(["controller-source", "judge"]);
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
    expect(receipt.schema).toBe("wri-report-validation/v2");
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
