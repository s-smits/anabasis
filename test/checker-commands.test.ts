// Phase C's commands, run as the operator runs them over a campaign's drafted exam: two tasks and
// one check, with the draft's controls. The verifier runs behind its wall, so those suites are
// skipped where the host has none.
import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { append, read } from "../src/kernel/log.ts";
import { taskSets } from "../src/kernel/task.ts";
import { rmSync } from "../src/meta/filesystem.ts";
import { isString } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath, capturedSpawn, runtimeProcess } from "../src/meta/process.ts";
import { osIsolationSupport } from "../src/sandbox/os-isolation.ts";
import { fixtureDraft, fixtureTasks, layOutDraft } from "./helpers/fixture-pack.ts";
import { anyOf, matching, objectWith } from "./helpers/matchers.ts";

const REPO = resolve(import.meta.dir, "..");
const LOG = "log.jsonl";
const ADMIT = { admit: "check-product" };
const DIGITS = {
  type: "object",
  properties: { answer: { type: "string", pattern: "^[0-9]+$" } },
  required: ["answer"],
};
const NAME = `test-check-${String(runtimeProcess.pid)}`;
const TASKS = fixtureTasks(2);
const ACCEPTED = `${NAME}-accepted`;
/** Campaigns whose drafts hold something wrong: a reject control that is a right answer, and an
 *  accept control gone stale. */
const MISLABELLED = `${NAME}-mislabelled`;
const STALE = `${NAME}-stale`;
const UNFORMED = `${NAME}-unformed`;
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
async function command(file: string, flags: Record<string, string>, ...bare: string[]) {
  const args = Object.entries(flags).flatMap(([flag, value]) => [`--${flag}`, value]);
  const child = capturedSpawn([capturedExecPath, file, ...args, ...bare], {
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, said: `${out}${err}` };
}

const accept = (name: string, flags: Record<string, string> = ADMIT, ...bare: string[]) =>
  command("tools/eval/accept.ts", { name, ...flags }, ...bare);
const held = (name: string, kind: string) =>
  read(join(folder(name), LOG)).flatMap((event) => (event.kind === kind ? [event.data] : []));

suite("acceptance and freezing over a drafted exam", () => {
  it.concurrent("records a checker's reading, and names the control that does not get its label", async () => {
    const [sound, mislabelled] = await Promise.all([
      accept(ACCEPTED),
      accept(MISLABELLED, ADMIT, "--freeze"),
    ]);
    expect(sound.said).toContain("check-product\tauthor\t2\t1\t1 of 1");
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

    const unadmitted = await accept(ACCEPTED, {});
    expect(unadmitted.said).toMatch(/fault: check-product.*--admit check-product/u);
    expect(unadmitted.code).toBe(1);
    // A campaign without `--hitl` gives that word for every check its author decides.
    expect((await accept(ACCEPTED, {}, "--admit-authored")).code).toBe(0);
    expect(held(ACCEPTED, "checker.read").at(-1)).toMatchObject({ admitted: ["check-product"], faults: [] });
    expect((await accept(ACCEPTED, { admit: "check-nobody" })).said).toMatch(
      /--admit.*check-nobody.*no such check/u,
    );

    // A reject control whose answer is still right: the check it names lets it pass, and the
    // operator's word does not freeze a checker read so.
    const fault = /reject control.*ex-001.*check-product.*pass/u;
    expect(mislabelled.said).toMatch(fault);
    expect(mislabelled.said).toContain("not frozen");
    expect(mislabelled.code).toBe(1);
    expect(held(MISLABELLED, "checker.read").at(-1)?.faults).toContainEqual(matching(fault));
    expect(held(MISLABELLED, "contract.frozen")).toEqual([]);
  });

  it.concurrent("refuses to freeze over a stale accept control, and freezes over it on the operator's word", async () => {
    const refused = await accept(STALE, ADMIT, "--freeze");
    expect(refused.said).toMatch(/fault:.*accept control.*ex-002.*fail check-product/u);
    expect(refused.code).toBe(1);
    expect(held(STALE, "contract.frozen")).toEqual([]);
    const given = await accept(
      STALE,
      { ...ADMIT, despite: "the accept control of ex-002 is stale" },
      "--freeze",
    );
    expect(given.said).toMatch(/frozen.*1 fault.*contract/u);
    expect(given.code).toBe(0);
    expect(held(STALE, "contract.frozen")).toMatchObject([
      { despite: "the accept control of ex-002 is stale", faults: 1 },
    ]);
  });

  it.concurrent("notes a do-nothing answer the format refuses, and freezes over it", async () => {
    const unformed = await accept(UNFORMED, ADMIT, "--freeze");
    expect(unformed.said).toMatch(/note:.*do-nothing.*\{"answer":""\}.*answer format/u);
    expect(unformed.said).toContain("no fault");
    expect(unformed.code).toBe(0);
    expect(held(UNFORMED, "contract.frozen")).toHaveLength(1);
    expect(held(UNFORMED, "checker.read").map(({ faults }) => faults)).toEqual([[]]);

    const judgedDraft = {
      ...DRAFT,
      objective: {
        quantity: "quality",
        direction: "higher" as const,
        scale: "unit" as const,
        items: [
          {
            id: "clarity",
            weight: 1,
            kind: "judge" as const,
            criterion: "Answer states every calculation step and unit clearly.",
          },
        ],
      },
    };
    const [sameFam, crossFam, plainSameFam, unseated, unsolved] = [
      `${NAME}-judge-same`,
      `${NAME}-judge-cross`,
      `${NAME}-plain-same`,
      `${NAME}-judge-unseated`,
      `${NAME}-judge-unsolved`,
    ];
    NAMES.push(sameFam, crossFam, plainSameFam, unseated, unsolved);
    layOutDraft(folder(sameFam), judgedDraft);
    layOutDraft(folder(crossFam), judgedDraft);
    layOutDraft(folder(plainSameFam), DRAFT);
    layOutDraft(folder(unseated), judgedDraft);
    layOutDraft(folder(unsolved), judgedDraft);
    const seat = (model: string) => ({ model, effort: "high" });
    const open = (name: string, reviewer: string | null, solver: string | null = "claude/claude-opus-5-5") =>
      append(join(folder(name), LOG), "campaign.opened", {
        ...keyIfDefined("solver", solver === null ? undefined : seat(solver)),
        ...keyIfDefined("seats", reviewer === null ? undefined : { reviewer: seat(reviewer) }),
      });
    open(sameFam, "claude/claude-sonnet-5-5");
    open(crossFam, "openai-codex/gpt-6.1-sol");
    open(plainSameFam, "claude/claude-sonnet-5-5");
    open(unseated, null);
    open(unsolved, "claude/claude-sonnet-5-5", null);
    const [sameRes, crossRes, plainRes, unseatedRes, unsolvedRes] = await Promise.all([
      accept(sameFam, ADMIT, "--admit-judge"),
      accept(crossFam, ADMIT, "--admit-judge"),
      accept(plainSameFam, ADMIT, "--admit-judge"),
      accept(unseated, ADMIT, "--admit-judge"),
      accept(unsolved, ADMIT, "--admit-judge"),
    ]);
    expect(sameRes.code).not.toBe(0);
    expect(sameRes.said).toContain("--admit-judge:");
    expect([crossRes.code, plainRes.code, unseatedRes.code]).toEqual([0, 0, 0]);
    expect(unsolvedRes.code).not.toBe(0);
    expect(unsolvedRes.said).toContain("neither its opening nor this command names who solves");
  });
});

suite("rehearsal over a drafted exam", () => {
  // A checkpoint as its commands walk it: two Builder sessions, each with no comparison after it,
  // and then one comparison of what the second left, since a session runs outside a round too. A
  // script sits in every seat.
  it.concurrent("rehearses two sessions and then one checkpoint over a seed", async () => {
    const seeded = folder(SEED);
    const taken = await command("tools/campaign/prepare.ts", { name: SOURCE, practice: "1" });
    expect(taken.code).toBe(0);
    expect(taskSets(read(join(folder(SOURCE), LOG)))).toMatchObject({
      held: [anyOf(String)],
      released: [anyOf(String)],
    });
    const cli = async (...args: string[]) => {
      const child = capturedSpawn([capturedExecPath, "tools/runs/cli.ts", ...args], {
        cwd: REPO,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { code, said: `${out}${err}` };
    };
    expect((await cli("seed", "--from", folder(SOURCE), "--name", SEED)).code).toBe(0);
    const rehearse = (...more: string[]) => cli("rehearse", "--name", SEED, ...more);
    const of = (kind: string) => held(SEED, kind);

    // A comparison refused on its own terms leaves the log as it was, so a corrected command is not
    // refused as another setting.
    const lines = () => read(join(seeded, LOG)).length;
    const before = lines();
    expect((await rehearse("--id", "g-0", "--target", "0")).said).toMatch(/--target 0.*at least one/u);
    expect(lines()).toBe(before);
    expect(of("campaign.setting")).toEqual([]);

    for (const session of ["b-1", "b-2"]) {
      expect((await rehearse("--no-comparison", "--session", session)).code).toBe(0);
    }
    const [one, two] = of("build.finished");
    expect(of("build.started")).toMatchObject([{ session: "b-1" }, { session: "b-2", parent: one?.harness }]);
    expect([one?.changed, two?.changed]).toEqual([true, true]);
    expect(two?.harness).not.toBe(one?.harness);
    expect(of("comparison.started")).toEqual([]);
    expect(of("solve.started")).toEqual([]);
    expect(of("campaign.setting")).toHaveLength(1);

    const compared = await rehearse("--id", "g-1", "--new", "latest");
    expect(compared.code).toBe(0);
    expect(of("comparison.reported")).toMatchObject([
      { session: "g-1", fresh: two?.harness, reading: "no-step", scored: { wins: 1, losses: 0, ties: 0 } },
    ]);
    const again = await rehearse("--no-comparison", "--session", "b-2");
    expect(again.code).toBe(0);
    expect(again.said).toContain("b-2");
    expect(again.said).toContain(isString(two?.harness) ? two.harness : "missing harness");
    expect(of("build.started")).toHaveLength(2);

    // The campaign's view prints each step's handover. Of the moves, it names the table's alone.
    // It takes the campaign command's flags and no other, not a launch's.
    const viewed = (await cli("view", SEED, "--level", "0.02")).said;
    expect(
      viewed.split("\n").filter((line) => line.includes("Builder session (finished): from")),
    ).toHaveLength(2);
    expect(viewed).toMatch(/1 task.*2 rollouts per arm.*0\.02.*1 won.*0 lost.*0 tied.*no-step/u);
    expect(viewed).not.toContain("  a round");
    expect((await cli("view", SEED, "--cap", "100")).said).toContain("Unknown option '--cap'");
    // The view's last line is the move the decision table names, and the rehearsed campaign command
    // names the same; a view from an unpushed head warns after it.
    const tabled = (
      viewed
        .slice(viewed.indexOf("Recommended next action\n") + "Recommended next action\n".length)
        .trim()
        .split("\n")[0] ?? ""
    ).trim();
    expect(tabled).toContain(": ");
    const terms = ["--project", "fixture", "--level", "0.02"];
    expect((await rehearse(...terms, "--dry-run")).said).toContain(`next · ${tabled}`);
    const rehearsed = await rehearse(...terms);
    expect(rehearsed.code).toBe(0);
    expect(rehearsed.said).toMatch(
      /next · the campaign ends \(exam\)[^\n]*\nthe rehearsal went as scripted/u,
    );
  });
});
