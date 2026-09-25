import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { uppercaseFixture } from "./helpers/uppercase-fixture.ts";
import { REPO_ROOT, runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.mjs";

let scratch;
let candidate;

function run(args) {
  return runTypeScript("host-panel.mts", args);
}

function panel(name, value) {
  const path = join(scratch, `${name}.json`);
  writeFileSync(path, JSON.stringify({ schema: "host-panel/v1", ...value }));
  return path;
}

function report(out) {
  return JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
}

beforeEach(() => {
  mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
  scratch = mkdtempSync(join(REPO_ROOT, ".scratch", "host-panel-test-"));
  candidate = join(scratch, "candidate");
  // The fixture writes into an initialised workspace, which already carries agent/.
  mkdirSync(join(candidate, "agent"), { recursive: true });
  uppercaseFixture(candidate);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("host-panel", () => {
  it("grades valid, equivalent and hostile artifacts through the production control runner", () => {
    const out = join(scratch, "positive");
    const path = panel("positive", {
      accept: [
        { id: "valid", artifact: { fromControl: "accept-1" } },
        { id: "equivalent", artifact: { answer: "AB" } },
      ],
      reject: [
        {
          id: "lowercase",
          mutationClass: "case",
          expectedCheckId: "answer",
          artifact: { fromControl: "accept-1", patch: [{ path: "answer", replace: "AB", with: "ab" }] },
        },
      ],
    });
    const result = run(["--candidate", candidate, "--task", "t1", "--panel", path, "--out", out]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      "valid expected=accept outcome=verified-pass",
      "equivalent expected=accept outcome=verified-pass",
      "lowercase expected=reject outcome=verified-fail blocking=answer",
    ]);
    const written = report(out);
    expect(written.schema).toBe("host-panel-report/v1");
    expect(written.taskId).toBe("t1");
    expect(written.disagreements).toEqual([]);
    expect(
      written.rows.map((row) => [row.id, row.fromControl, row.publicSchemaAccepted, row.outcome]),
    ).toEqual([
      ["valid", "accept-1", true, "verified-pass"],
      ["equivalent", null, true, "verified-pass"],
      ["lowercase", "accept-1", true, "verified-fail"],
    ]);
    expect(written.rows[2].blockingCheckIds).toEqual(["answer"]);
    expect(written.rows[2].receipt.expectedCheckId).toBe("answer");
    expect(written.control.claimable).toBe(true);
    expect(written.control.rejectsAttributed).toBe(1);
    expect(written.fingerprint.unchanged).toBe(true);
    expect(written.pendingReceipts).toEqual([]);
    expect(written.hostEvidence).toEqual([]);
    expect(written.tools).toEqual({});
  });

  it("reports a row that disagrees with its expected side and exits 1", () => {
    const out = join(scratch, "hostile");
    const path = panel("hostile", { accept: [{ id: "lowercase-as-valid", artifact: { answer: "ab" } }] });
    const result = run(["--candidate", candidate, "--task", "t1", "--panel", path, "--out", out]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toBe(
      "lowercase-as-valid expected=accept outcome=verified-fail DISAGREES blocking=answer",
    );
    const written = report(out);
    expect(written.disagreements).toEqual(["lowercase-as-valid"]);
    expect(written.rows[0].agrees).toBe(false);
    expect(written.pendingReceipts).toEqual([]);
  });

  it("reports a reject whose declared check the candidate lacks and exits 1", () => {
    // The census runs only a reject's declared check, so an absent one leaves nothing to run and
    // settles as a thrown evaluation; the answer check that would fail on it never runs.
    const out = join(scratch, "wrong-check");
    const path = panel("wrong-check", {
      reject: [
        {
          id: "wrong-check",
          mutationClass: "case",
          expectedCheckId: "format",
          artifact: { fromControl: "accept-1", patch: [{ path: "answer", replace: "AB", with: "ab" }] },
        },
      ],
    });
    const result = run(["--candidate", candidate, "--task", "t1", "--panel", path, "--out", out]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toBe(
      "wrong-check expected=reject outcome=non-result:verifier-throw DISAGREES",
    );
    expect(report(out).disagreements).toEqual(["wrong-check"]);
  });

  it("marks a public-schema refusal as unaccepted without reaching the verifier", () => {
    // The check would accept a singleton array, but the public schema compiled from the accept
    // corpus binds the string shape: production refuses it before the verifier, and so does the panel.
    const out = join(scratch, "unaccepted");
    const path = panel("unaccepted", { accept: [{ id: "singleton-array", artifact: { answer: ["AB"] } }] });
    const result = run(["--candidate", candidate, "--task", "t1", "--panel", path, "--out", out]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toBe("singleton-array expected=accept outcome=unaccepted DISAGREES");
    const written = report(out);
    expect(written.rows[0].publicSchemaAccepted).toBe(false);
    expect(written.rows[0].receipt).toBeNull();
    expect(written.control).toBeNull();
  });

  it("refuses a patch whose replace text is absent before any host work", () => {
    const out = join(scratch, "drift");
    const path = panel("drift", {
      reject: [
        {
          id: "drifted",
          mutationClass: "case",
          expectedCheckId: "answer",
          artifact: { fromControl: "accept-1", patch: [{ path: "answer", replace: "ZZ", with: "ab" }] },
        },
      ],
    });
    const result = run(["--candidate", candidate, "--task", "t1", "--panel", path, "--out", out]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('patch text "ZZ" is absent from answer');
    expect(existsSync(out)).toBe(false);
  });

  it("refuses a control bound to another task, an unknown task and a used destination", () => {
    const out = join(scratch, "used");
    const wrongTask = panel("wrong-task", { accept: [{ id: "x", artifact: { fromControl: "accept-0" } }] });
    const bound = run(["--candidate", candidate, "--task", "t1", "--panel", wrongTask, "--out", out]);
    expect(bound.exitCode).toBe(2);
    expect(bound.stderr).toContain("control accept-0 is bound to task t0, not t1");
    const unknown = run(["--candidate", candidate, "--task", "t9", "--panel", wrongTask, "--out", out]);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr).toContain("task t9 is not in the candidate's tasks.json");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "report.json"), "{}");
    const used = run(["--candidate", candidate, "--task", "t1", "--panel", wrongTask, "--out", out]);
    expect(used.exitCode).toBe(2);
    expect(used.stderr).toContain("already holds a report.json");
  });
});
