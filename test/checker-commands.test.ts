// Phase C's commands, run as the operator runs them over a campaign's drafted exam: two tasks and
// one check, with the draft's controls. The verifier runs behind its wall, so those suites are
// skipped where the host has none.
import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { read } from "../src/kernel/log.ts";
import { taskSets } from "../src/kernel/task.ts";
import { rmSync } from "../src/meta/filesystem.ts";
import { isString } from "../src/meta/json-shape.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { osIsolationSupport } from "../src/wall/os-isolation.ts";
import { fixtureDraft, fixtureTasks, layOutDraft } from "./helpers/fixture-pack.ts";
import { anyOf, matching, objectWith } from "./helpers/matchers.ts";

const REPO = resolve(import.meta.dir, "..");
/** A campaign's log, by its name in the campaign's folder. */
const LOG = "log.jsonl";
/** The fixture's one check is its author's own computation, which stands on the operator's word. */
const ADMIT = { admit: "check-product" };
/** An answer format whose pattern the empty answer misses. */
const DIGITS = {
  type: "object",
  properties: { answer: { type: "string", pattern: "^[0-9]+$" } },
  required: ["answer"],
};
const NAME = `test-check-${String(runtimeProcess.pid)}`;
const TASKS = fixtureTasks(2);
/** The campaign whose checker reading is recorded. */
const ACCEPTED = `${NAME}-accepted`;
/** Campaigns whose drafts hold something wrong: a reject control that is a right answer, and an
 *  accept control gone stale. */
const MISLABELLED = `${NAME}-mislabelled`;
const STALE = `${NAME}-stale`;
/** A campaign whose answer format holds a pattern the smallest value its schema yields misses. */
const UNFORMED = `${NAME}-unformed`;
/** The campaign a rehearsal is seeded from, and the seed it walks. */
const SOURCE = `${NAME}-source`;
const SEED = `sim-${NAME}`;
const NAMES = [ACCEPTED, MISLABELLED, STALE, UNFORMED, SOURCE, SEED];
const folder = (name: string) => join(REPO, ".ana", "d2", name);

const suite = describe.skipIf(!osIsolationSupport().ok);

setDefaultTimeout(180_000);

afterAll(() => {
  for (const name of NAMES) rmSync(folder(name), { recursive: true, force: true });
});

const DRAFT = fixtureDraft(TASKS);
layOutDraft(folder(ACCEPTED), DRAFT);
layOutDraft(folder(MISLABELLED), {
  ...DRAFT,
  reject: [{ task: 0, answer: { answer: "12" }, check: "check-product" }],
});
layOutDraft(folder(STALE), {
  ...DRAFT,
  accept: [DRAFT.accept[0] ?? { task: 0, answer: {} }, { task: 1, answer: { answer: "19" } }],
});
layOutDraft(folder(UNFORMED), { ...DRAFT, answerFormat: DIGITS });
layOutDraft(folder(SOURCE), DRAFT);

/** A command as the operator runs it: its exit code and everything it printed. `bare` are flags
 *  that take no value. */
function command(file: string, flags: Record<string, string>, ...bare: string[]) {
  const args = Object.entries(flags).flatMap(([flag, value]) => [`--${flag}`, value]);
  const ran = Bun.spawnSync({ cmd: [capturedExecPath, file, ...args, ...bare], cwd: REPO });
  return { code: ran.exitCode, said: `${ran.stdout.toString()}${ran.stderr.toString()}` };
}

const accept = (name: string, flags: Record<string, string> = ADMIT, ...bare: string[]) =>
  command("tools/c/accept.ts", { name, ...flags }, ...bare);
/** What a campaign's log holds of one kind. */
const held = (name: string, kind: string) =>
  read(join(folder(name), LOG)).flatMap((event) => (event.kind === kind ? [event.data] : []));

suite("acceptance and freezing over a drafted exam", () => {
  it("records a checker's reading, and names the control that does not get its label", () => {
    const sound = accept(ACCEPTED);
    expect(sound.said).toContain("check-product\tauthor\t2\t1\t1 of 1");
    // The smallest answer the format allows is put to both tasks, and the check rejects it on each.
    expect(sound.said).toMatch(/\{"answer":""\}.*rejected.*2 of 2/u);
    expect(sound.code).toBe(0);
    expect(held(ACCEPTED, "checker.read")).toMatchObject([
      {
        controls: 3,
        rows: [objectWith({ passed: 2, refused: 1 })],
        doNothing: { answer: { answer: "" }, tasks: 2, rejected: 2 },
        admitted: ["check-product"],
        faults: [],
      },
    ]);

    // Without the operator's word the same check is a fault, and a check nobody wrote is no word.
    const unadmitted = accept(ACCEPTED, {});
    expect(unadmitted.said).toMatch(/fault: check-product.*--admit check-product/u);
    expect(unadmitted.code).toBe(1);
    // A campaign without `--hitl` gives that word for every check its author decides.
    expect(accept(ACCEPTED, {}, "--admit-authored").code).toBe(0);
    expect(held(ACCEPTED, "checker.read").at(-1)).toMatchObject({ admitted: ["check-product"], faults: [] });
    expect(accept(ACCEPTED, { admit: "check-nobody" }).said).toMatch(/--admit.*check-nobody.*no such check/u);

    // A reject control whose answer is still right: the check it names lets it pass, and the
    // operator's word does not freeze a checker read so.
    const mislabelled = accept(MISLABELLED, ADMIT, "--freeze");
    const fault = /reject control.*ex-001.*check-product.*pass/u;
    expect(mislabelled.said).toMatch(fault);
    expect(mislabelled.said).toContain("not frozen");
    expect(mislabelled.code).toBe(1);
    expect(held(MISLABELLED, "checker.read").at(-1)?.faults).toContainEqual(matching(fault));
    expect(held(MISLABELLED, "contract.frozen")).toEqual([]);
  });

  it("refuses to freeze over a stale accept control, and freezes over it on the operator's word", () => {
    const refused = accept(STALE, ADMIT, "--freeze");
    expect(refused.said).toMatch(/fault:.*accept control.*ex-002.*fail check-product/u);
    expect(refused.code).toBe(1);
    expect(held(STALE, "contract.frozen")).toEqual([]);
    const given = accept(STALE, { ...ADMIT, despite: "the accept control of ex-002 is stale" }, "--freeze");
    expect(given.said).toMatch(/frozen.*1 fault.*contract/u);
    expect(given.code).toBe(0);
    expect(held(STALE, "contract.frozen")).toMatchObject([
      { despite: "the accept control of ex-002 is stale", faults: 1 },
    ]);
  });

  it("notes a do-nothing answer the format refuses, and freezes over it", () => {
    const unformed = accept(UNFORMED, ADMIT, "--freeze");
    expect(unformed.said).toMatch(/note:.*do-nothing.*\{"answer":""\}.*answer format/u);
    expect(unformed.said).toContain("no fault");
    expect(unformed.code).toBe(0);
    expect(held(UNFORMED, "contract.frozen")).toHaveLength(1);
    expect(held(UNFORMED, "checker.read").map(({ faults }) => faults)).toEqual([[]]);
  });
});

suite("rehearsal over a drafted exam", () => {
  // A checkpoint as its commands walk it: two Builder sessions, each with no comparison after it,
  // and then one comparison of what the second left, since a session runs outside a round too. A
  // script sits in every seat.
  it("rehearses two sessions and then one checkpoint over a seed", () => {
    const seeded = folder(SEED);
    // One of the exam's two tasks is released for practice, by the contract's draw, and one held out.
    const taken = command("tools/d2/prepare.ts", { name: SOURCE, practice: "1" });
    expect(taken.code).toBe(0);
    expect(taskSets(read(join(folder(SOURCE), LOG)))).toMatchObject({
      held: [anyOf(String)],
      released: [anyOf(String)],
    });
    const cli = (...args: string[]) => {
      const ran = Bun.spawnSync({ cmd: [capturedExecPath, "tools/runs/cli.ts", ...args], cwd: REPO });
      return { code: ran.exitCode, said: `${ran.stdout.toString()}${ran.stderr.toString()}` };
    };
    expect(cli("seed", "--from", folder(SOURCE), "--name", SEED).code).toBe(0);
    const rehearse = (...more: string[]) => cli("rehearse", "--name", SEED, ...more);
    const of = (kind: string) => held(SEED, kind);

    // A comparison refused on its own terms leaves the log as it was. Were it to record the campaign's
    // setting first, a mistyped flag would go with it, and the corrected command would then be
    // refused as another setting.
    const lines = () => read(join(seeded, LOG)).length;
    const before = lines();
    expect(rehearse("--id", "g-0", "--target", "0").said).toMatch(/--target 0.*at least one/u);
    expect(lines()).toBe(before);
    expect(of("campaign.setting")).toEqual([]);

    for (const session of ["b-1", "b-2"]) {
      expect(rehearse("--no-comparison", "--session", session).code).toBe(0);
    }
    // Two sessions are on record, the second from what the first left, and nothing is compared.
    const [one, two] = of("build.finished");
    expect(of("build.started")).toMatchObject([{ session: "b-1" }, { session: "b-2", parent: one?.harness }]);
    expect([one?.changed, two?.changed]).toEqual([true, true]);
    expect(two?.harness).not.toBe(one?.harness);
    expect(of("comparison.started")).toEqual([]);
    expect(of("solve.started")).toEqual([]);
    // The first command of the campaign recorded its setting, and the second ran under the record.
    expect(of("campaign.setting")).toHaveLength(1);

    // Then the one comparison: the harness the last session left against the reference harness,
    // which is the starter. One held-out task reads no step; what is proven is the join.
    const compared = rehearse("--id", "g-1", "--new", "latest");
    expect(compared.code).toBe(0);
    expect(of("comparison.reported")).toMatchObject([
      { session: "g-1", fresh: two?.harness, reading: "no-step", scored: { wins: 1, losses: 0, ties: 0 } },
    ]);
    // A session that ended says what it left when it is asked for again, and runs nothing.
    const again = rehearse("--no-comparison", "--session", "b-2");
    expect(again.code).toBe(0);
    expect(again.said).toContain("b-2");
    expect(again.said).toContain(isString(two?.harness) ? two.harness : "missing harness");
    expect(of("build.started")).toHaveLength(2);

    // The campaign's view prints each step's handover. Of the moves, it names the table's alone.
    // It takes the campaign command's flags and no other, not a launch's.
    const viewed = cli("view", SEED, "--level", "0.02").said;
    expect(
      viewed.split("\n").filter((line) => line.includes("Builder session, finished: from")),
    ).toHaveLength(2);
    // Two solves a side, fixed, and the level 0.02 where nothing names another (`SIZE`).
    expect(viewed).toMatch(/1 task.*2 solves.*0\.02.*1 won.*0 lost.*0 tied.*no-step/u);
    expect(viewed).not.toContain("  a round");
    expect(cli("view", SEED, "--cap", "100").said).toContain("Unknown option '--cap'");
    // Fix row F26: the view's last line is the one move the decision table names, and the
    // campaign's own command, rehearsed and asked what it would do next, names the same. The move is
    // the line after the heading alone: a view run from an unpushed head warns after it which
    // published ancestor its remote reads use.
    const tabled = (
      viewed
        .slice(viewed.indexOf("the table's move\n") + "the table's move\n".length)
        .trim()
        .split("\n")[0] ?? ""
    ).trim();
    expect(tabled).toContain(": ");
    // At 0.02 the default patience holds the bound an opening may risk (`openingLines`).
    const terms = ["--project", "fixture", "--level", "0.02"];
    expect(rehearse(...terms, "--dry-run").said).toContain(`next · ${tabled}`);
  });
});
