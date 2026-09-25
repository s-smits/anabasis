import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { spawnTextSync } from "./helpers/bun-spawn-sync.ts";
import { afterEach, describe, expect, it } from "bun:test";

const root = resolve(import.meta.dirname, "..");
const script = join(root, ".claude/skills/whole-run-investigation/scripts/validate-reports.mjs");
const launcher = join(root, ".claude/skills/codex-luna-swarm/scripts/luna-sessions.mjs");
const dirs: string[] = [];

function fixture({ launch = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ana-wri-reports-"));
  dirs.push(dir);
  const output = join(dir, "output");
  mkdirSync(output);
  const tasks = join(dir, "tasks.json");
  const summary = join(output, "summary.json");
  const report = join(output, "angle_05.md");
  writeFileSync(
    tasks,
    JSON.stringify([
      {
        name: "angle_05",
        task: "assignedSession: angle_05\nassignedAngles: 05\n\nReview the oracle.",
        admission: {
          schema: "wri-progressive-admission/v1",
          mode: "targeted",
          state: "active",
          identityKey: "angle_05",
          angles: [5],
          trigger: null,
        },
      },
    ]),
  );
  writeFileSync(report, "## angle_05\n\nOne bounded finding.\n");
  writeFileSync(
    summary,
    JSON.stringify({
      schemaVersion: 1,
      type: "luna_sessions.completed",
      outputDir: output,
      sessions: [{ name: "angle_05", status: "completed", exitCode: 0, reportPath: report }],
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

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("WRI report validation", () => {
  it("binds one completed report to its task and assigned heading", () => {
    const f = fixture();
    const result = run(f.tasks, f.summary);
    const receipt = JSON.parse(readFileSync(f.result, "utf8"));

    expect(result.status).toBe(0);
    expect(receipt.complete).toBe(true);
    expect(receipt.rows[0].assignedAngles).toEqual(["05"]);
    expect(receipt.rows[0].reportedAngles).toEqual(["05"]);
    expect(receipt.rows[0].reportSha256).toHaveLength(64);
    expect(receipt.launchBinding.state).toBe("incomplete");
    expect(receipt.launchBinding.promptDigestsBound).toBe(false);
  });

  it("refuses a report whose launch record is absent", () => {
    const f = fixture({ launch: false });
    const result = run(f.tasks, f.summary);
    const receipt = JSON.parse(readFileSync(f.result, "utf8"));

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
    writeFileSync(launcherTasks, JSON.stringify([{ name: "angle_05", task }]));
    const fakeCodex = join(f.dir, "fake-codex");
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env bun
const args = Bun.argv.slice(2);
await Bun.write(args[args.indexOf("--output-last-message") + 1], "## angle_05\\n\\nOne bounded finding.\\n");
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
        sessions: [{ name: "angle_05", task }],
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
            name: "angle_05",
            taskSha256: hash(new TextEncoder().encode(task)),
            admissionSha256: hash(new TextEncoder().encode(JSON.stringify(taskRow.admission))),
            promptSha256,
          },
        ],
      }),
    );
    const result = run(f.tasks, f.summary);
    const receipt = JSON.parse(readFileSync(f.result, "utf8"));
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
    expect(JSON.parse(readFileSync(f.result, "utf8")).launchBinding.promptDigestsBound).toBe(false);
    writeFileSync(launchPath, launchBytes);
    writeFileSync(sidecar, sidecarBytes);

    const launch = JSON.parse(readFileSync(launchPath, "utf8"));
    const summary = JSON.parse(readFileSync(f.summary, "utf8"));
    // No launcher writes the luna_lanes names any more, so neither record type is read.
    launch.type = "luna_lanes.launch";
    writeFileSync(launchPath, JSON.stringify(launch));
    const retiredLaunch = run(f.tasks, f.summary);
    expect(retiredLaunch.status).toBe(1);
    expect(JSON.parse(readFileSync(f.result, "utf8")).launchBinding.state).toBe("invalid");

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
    const receipt = JSON.parse(readFileSync(f.result, "utf8"));
    expect(result.status).toBe(1);
    expect(receipt.complete).toBe(false);
    expect(receipt.launchBinding.state).toBe("invalid");
  });

  it("rejects a completed report that expands or omits its assigned angles", () => {
    const f = fixture();
    writeFileSync(f.report, "## angle_06\n\nOut of scope.\n");
    const result = run(f.tasks, f.summary);
    const receipt = JSON.parse(readFileSync(f.result, "utf8"));

    expect(result.status).toBe(1);
    expect(receipt.complete).toBe(false);
    expect(receipt.rows[0].issues).toContain("out-of-scope angle headings: 06");
    expect(receipt.rows[0].issues).toContain("assigned angle headings missing or repeated: 05");
  });

  it("rejects a failed session and a report outside the launcher output", () => {
    const f = fixture();
    const outside = join(f.dir, "outside.md");
    writeFileSync(outside, "## angle_05\n");
    writeFileSync(
      f.summary,
      JSON.stringify({
        schemaVersion: 1,
        type: "luna_sessions.completed",
        outputDir: f.output,
        sessions: [{ name: "angle_05", status: "failed", exitCode: 1, reportPath: outside }],
      }),
    );
    const result = run(f.tasks, f.summary);
    const receipt = JSON.parse(readFileSync(f.result, "utf8"));

    expect(result.status).toBe(1);
    expect(receipt.rows[0].issues[0]).toContain("terminal status is failed");
    expect(receipt.rows[0].issues[1]).toContain("outside outputDir");
  });

  it("refuses a summary whose session identity or order differs from the tasks", () => {
    const f = fixture();
    writeFileSync(
      f.summary,
      JSON.stringify({
        schemaVersion: 1,
        type: "luna_sessions.completed",
        outputDir: f.output,
        sessions: [{ name: "angle_06", status: "completed", exitCode: 0, reportPath: f.report }],
      }),
    );
    const result = run(f.tasks, f.summary);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("summary session order/identity differs from tasks");
  });

  it("rejects inactive targeted admission and incomplete exhaustive admission", () => {
    const inactive = fixture();
    const inactiveTasks = JSON.parse(readFileSync(inactive.tasks, "utf8"));
    inactiveTasks[0].admission.state = "inactive";
    writeFileSync(inactive.tasks, JSON.stringify(inactiveTasks));
    const inactiveResult = run(inactive.tasks, inactive.summary);
    expect(inactiveResult.status).toBe(2);
    expect(inactiveResult.stderr).toContain("inactive progressive admission");

    const incomplete = fixture();
    const incompleteTasks = JSON.parse(readFileSync(incomplete.tasks, "utf8"));
    incompleteTasks[0].admission.mode = "exhaustive";
    writeFileSync(incomplete.tasks, JSON.stringify(incompleteTasks));
    const incompleteResult = run(incomplete.tasks, incomplete.summary);
    expect(incompleteResult.status).toBe(2);
    expect(incompleteResult.stderr).toContain("cover every active angle exactly once");
  });

  it("requires all 40 angles and refuses omission of the valid-alternative lane", () => {
    const f = fixture();
    const tasks = Array.from({ length: 40 }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      const name = `angle_${number}`;
      writeFileSync(join(f.output, `${name}.md`), `## ${name}\n\nBounded finding.\n`);
      return {
        name,
        task: `assignedSession: ${name}\nassignedAngles: ${number}\n`,
        admission: {
          schema: "wri-progressive-admission/v1",
          mode: "exhaustive",
          state: "active",
          identityKey: name,
          angles: [index + 1],
          trigger: null,
        },
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
    writeFileSync(f.tasks, JSON.stringify(tasks.slice(0, 35)));
    const missing = run(f.tasks, f.summary);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("cover every active angle exactly once");
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
    const receipt = JSON.parse(readFileSync(f.result, "utf8"));
    expect(result.status).toBe(2);
    expect(receipt.schema).toBe("wri-report-validation/v1");
    expect(receipt.complete).toBe(false);
    expect(receipt.rows).toEqual([]);
    expect(receipt.issues[0]).toContain("ENOENT");
  });

  it("requires the declared heading and every diagnostic input disposition", () => {
    const f = fixture();
    const tasks = JSON.parse(readFileSync(f.tasks, "utf8"));
    tasks[0] = {
      name: "devil",
      task: "assignedSession: devil\nexpectedHeading: ## devil\nassignedDiagnosticInputs: scan,builder,review-yield\n\nReport one contradiction.",
      admission: { ...tasks[0].admission, identityKey: "devil", angles: [] },
    };
    writeFileSync(f.tasks, JSON.stringify(tasks));
    writeFileSync(f.report, "## other\n\nWrong heading.\n");
    writeFileSync(
      f.summary,
      JSON.stringify({
        schemaVersion: 1,
        type: "luna_sessions.completed",
        outputDir: f.output,
        sessions: [{ name: "devil", status: "completed", exitCode: 0, reportPath: f.report }],
      }),
    );
    const result = run(f.tasks, f.summary);
    const receipt = JSON.parse(readFileSync(f.result, "utf8"));
    expect(result.status).toBe(1);
    expect(receipt.rows[0].issues).toContain("out-of-scope report headings: other");
    expect(receipt.rows[0].issues).toContain("expected heading missing or repeated: devil");
    const scan = "| scan | investigate | Repeated failed calls; scan view and linked trace. |\n";
    const usage = "| builder | investigate | 102 calls, 8 failed; builder view and execution record. |\n";
    const yieldRow =
      "| review-yield | no-action | No eligible review opportunity; recorded component rows. |\n";
    writeFileSync(f.report, `## devil\n\n${scan}${usage}`);
    expect(run(f.tasks, f.summary).status).toBe(1);
    expect(JSON.parse(readFileSync(f.result, "utf8")).rows[0].issues).toContain(
      "diagnostic input disposition missing or repeated: review-yield",
    );
    writeFileSync(f.report, `## devil\n\n${scan}${usage}${yieldRow}`);
    writeLaunch(f);
    expect(run(f.tasks, f.summary).status).toBe(0);
    writeFileSync(f.report, `## devil\n\n${scan}${scan}${usage}${yieldRow}`);
    expect(run(f.tasks, f.summary).status).toBe(1);
    writeFileSync(f.report, `## devil\n\n| scan | passed | |\n${usage}${yieldRow}`);
    expect(run(f.tasks, f.summary).status).toBe(1);
  });

  it("rejects duplicate targeted angles unless both rows declare one independent challenge", () => {
    const f = fixture();
    const tasks = JSON.parse(readFileSync(f.tasks, "utf8"));
    tasks.push({
      name: "angle_05_challenge",
      task: "assignedSession: angle_05_challenge\nassignedAngles: 05\n\nChallenge the standing session.",
      admission: { ...tasks[0].admission, identityKey: "angle_05_challenge", angles: [5] },
    });
    writeFileSync(f.tasks, JSON.stringify(tasks));
    const duplicate = run(f.tasks, f.summary);
    expect(duplicate.status).toBe(2);
    expect(duplicate.stderr).toContain("assigns angle 05 more than once");

    const challengeTasks = JSON.parse(readFileSync(f.tasks, "utf8"));
    for (const task of challengeTasks) {
      task.admission.relation = "independent-challenge";
      task.admission.challengeId = "challenge-1";
    }
    writeFileSync(f.tasks, JSON.stringify(challengeTasks));
    const secondReport = join(f.output, "angle_05_challenge.md");
    writeFileSync(secondReport, "## angle_05\n\nIndependent report.\n");
    writeFileSync(
      f.summary,
      JSON.stringify({
        schemaVersion: 1,
        type: "luna_sessions.completed",
        outputDir: f.output,
        sessions: [
          { name: "angle_05", status: "completed", exitCode: 0, reportPath: f.report },
          { name: "angle_05_challenge", status: "completed", exitCode: 0, reportPath: secondReport },
        ],
      }),
    );
    writeLaunch(f);
    const admitted = run(f.tasks, f.summary);
    expect(admitted.status).toBe(0);
  });
});
