/**
 * What `build-manifest.mjs` composes from a frozen snapshot, and what it refuses to launch.
 *
 * The builder is a command, so every rule here spawns it. What each test varies is one argument or
 * one field of the snapshot; the rest is the same launch every time. So one `snapshot()` writes the
 * digest-bound tree trace-review writes and amends it in place, and one `launch()` supplies the
 * four standing arguments and reads back what was written. A test states its difference and its
 * assertions, not the ten lines around them.
 *
 * The catalogue is read from the maintained references, never retyped: a test that pins today's
 * wording proves the copy in its own fixture.
 */
import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join, resolve } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { PINNED_BUN_VERSION } from "../src/run/host-runtime-policy.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import {
  ANGLE_COUNT,
  ANGLE_FILES,
  DIGEST_VERDICTS,
} from "../.claude/skills/whole-run-investigation/scripts/catalogue-shape.mjs";

type View = { label: string; file: string; status: string; required: boolean; bytes: number; sha256: string };
type Status = {
  schema: string;
  capturedAt: string;
  campaign: string;
  repo: string;
  runIds: string[];
  source: { commit: string; dirty: boolean; sourceDigest: string };
  worktree: { path: string; head: string; dirty: boolean };
  runtime: { version: string; executable: string };
  complete: boolean;
  views: View[];
  facts?: { terminalAccounting: TerminalAccounting };
};
/** The part of trace-review's `terminalAccounting` projection the manifest renders. */
type TerminalAccounting = {
  controller: { state: string; error?: string };
  outerCap?: number;
  completedRounds?: number;
  counts: { raw: number | null; real: number | null; controller: number | null };
  parents?: { lastCandidate: string | null; adopted: string | null; accepted: string | null };
};
type Task = { name: string; task: string };

const DEFAULT_VIEW = JSON.stringify({
  controller: {
    state: "recorded",
    terminalReason: "candidate-held",
    denominator: { state: "recorded", total: 50, verified: 47, unaccepted: 0, nonResults: 3 },
  },
  caseRecord: "present",
  batteries: {
    "run-1-on": {
      cases: {
        total: 25,
        verified: 25,
        passed: 18,
        failed: 7,
        unaccepted: 0,
        nonResults: { total: 0, byKind: {} },
      },
      passRate: { successes: 18, n: 25, rate: 0.72, wilson: { lower: 0.524, upper: 0.857 } },
      families: { "usb-pd": { total: 6, verified: 6, passed: 0, unaccepted: 0, nonResults: 0 } },
      identity: { backendPins: ["claude/claude-opus-5"], variants: ["on"], slugs: ["demo"] },
    },
  },
});
const SCAN_VIEW = JSON.stringify({
  findings: [{ rule: "telemetry-constant", battery: "run-1-on", statement: "turns is 1." }],
});

type Snapshot = ReturnType<typeof snapshot>;

/** Every launch carries one; the tests that are not about it use this one. */
const ORIENTATION =
  "## orientation\n1. The product is a link budget checker.\n2. Loose end: usb-pd is 0/6.\n\n";

afterEach(cleanupScratch);

const REPO = resolve(import.meta.dirname, "..");
const SKILL = join(REPO, ".claude/skills/whole-run-investigation");
const SCRIPT = join(SKILL, "scripts/build-manifest.mjs");

const sha256 = (body: string): string =>
  new Bun.CryptoHasher("sha256").update(new TextEncoder().encode(body)).digest("hex");
const byteLength = (body: string): number => new TextEncoder().encode(body).byteLength;

/** The clean commit a snapshot's identity is bound to. The builder resolves HEAD and the dirty flag
 *  itself, so the fixture needs a real repository, not a recorded sha. */
function identityRepo() {
  const path = scratchDir("ana-build-identity-");
  const git = (...args: string[]): void => {
    const result = spawnSync("git", ["-C", path, ...args]);
    if (result.status !== 0) throw new Error(result.stderr);
  };
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(path, "identity.txt"), "clean identity\n");
  writeFileSync(join(path, "package.json"), JSON.stringify({ engines: { bun: PINNED_BUN_VERSION } }));
  git("add", ".");
  git("commit", "-qm", "identity");
  return { path, head: spawnSync("git", ["-C", path, "rev-parse", "HEAD"]).stdout.trim() };
}

/** A complete digest-bound snapshot in the shape trace-review writes. */
function snapshot(options: { complete?: boolean; runtime?: string } = {}) {
  const dir = scratchDir("ana-build-snapshot-");
  const repo = identityRepo();
  const views: View[] = [];
  const put = (label: string, body: string, file = `${label}.txt`, status = "ok"): void => {
    writeFileSync(join(dir, file), body);
    views.push({ label, file, status, required: true, bytes: byteLength(body), sha256: sha256(body) });
  };
  put("digest", "# deterministic digest\n", "digest.md");
  put(
    "review-yield",
    JSON.stringify({ schema: "wri-review-yield-report/v1", components: [], complete: true }),
    "review-yield.json",
  );
  put("builder", JSON.stringify({ schema: "builder" }));
  put("run-1-default", DEFAULT_VIEW);
  put("run-1-scan", SCAN_VIEW);
  for (const mode of [
    "scorecard",
    "observations-warning",
    "cases-fail",
    "cases-unaccepted",
    "cases-non-result",
    "cases-pass",
  ]) {
    put(`run-1-${mode}`, "{}\n");
  }

  const challenge = join(dir, "trace-challenge");
  mkdirSync(challenge, { recursive: true });
  const telemetry = '{"schema":"trace-telemetry/v1"}\n';
  const packet = '{"schema":"whole-run-trace-challenge/v1"}\n';
  writeFileSync(join(challenge, "trace-telemetry.json"), telemetry);
  writeFileSync(join(challenge, "trace-challenge-packet.json"), packet);
  writeFileSync(join(challenge, "trace-challenge-prompt.md"), "# challenge\n");
  writeFileSync(
    join(challenge, "trace-challenge-status.json"),
    JSON.stringify({
      schema: "whole-run-trace-challenge-status/v1",
      complete: true,
      campaign: "/campaigns/demo",
      runId: "run-1",
      telemetry: join(challenge, "trace-telemetry.json"),
      packet: join(challenge, "trace-challenge-packet.json"),
      prompt: join(challenge, "trace-challenge-prompt.md"),
      telemetrySha256: sha256(telemetry),
      packetSha256: sha256(packet),
    }),
  );

  const status: Status = {
    schema: "outcome-snapshot-status/v2",
    capturedAt: "2026-08-14T07:51:39.654Z",
    campaign: "/campaigns/demo",
    repo: repo.path,
    runIds: ["run-1"],
    source: { commit: repo.head, dirty: false, sourceDigest: "d".repeat(64) },
    worktree: { path: repo.path, head: repo.head, dirty: false },
    runtime: { version: options.runtime ?? PINNED_BUN_VERSION, executable: Bun.argv[0]! },
    complete: options.complete ?? true,
    views,
  };
  const statusPath = join(dir, "snapshot-status.json");
  const save = (): void => writeFileSync(statusPath, JSON.stringify(status));
  save();

  return {
    dir,
    status,
    /** Change the recorded status the way a different capture would have written it. */
    amend(change: (status: Status) => void) {
      change(status);
      save();
    },
    /** Replace a view's bytes and its frozen digest together, as a capture would. */
    recapture(label: string, body: string, state: string) {
      const view = status.views.find((row) => row.label === label);
      if (view === undefined) throw new Error(`fixture has no ${label} view`);
      writeFileSync(join(dir, view.file), body);
      this.amend(() => {
        view.status = state;
        view.bytes = byteLength(body);
        view.sha256 = sha256(body);
      });
    },
    /** Change bytes behind their frozen digest, which is what drift looks like. */
    corrupt(file: string, body: string) {
      writeFileSync(join(dir, file), body);
    },
  };
}
function notes(body: string, orientation: string = ORIENTATION): string {
  const path = join(scratchDir("ana-build-notes-"), "notes.md");
  writeFileSync(path, `${orientation}${body}`);
  return path;
}

/** The builder, with the four arguments every launch carries and readers for what it wrote. The
 *  worktree is the snapshot's own: the builder refuses a requested one that differs, and no test
 *  here is about that refusal. */
function launch(snap: Snapshot | null, ...args: string[]) {
  const out = join(scratchDir("ana-build-out-"), "launch");
  const bound =
    snap === null ? [] : ["--snapshot", snap.dir, "--worktree", snap.status.worktree.path, "--out", out];
  const run = spawnSync(Bun.argv[0]!, [SCRIPT, ...bound, ...args]);
  const read = (...path: string[]): string => readFileSync(join(out, ...path), "utf8");
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    out,
    tasks: (file = "tasks.json"): Task[] => parseJsonAs<Task[]>(read(file)),
    task: (name: string): Task | undefined =>
      parseJsonAs<Task[]>(read("tasks.json")).find((row) => row.name === name),
    instructions: (): string => read("instructions.md"),
    prompt: (name: string): string => read("prompts", `${name}.md`),
  };
}

/** The maintained catalogue, so a hostile variant is built by editing the real rows. */
function catalogue(): string {
  return ANGLE_FILES.map((file: string) => readFileSync(join(SKILL, "references", file), "utf8")).join("\n");
}

/** A phrase from angle 5's own heading, to prove a task body came from the catalogue. */
function angleFivePhrase(): string {
  const line = catalogue()
    .split("\n")
    .find((candidate) => candidate.startsWith("**5. "));
  if (line === undefined) throw new Error("review-angles.md declares no angle 5");
  return line
    .slice(line.indexOf("**", 2) + 2)
    .trim()
    .slice(0, 40);
}

/** A catalogue under a scratch path, for the tests that launch against an edited one. */
function editedCatalogue(edit: (text: string) => string): string {
  const path = join(scratchDir("ana-build-angles-"), "review-angles.md");
  writeFileSync(path, edit(catalogue()));
  return path;
}

/** One declared intelligence session, taken from the builder rather than named here, so the
 *  fixture follows the maintained catalogue. */
function declaredSession(): string {
  const row = launch(null, "--list")
    .stdout.split("\n")
    .find((line) => line.trim().length > 0 && !line.startsWith("angle_"));
  const name = row?.split(/\s+/)[0];
  if (name === undefined) throw new Error("build-manifest --list declared no intelligence session");
  return name;
}

describe("what the builder declares", () => {
  it("lists distinct intelligence sessions and every maintained angle", () => {
    const listed = launch(null, "--list");
    const names = listed.stdout
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((name): name is string => Boolean(name));

    expect(listed.status).toBe(0);
    const sessions = names.filter((name) => !name.startsWith("angle_"));
    expect(sessions.length).toBeGreaterThan(0);
    expect(new Set(sessions).size).toBe(sessions.length);
    for (const session of sessions) expect(session).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
    expect(names.filter((name) => name.startsWith("angle_"))).toEqual(
      Array.from({ length: ANGLE_COUNT }, (_, index) => `angle_${String(index + 1).padStart(2, "0")}`),
    );
  });

  it("requires the complete 49-row catalogue before parsing any active angle", () => {
    const missing = launch(
      null,
      "--list",
      "--angles",
      editedCatalogue((text) => text.replace(/^\*\*H\..*\n(?:.*\n)*?(?=\*\*I\.)/m, "")),
    );
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("deterministic rows A-I exactly once and in order");

    const misplaced = launch(
      null,
      "--list",
      "--angles",
      editedCatalogue((text) =>
        text
          .replace(/^\*\*I\..*\n(?:.*\n)*?(?=\*\*1\.)/m, "")
          .replace(
            "**2. Judge 1 census.**",
            "**I. Served-model facts moved into a model session.**\n\n**2. Judge 1 census.**",
          ),
      ),
    );
    expect(misplaced.status).toBe(2);
    expect(misplaced.stderr).toContain("keep deterministic rows A-I before semantic angle 1");
  });

  it("refuses a session index that no longer names the catalogue rows", () => {
    const drifted = join(scratchDir("ana-build-index-"), "session-index.md");
    writeFileSync(
      drifted,
      readFileSync(join(SKILL, "references/session-index.md"), "utf8").replace(
        "**4. Steering coherence.**",
        "**4. Steering coherence and prompts.**",
      ),
    );

    const result = launch(null, "--list", "--index", drifted);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("session index title for angle_04");
  });
});

describe("what a launch composes", () => {
  it("derives the facts and bodies, leaving only the notes authored", () => {
    const session = "category_and_hook_yield";
    const result = launch(
      snapshot(),
      "--notes",
      notes(
        `## angle_05\nusb-pd is 0/6 on one variant.\n\n## ${session}\nSame run.\n\n## custom:devil\nArgue the opposite.\n`,
      ),
    );
    const tasks = result.tasks();
    const instructions = result.instructions();

    expect(result.status).toBe(0);
    expect(tasks.map((task) => task.name)).toEqual(["angle_05", session, "devil"]);
    // The launcher transport carries exactly the same rows, and nothing else.
    const launcherTasks = result.tasks("luna-tasks.json");
    expect(launcherTasks).toHaveLength(tasks.length);
    expect(launcherTasks.every((task) => Object.keys(task).sort().join(",") === "name,task")).toBe(true);
    // The body came from the maintained angle catalogue, not from the notes file.
    expect(tasks[0]?.task).toContain(angleFivePhrase());
    expect(tasks[0]?.task).toContain("usb-pd is 0/6 on one variant.");
    for (const other of [
      "**A. Campaign identity, declared and agreed.**",
      "**H. Runtime identity and isolation integrity.**",
      "**4. Steering coherence.**",
      "**6. Independent oracle mutation challenge.**",
    ]) {
      expect(tasks[0]?.task).not.toContain(other);
    }
    // A directed task carries its own scope bound instead of a standing angle body.
    expect(tasks[2]?.task).toContain("directed contradiction task");
    // Procedure loading names the launcher, not the different measured-source fixture.
    expect(instructions).toContain(`Review procedure: \`${join(SKILL, "SKILL.md")}\``);
    // Every count below came from the JSON views rather than a reviewer retyping them.
    expect(instructions).toContain("50 total = 47 verified + 0 unaccepted + 3 non-results");
    expect(instructions).toContain("usb-pd 0/6");
    expect(instructions).toContain("Wilson [0.524, 0.857]");
    expect(instructions).toContain("telemetry-constant");
    // The moved variable is not in the evidence, so its absence is stated rather than inferred.
    expect(instructions).toContain("was not supplied to the launcher");
    for (const verdict of DIGEST_VERDICTS) {
      expect(instructions.match(new RegExp(`^- ${verdict}:`, "gm"))).toHaveLength(1);
    }
    expect(instructions).toContain("2. Loose end: usb-pd is 0/6.");
    expect(instructions.indexOf("## Orientation")).toBeLessThan(instructions.indexOf("## Controller facts"));
  });

  it("states terminal accounting as trace-review projected it, and never sums it from the views", () => {
    const snap = snapshot();
    const unprojected = launch(snap, "--notes", notes("## angle_05\nLook.\n")).instructions();
    // The default view's battery holds 25 cases; a sum of it is not the controller's count.
    expect(unprojected).toContain("raw not recorded; real not recorded; controller-terminal not recorded");
    expect(unprojected).toContain("last candidate not recorded");

    snap.amend((status) => {
      status.facts = {
        terminalAccounting: {
          controller: { state: "refused", error: "terminal.json is not a recorded terminal" },
          counts: { raw: null, real: null, controller: null },
        },
      };
    });
    const refused = launch(snap, "--notes", notes("## angle_05\nLook.\n")).instructions();
    expect(refused).toContain(
      "Controller evidence refused by its strict reader: terminal.json is not a recorded terminal.",
    );

    snap.amend((status) => {
      status.facts = {
        terminalAccounting: {
          controller: { state: "recorded" },
          outerCap: 6,
          completedRounds: 4,
          counts: { raw: 50, real: 47, controller: 4 },
          parents: { lastCandidate: "abc123", adopted: null, accepted: "def456" },
        },
      };
    });
    const recorded = launch(snap, "--notes", notes("## angle_05\nLook.\n")).instructions();
    expect(recorded).toContain("outer-controller cap 6; completed controller rounds 4.");
    expect(recorded).toContain("raw 50; real 47; controller-terminal 4.");
    expect(recorded).toContain("last candidate abc123; adopted not recorded; accepted def456.");
    expect(recorded).not.toContain("strict reader");
  });

  it("keeps outcome context out of public-only prompts across native and launcher transports", () => {
    const result = launch(
      snapshot(),
      "--sessions",
      "2,19,20,36",
      "--transport",
      "native",
      "--notes",
      notes("## angle_19\nFORBIDDEN_DIRECTION: all passed.\n"),
    );
    const common = result.instructions();
    const tasks = result.tasks("luna-tasks.json");

    expect(result.status).toBe(0);
    for (const name of ["angle_19", "angle_20", "angle_36"]) {
      const task = tasks.find((row) => row.name === name);
      for (const prompt of [result.prompt(name), `${common}\n${task?.task}`]) {
        expect(prompt).toContain("Independent public-only review");
        expect(prompt).toContain("original request");
        expect(prompt).toContain("accepted artifact bytes");
        for (const forbidden of [
          "FORBIDDEN_DIRECTION",
          "usb-pd 0/6",
          "Wilson [0.524",
          "telemetry-constant",
          "## Controller facts",
        ]) {
          expect(prompt).not.toContain(forbidden);
        }
      }
    }
    // The lane that is not public-only still receives the evidence.
    expect(tasks.find((row) => row.name === "angle_02")?.task).toContain("usb-pd 0/6");
  });

  it("blinds an independent pair only when both sides launch", () => {
    const result = launch(
      snapshot(),
      "--notes",
      notes("## angle_05\nThe correctnessModel identity moved.\n\n## angle_06\nChallenge it.\n"),
    );
    const tasks = result.tasks();

    expect(result.status).toBe(0);
    expect(tasks[0]?.task).toContain("blinded counterpart of `angle_06`");
    expect(tasks[1]?.task).toContain("blinded counterpart of `angle_05`");
  });

  it("keeps grouped angle headings when adding direction to selected sessions", () => {
    const result = launch(
      snapshot(),
      "--sessions",
      "4,10+16,mechanism",
      "--transport",
      "native",
      "--notes",
      notes("## angles_10_16\nFollow the selected-axis transition.\n"),
    );
    const tasks = result.tasks();

    expect(result.status).toBe(0);
    expect(tasks.map((task) => task.name)).toEqual(["angle_04", "angles_10_16", "mechanism"]);
    expect(tasks[1]?.task).toContain("assignedAngles: 10, 16");
    expect(tasks[1]?.task).toContain("Follow the selected-axis transition.");
    expect(tasks[1]?.task).toContain("each headed exactly `## angle_NN`");
    expect(tasks[1]?.task).not.toContain("expectedHeading: ## angles_10_16");
    expect(tasks[2]?.task).toContain("expectedHeading: ## mechanism");
    expect(existsSync(join(result.out, "prompts", "angles_10_16.md"))).toBe(true);
  });

  it("builds nine auto sessions without joining a blinded pair", () => {
    const result = launch(snapshot(), "--auto", "9", "--transport", "native", "--notes", notes(""));
    const tasks = result.tasks();

    expect(result.status).toBe(0);
    expect(tasks).toHaveLength(9);
    expect(result.task("angle_36")?.task).toContain("assignedAngles: 36");
    // The private packet reaches its own lane and no other.
    expect(result.task("angle_15")?.task).toContain("Private angle 15 trace evidence");
    expect(
      tasks
        .filter((task) => task.name !== "angle_15")
        .every((task) => !task.task.includes("Private angle 15 trace evidence")),
    ).toBe(true);
    for (const [left, right] of [
      [5, 6],
      [7, 8],
      [19, 20],
    ]) {
      expect(
        tasks.some((task) => task.task.includes(`**${left}.`) && task.task.includes(`**${right}.`)),
      ).toBe(false);
    }
    expect(result.prompt(tasks[0]!.name)).toContain("# Your assignment");
  });

  it("keeps a deterministic session declared inside the catalogue out of the angle it precedes", () => {
    const angles = editedCatalogue((text) =>
      text.replace(
        "**22. Fact grounding of Builder-authored domain knowledge.**",
        "**session 30 (exhaustive). Deterministic counter reconciliation.** Not a model session.\n\n**22. Fact grounding of Builder-authored domain knowledge.**",
      ),
    );
    const selected = launch(
      snapshot(),
      "--angles",
      angles,
      "--notes",
      notes("## angle_21\nCheck the climb meaning.\n"),
    );

    expect(selected.status).toBe(0);
    expect(selected.tasks()).toHaveLength(1);
    expect(selected.tasks()[0]?.task).toContain("Between-battery meaning of a climb");
    for (const leak of [
      "session 30",
      "Deterministic counter reconciliation",
      "Fact grounding of Builder-authored domain knowledge",
    ]) {
      expect(selected.tasks()[0]?.task).not.toContain(leak);
    }

    const auto = launch(
      snapshot(),
      "--auto",
      "40",
      "--diagnostics",
      "--stress",
      "--angles",
      angles,
      "--notes",
      notes(""),
    );
    expect(auto.status).toBe(0);
    expect(auto.tasks()).toHaveLength(42);
    expect(auto.task("angle_36")?.task).toContain("Before reading verifier source");
    expect(auto.task("angle_21")?.task).toContain("Between-battery meaning of a climb");
    expect(auto.task("angle_21")?.task).not.toContain("session 30");
  });

  it("composes one self-contained prompt per lane for the codex transport and prints its launch", () => {
    const result = launch(snapshot(), "--auto", "4", "--effort", "max", "--transport", "codex");
    const rows = result.tasks("codex-tasks.json");
    const instructions = result.instructions().trim();

    expect(result.status).toBe(0);
    expect(rows.map((row) => row.name)).toEqual([
      "angles_group1of4",
      "angles_group2of4",
      "angles_group3of4",
      "angles_group4of4",
    ]);
    for (const row of rows) {
      expect(row.task.startsWith(instructions)).toBe(true);
      expect(row.task.endsWith("Authority: read-only. Do not edit files or change external state.")).toBe(
        true,
      );
    }
    expect(result.stdout).toContain("codex-sessions.mjs launch --tasks-file");
    expect(result.stdout).toContain("--model gpt-5.6-luna --effort max");
  });

  it("launches from an incomplete snapshot and names each failed view with its captured error", () => {
    // A failed view is not a fact, and hiding the whole review behind it made the reviewer write
    // the instruction packet by hand. The sessions are told which view failed and why.
    const snap = snapshot({ complete: false });
    snap.recapture(
      "run-1-scan",
      "COMMAND FAILED: outcome /campaigns/demo run-1 --scan\n\nerror: terminal.json: battery run-1-i03 has no record at any derived path\n",
      "failed",
    );

    const result = launch(snap, "--notes", notes("## mechanism\nsomething\n"));
    expect(result.status).toBe(0);
    expect(result.instructions()).toContain(
      "- `run-1-scan` (failed): error: terminal.json: battery run-1-i03 has no record at any derived path",
    );
    expect(result.instructions()).not.toContain("- `run-1-scan`\n");
  });
});

describe("what a launch refuses", () => {
  it("refuses a launch with no orientation, and one that is longer than the contract", () => {
    const missing = launch(snapshot(), "--notes", notes("## angle_05\nusb-pd is 0/6.\n", ""));
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("no `## orientation` block");

    const long = `## orientation\n${Array.from({ length: 21 }, (_, i) => `${i + 1}. a fact.`).join("\n")}\n\n`;
    const overLength = launch(snapshot(), "--notes", notes("## angle_05\nusb-pd is 0/6.\n", long));
    expect(overLength.status).toBe(2);
    expect(overLength.stderr).toContain("carries 21 lines");
    expect(existsSync(overLength.out)).toBe(false);
  });

  it("reports every refusal at once and writes nothing", () => {
    const session = declaredSession();
    const result = launch(
      snapshot(),
      "--notes",
      notes(
        `## row_E\nsettle from preflight\n\n## angle_99\ntypo\n\n## ${session}\n\n## custom:${session}\nx\n`,
      ),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("row E is settled by deterministic preflight");
    expect(result.stderr).toContain("unknown session `angle_99`");
    expect(result.stderr).toContain(`\`${session}\` has no direction`);
    expect(result.stderr).toContain("collides with the declared session");
    expect(existsSync(result.out)).toBe(false);
  });

  it("refuses grouping that crosses a blinded pair or an isolated lane", () => {
    const result = launch(snapshot(), "--sessions", "7-9,14+15,32+36");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("blinded pair angle_07 and angle_08 cannot share one session");
    expect(result.stderr).toContain("angle 15 carries the private trace-challenge packet");
    expect(result.stderr).toContain("angle 36 derives its valid-alternative corpus");
    expect(existsSync(result.out)).toBe(false);
  });

  it("refuses a misspelled flag and a relative --out before reading anything", () => {
    const misspelled = launch(snapshot(), "--sesions", "4");
    expect(misspelled.status).toBe(2);
    expect(misspelled.stderr).toContain('unknown option "--sesions"');

    const relative = launch(null, "--snapshot", "/x", "--worktree", "/x", "--out", "rel", "--sessions", "4");
    expect(relative.status).toBe(2);
    expect(relative.stderr).toContain("--out must be an absolute path");
  });

  it("rejects an auto review below the four-session independence minimum", () => {
    const result = launch(snapshot(), "--auto", "3", "--notes", notes(""));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("at least 4 semantic sessions");
    expect(existsSync(result.out)).toBe(false);
  });

  it("requires a verified private packet when angle 15 is admitted", () => {
    const snap = snapshot();
    rmSync(join(snap.dir, "trace-challenge"), { recursive: true, force: true });

    const result = launch(snap, "--notes", notes("## angle_15\nInspect recurring solver traces.\n"));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("angle 15 is assigned but its trace-challenge status is missing");
  });

  it("refuses a snapshot taken with a Bun the measured worktree does not pin", () => {
    const result = launch(snapshot({ runtime: "0.0.0" }), "--notes", notes("## mechanism\nsomething\n"));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`absolute Bun ${PINNED_BUN_VERSION} executable`);
    expect(result.stderr).toContain("received 0.0.0");
  });

  it("refuses snapshot bytes changed after trace-review froze their digest", () => {
    const snap = snapshot();
    snap.corrupt("run-1-default.txt", "{}\n");

    const result = launch(snap, "--notes", notes("## mechanism\nsomething\n"));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("run-1-default byte count drifted");
  });

  it("refuses a complete flag that omits one required deterministic view", () => {
    const snap = snapshot();
    snap.amend((status) => {
      status.views = status.views.filter((view) => view.label !== "run-1-cases-non-result");
    });

    const result = launch(snap, "--notes", notes("## mechanism\nsomething\n"));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("missing required views: run-1-cases-non-result");
  });

  it("refuses a snapshot that names multiple runs or a stale source revision", () => {
    const multi = snapshot();
    multi.amend((status) => {
      status.runIds = ["run-1", "run-2"];
    });
    const multiResult = launch(multi, "--notes", notes("## angle_05\nrun identity.\n"));
    expect(multiResult.status).toBe(2);
    expect(multiResult.stderr).toContain("exactly one concrete runId");

    const stale = snapshot();
    stale.amend((status) => {
      status.source.commit = "e".repeat(40);
    });
    const staleResult = launch(
      stale,
      "--revision",
      "e".repeat(40),
      "--notes",
      notes("## angle_05\nrun identity.\n"),
    );
    expect(staleResult.status).toBe(2);
    expect(staleResult.stderr).toContain("differs from worktree HEAD");
  });
});
