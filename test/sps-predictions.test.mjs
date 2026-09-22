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
import { REPO_ROOT, runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.mjs";

let scratch;
let note;

const NOTE = `# Conditions on deadbeef

P1 — The opening names source deadbeef. Falsifier: another sha.
P2 — (expected to fail) Every case row carries an instant.
R3 — The selector chooses rebuild.
`;

function run(...args) {
  return runTypeScript("predictions.mts", ["--file", note, ...args]);
}

beforeEach(() => {
  mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
  scratch = mkdtempSync(join(REPO_ROOT, ".scratch", "predictions-test-"));
  note = join(scratch, "predictions.md");
  writeFileSync(note, NOTE);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("predictions", () => {
  it("records a checksum for the pre-registered part and lists every declared row", () => {
    const hashed = run("--hash");
    expect(hashed.exitCode).toBe(0);
    expect(hashed.stdout).toMatch(/^[0-9a-f]{64}  3 row\(s\): P1 P2 R3 \(projection checksum\)\n$/);
    expect(readFileSync(`${note}.sha256`, "utf8")).toMatch(/^[0-9a-f]{64}  .*\n$/);
    const open = run("--unresolved");
    expect(open.exitCode).toBe(1);
    expect(open.stdout).toBe("UNRESOLVED: P1 P2 R3\n");
  });

  it("appends a resolution under its own heading and keeps the checksum valid", () => {
    run("--hash");
    const first = run("--resolve", "P2: refuted — 25 of 25 rows carry no instant");
    expect(first.exitCode).toBe(0);
    const second = run("--resolve", "P1: sufficed — opening.json names deadbeef");
    expect(second.exitCode).toBe(0);
    const text = readFileSync(note, "utf8");
    expect(text).toContain("\n## Resolutions (appended from ");
    expect(
      text.endsWith(
        "- P2: refuted — 25 of 25 rows carry no instant\n- P1: sufficed — opening.json names deadbeef\n",
      ),
    ).toBe(true);
    expect(run("--verify").exitCode).toBe(0);
    const open = run("--unresolved");
    expect(open.exitCode).toBe(1);
    expect(open.stdout).toBe("UNRESOLVED: R3\n");
  });

  it("refuses a resolution when the pre-registered part was edited after its checksum was recorded", () => {
    run("--hash");
    writeFileSync(note, NOTE.replace("deadbeef. Falsifier", "cafebabe. Falsifier"));
    const refused = run("--resolve", "P1: sufficed — now it says cafebabe");
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain("changed after its checksum was recorded");
    expect(readFileSync(note, "utf8")).not.toContain("## Resolutions");
  });

  it("refuses even a close-like unresolved read after the pre-registered part drifts", () => {
    run("--hash");
    writeFileSync(note, NOTE.replace("deadbeef. Falsifier", "cafebabe. Falsifier"));
    const refused = run("--unresolved");
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain("changed after its checksum was recorded");
  });

  it("refuses to hash a note whose rows the parser cannot read", () => {
    writeFileSync(note, NOTE.replace(/^([A-Z]\d) — /gm, "- $1: "));
    const refused = run("--hash");
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain('"P1 — <prediction>"');
    expect(existsSync(`${note}.sha256`)).toBe(false);
  });

  it("does not replace a frozen projection checksum after the outcome", () => {
    run("--hash");
    const changed = NOTE.replace("P1 — The opening", "P1 — A changed opening");
    writeFileSync(note, changed);
    const refused = run("--hash");
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain("changed after its checksum was recorded");
    expect(run("--unresolved").exitCode).toBe(2);
  });

  it("allows honest inconclusive and untriggered closures but not pending", () => {
    run("--hash");
    expect(run("--resolve", "P1: inconclusive — provider returned no deciding evidence").exitCode).toBe(0);
    expect(run("--resolve", "P2: untriggered — no eligible transition").exitCode).toBe(0);
    const pending = run("--resolve", "R3: pending — the run is still open");
    expect(pending.exitCode).toBe(2);
    expect(pending.stderr).toContain("inconclusive");
    expect(readFileSync(note, "utf8")).not.toContain("- R3:");
  });

  it("refuses a second or overlapping resolution and preserves the first decision", () => {
    run("--hash");
    expect(run("--resolve", "P1: sufficed — the opening matched").exitCode).toBe(0);
    const before = readFileSync(note, "utf8");
    const contradictory = run("--resolve", "P1: refuted — the next opening drifted");
    expect(contradictory.exitCode).toBe(2);
    expect(contradictory.stderr).toContain("already has a resolution");
    expect(contradictory.stderr).toContain("immutable successor");
    expect(readFileSync(note, "utf8")).toBe(before);

    expect(run("--resolve", "P2: partial — one row held").exitCode).toBe(0);
    const overlap = run("--resolve", "P1–P2: refuted — the range was later reconsidered");
    expect(overlap.exitCode).toBe(2);
    expect(overlap.stderr).toContain("P1 already has a resolution");
    expect(readFileSync(note, "utf8")).toBe(`${before}- P2: partial — one row held\n`);
  });

  it("rejects a manually appended contradictory row on every later ledger read", () => {
    run("--hash");
    expect(run("--resolve", "P1: sufficed — the opening matched").exitCode).toBe(0);
    writeFileSync(note, `${readFileSync(note, "utf8")}- P1: refuted — a later editor tried to reverse it\n`);
    const verify = run("--verify");
    expect(verify.exitCode).toBe(2);
    expect(verify.stderr).toContain("more than one resolution");
    expect(run("--unresolved").stderr).toContain("more than one resolution");
  });

  it("reads a hand-written stem checksum beside the note", () => {
    run("--hash");
    const checksum = readFileSync(`${note}.sha256`, "utf8");
    rmSync(`${note}.sha256`);
    writeFileSync(note.replace(/\.md$/, ".sha256"), checksum);
    expect(run("--verify").exitCode).toBe(0);
  });

  it("refuses an undeclared row, a malformed verdict and a missing checksum", () => {
    expect(run("--resolve", "P1: sufficed — no checksum yet").stderr).toContain("run --hash before");
    run("--hash");
    expect(run("--resolve", "P9: sufficed — nobody declared P9").stderr).toContain("not a declared row");
    expect(run("--resolve", "P1 passed").stderr).toContain(
      "sufficed|partial|refuted|untriggered|inconclusive",
    );
    expect(run("--accept-broken-checksum").stderr).toContain("unknown option");
    expect(run("--hash", "--verify").stderr).toContain("exactly one of");
  });

  it("reads a range resolution as covering every row in it", () => {
    run("--hash");
    writeFileSync(note, `${NOTE}\n## Resolutions\n\n- P1–P2: sufficed — both held.\n`);
    const open = run("--unresolved");
    expect(open.stdout).toBe("UNRESOLVED: R3\n");
  });
});
