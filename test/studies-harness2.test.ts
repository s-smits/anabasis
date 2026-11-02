// The Harness² study's two halves that need no container: an arm's harness taken from a campaign by
// the owners the campaign's own handover uses, and two arms read as a campaign reads a comparison.
// The campaign is written here with the log's own `append`, and its kept states under the digests
// they open as, as a session's freeze keeps them.
import { afterAll, describe, expect, it } from "bun:test";
import { placeHarness } from "../studies/shared/bundle.ts";
import { halves, readArms, shortfall, streamOf, type Trial, trialsOf } from "../studies/shared/scores.ts";
import { append } from "../src/kernel/log.ts";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { capturedJsonStringify } from "../src/meta/json-runtime.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { openHarness } from "../src/harness/open.ts";
import { EXAMPLE, writeStarter } from "../src/harness/starter.ts";
import { writeHarness } from "./helpers/write-harness.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-study-harness2-test-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A campaign folder `name` with the starter and one child kept, and `events` in its log. */
async function campaign(name: string, events: (log: string, starter: string, child: string) => void) {
  const dir = join(root, name);
  const states = join(dir, "states");
  mkdirSync(states, { recursive: true });
  const keep = async (write: (into: string) => void) => {
    const scratch = join(root, "scratch");
    write(scratch);
    const { digest } = await openHarness(scratch);
    renameSync(scratch, join(states, digest));
    return digest;
  };
  const starter = await keep(writeStarter);
  const child = await keep((into) => writeHarness(into, EXAMPLE));
  const log = join(dir, "log.jsonl");
  append(log, "build.started", { session: "b-1", parent: starter });
  append(log, "build.finished", { session: "b-1", ended: "finished", harness: child, changed: true });
  events(log, starter, child);
  return { log, states, starter, child };
}

const ended = await campaign("ended", (log, starter, child) => {
  append(log, "harness.promoted", { harness: child, from: starter, rests: ["g-1"] });
  append(log, "campaign.ended", { ending: "budget", why: "spent", reference: child });
});

describe("an arm's harness, taken from a campaign", () => {
  it("copies the reference the log names at its ending, opening as that digest, with how the campaign ended", async () => {
    const into = join(root, "arm-ended");
    const origin = await placeHarness(into, { campaign: ended.log });
    expect((await openHarness(into)).digest).toBe(ended.child);
    // No starter comparison of it tallied a task, so its promotion is not yet confirmed.
    expect(origin).toStrictEqual({ campaign: "ended", ending: "budget", confirmed: false });
  });

  it("refuses the reference of a campaign that has not ended, and takes a harness named by digest", async () => {
    const live = await campaign("live", () => undefined);
    await expect(placeHarness(join(root, "arm-live"), { campaign: live.log })).rejects.toThrow(
      /has not ended/u,
    );
    const into = join(root, "arm-live-named");
    const origin = await placeHarness(into, { campaign: live.log, harness: live.child });
    expect((await openHarness(into)).digest).toBe(live.child);
    expect(origin.ending).toBeNull();
  });

  it("writes the starter where no promotion moved the reference, and writes nothing under the campaign", async () => {
    const flat = await campaign("flat", (log) => {
      append(log, "campaign.ended", { ending: "stop", why: "patience" });
    });
    const before = readdirSync(flat.states).sort();
    const into = join(root, "arm-flat");
    const origin = await placeHarness(into, { campaign: flat.log });
    expect((await openHarness(into)).digest).toBe(flat.starter);
    expect(origin.campaign).toBe("flat");
    await expect(
      placeHarness(join(root, "arm-flat-programs"), {
        campaign: flat.log,
        harness: `programs-of:${flat.child}`,
      }),
    ).rejects.toThrow(/does not write/u);
    expect(readdirSync(flat.states).sort()).toStrictEqual(before);
  });

  it("refuses a kept state that no longer opens as the digest it is kept under", async () => {
    const misnamed = "0".repeat(64);
    cpSync(join(ended.states, ended.child), join(ended.states, misnamed), { recursive: true });
    await expect(
      placeHarness(join(root, "arm-misnamed"), { campaign: ended.log, harness: misnamed }),
    ).rejects.toThrow(/no longer opens/u);
  });
});

/** A trial of `task` scored `score`, started at minute `minute`. */
const trial = (task: string, score: number | null, minute = 0): Trial => ({
  task,
  trial: `${task}__${String(minute)}`,
  score,
  ending: null,
  billed: null,
  turns: null,
  calls: null,
  seconds: null,
  started: `2026-11-02T10:${String(minute).padStart(2, "0")}:00Z`,
});

describe("two arms read as a campaign reads a comparison", () => {
  it("pairs only the tasks each arm scored in full, and names the rest short", () => {
    const a = [trial("t1", 1), trial("t1", 1), trial("t2", 1), trial("t2", null)];
    const b = [trial("t1", 0), trial("t1", 0), trial("t2", 0), trial("t2", 0)];
    const reading = readArms(a, b, 2);
    expect(reading).toMatchObject({ tasks: 1, short: ["t2"], won: 0, lost: 1, tied: 0 });
    expect(shortfall(a, ["t1", "t2", "t3"], 2)).toStrictEqual(
      new Map([
        ["t2", 1],
        ["t3", 2],
      ]),
    );
  });

  it("reads a step at the campaign's level: six clean wins clear 0.02 and five do not", () => {
    const tasks = (count: number) => Array.from({ length: count }, (_, at) => `t${String(at)}`);
    const arm = (count: number, score: number) =>
      tasks(count).flatMap((task) => [trial(task, score), trial(task, score)]);
    expect(readArms(arm(6, 0), arm(6, 1), 2)).toMatchObject({ won: 6, step: true, level: 0.02 });
    const five = readArms(arm(5, 0), arm(5, 1), 2);
    expect(five).toMatchObject({ won: 5, step: false, eitherWay: false });
    expect(readArms(arm(5, 0), arm(5, 1), 2, { level: 0.1 }).step).toBe(true);
  });

  it("splits one arm by mirrored halves in the order its trials started, and takes one stream alone", async () => {
    // The trials arrive out of order; `trialsOf` orders them by Harbor's start time.
    const folders = [3, 0, 2, 1].map((minute) => {
      const path = join(root, "trials", `t1__${String(minute)}`);
      mkdirSync(path, { recursive: true });
      writeFileSync(
        join(path, "result.json"),
        capturedJsonStringify({ started_at: `2026-11-02T10:0${String(minute)}:00Z` }),
      );
      return { task: "t1", trial: `t1__z${String(minute)}`, path, score: minute / 10 };
    });
    const ordered = trialsOf(folders.map((line) => capturedJsonStringify(line)).join("\n"));
    expect(ordered.map(({ score }) => score)).toStrictEqual([0, 0.1, 0.2, 0.3]);
    const [first, last] = halves(ordered);
    expect(first.map(({ score }) => score)).toStrictEqual([0, 0.3]);
    expect(last.map(({ score }) => score)).toStrictEqual([0.1, 0.2]);
    expect(streamOf(ordered, 2).map(({ score }) => score)).toStrictEqual([0.2]);
  });
});
