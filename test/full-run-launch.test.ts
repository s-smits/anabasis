/**
 * What a paid run may start as, and who may start it. A flag parsed wrongly does not fail the run:
 * it measures a different condition and records it as the intended one, so every refusal here has
 * to arrive before the first paid call. `parseFullRunArgs` reads the operator's argv,
 * `slugForDirectInput` names the campaign the evidence joins, and `lockHolderState` decides whether
 * another controller still owns it — where undeterminable must never read as dead, since breaking a
 * live controller's lock puts two controllers on one campaign.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { hostname, tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { type LockHolderState, lockHolderState, lockToken } from "../src/run/campaign-lock.ts";
import { type FullRunArgs, parseFullRunArgs } from "../src/run/launch-arguments.ts";
import { slugForDirectInput } from "../src/run/launch-project.ts";
import { errorMessage } from "../src/meta/runtime-values.ts";

const MIN = ["--prompt", "Design steel connections", "--provider-turn-budget", "12"];
const COMMIT = "a".repeat(40);
const DIGEST = "b".repeat(64);

describe("the condition an operator may ask for", () => {
  it.each<[string[], Partial<FullRunArgs>]>([
    [[], { prompt: "Design steel connections", providerTurnBudget: 12, dcg: true }],
    [["--dcg", "false"], { dcg: false }],
    [["--context", "a.md", "--context", "b.md"], { contextPaths: ["a.md", "b.md"] }],
    [["--iteration-budget", "none"], { turnBudget: null }],
    [["--iteration-budget", "4"], { turnBudget: 4 }],
    [["--product-policy", "fixed"], { productPolicy: "fixed" }],
    [
      ["--expected-source", `${COMMIT}:${DIGEST}`],
      { expectedSource: { commit: COMMIT, sourceDigest: DIGEST } },
    ],
  ])("reads %j", (extra, expected) => {
    expect(parseFullRunArgs([...MIN, ...extra])).toMatchObject(expected);
  });

  it.each<[string[], string]>([
    [[...MIN, "--project", "x", "--project", "y"], "only once"],
    [["--prompt", "   ", "--provider-turn-budget", "1"], "--prompt"],
    [[...MIN, "--project"], "missing value"],
    ...["0", "-1", "1.5", " 2", "2 ", "1e3", "0x2", ""].map((value): [string[], string] => [
      ["--prompt", "p", "--provider-turn-budget", value],
      "positive integer",
    ]),
    [[...MIN, "--iteration-budget", "all"], "positive integer"],
    [[...MIN, "--product-policy", "open"], "expected fixed"],
    ...["1", "yes", "TRUE", ""].map((value): [string[], string] => [
      [...MIN, "--dcg", value],
      "true | false",
    ]),
    // The digest is compared byte for byte against the recorded identity, so an uppercase spelling
    // accepted here would mismatch at launch, after the composed gate has already run.
    ...["abc", `${COMMIT}:${"b".repeat(63)}`, `${"A".repeat(40)}:${DIGEST}`, COMMIT].map(
      (value): [string[], string] => [[...MIN, "--expected-source", value], "--expected-source"],
    ),
    [[...MIN, "--max-turns", "8"], "--max-builder-turns"],
    [[...MIN, "--turn-budget", "8"], "--iteration-budget"],
    [[...MIN, "--tasks", "25"], "unknown flag --tasks"],
    [[...MIN, "--tasks", "25"], "--provider-turn-budget"],
  ])("refuses %j, naming %s", (argv, named) => {
    let message: string | undefined;
    try {
      parseFullRunArgs(argv);
    } catch (error) {
      message = errorMessage(error);
    }
    expect(message).toContain(named);
  });
});

describe("the project a run's evidence joins", () => {
  it.each([
    ["Design lightweight steel trusses around irregular supports", "design-lightweight-steel-trusses-"],
    ["Build a harness for the task of welding", "welding-"],
    ["build the task with this agent", "request-"],
  ])("keeps the first four words that say something: %s", (prompt, head) => {
    expect(slugForDirectInput(prompt, "d")).toStartWith(head);
  });

  it("ends in eight digest characters, one slug per request and context", () => {
    const a = slugForDirectInput("Design steel trusses", "ctx-1");
    const b = slugForDirectInput("Design steel trusses", "ctx-2");
    expect(a).not.toBe(b);
    expect(a.slice(0, -8)).toBe(b.slice(0, -8));
    expect(slugForDirectInput("Design steel trusses", "ctx-1")).toBe(a);
  });

  it("leaves no dangling separator when the length ceiling cuts on a word boundary", () => {
    // Three fifteen-character words put a separator exactly at the 48-character cut.
    expect(slugForDirectInput("aaaaaaaaaaaaaaa bbbbbbbbbbbbbbb ccccccccccccccc ddddd", "d")).not.toContain(
      "--",
    );
  });
});

describe("whether another controller still owns the campaign", () => {
  const dir = mkdtempSync(join(tmpdir(), "ana-launch-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  let files = 0;
  /** A lock file holding exactly these bytes, or no file at all. */
  const lockFile = (contents: string | null): string => {
    const path = join(dir, `lock-${files++}.json`);
    if (contents !== null) writeFileSync(path, contents);
    return path;
  };
  const here = (record: { pid: unknown; startTime?: string }) =>
    JSON.stringify({ hostname: hostname(), ...record });

  // `null`, `3`, `"held"` and `[]` all parse, and a reader that asserted them to be a lock record
  // threw on them instead of answering undeterminable.
  it.each<[string, string | null, string | null, LockHolderState]>([
    ["a missing lock", null, null, "absent"],
    ["this very process", here({ pid: process.pid }), null, "held"],
    ["a pid above every default pid ceiling", here({ pid: 4194304 }), null, "proved-dead"],
    [
      "a pid reused by a process that started later",
      here({ pid: process.pid, startTime: "Thu Jan  1 00:00:00 1970" }),
      null,
      "proved-dead",
    ],
    [
      "another host's lock, whatever its pid says here",
      JSON.stringify({ pid: 4194304, hostname: `${hostname()}-elsewhere` }),
      null,
      "held",
    ],
    ["an unparseable lock", "{not json", "unreadable", "unreadable"],
    ...["null", "3", '"held"', "[]"].map((bytes): [string, string, string, LockHolderState] => [
      `a lock body of ${bytes}`,
      bytes,
      "unreadable",
      "unreadable",
    ]),
    ["a lock with a token and no pid", '{"token":"abc"}', "abc", "held"],
    ["an empty token", '{"token":""}', null, "held"],
    ...[0, -1, 1.5, "abc", null].map((pid): [string, string, null, LockHolderState] => [
      `a pid of ${JSON.stringify(pid)}`,
      here({ pid }),
      null,
      "held",
    ]),
  ])("reads %s", (_name, contents, unreadableToken, holder) => {
    const path = lockFile(contents);
    expect(lockHolderState(path)).toBe(holder);
    // The launcher reads an unreadable lock as no token; the evidence reader asks for a sentinel.
    expect(lockToken(path)).toBe(unreadableToken === "unreadable" ? null : unreadableToken);
    expect(lockToken(path, "unreadable")).toBe(unreadableToken);
  });
});
