// The investigation's two walls, each as a perturbation. What may never be quoted (task text,
// answers, hidden values, check reasons, prompts, traces, reviewer prose) is changed in a synthetic
// log, and every derived file and lane prompt must come out byte-identical. A lane that runs alone or
// grades blind is given the campaigns and the hard rules, and an isolated one its own trigger, and
// nothing that could lead it: changing the orientation, the moved variable or another lane's trigger
// leaves its prompt byte-identical, and it refuses to open without its trigger.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { catalogueText, lanesOf, ownersOf } from "../tools/wri/catalogue.ts";
import { READERS, readerOutput, sourceOf } from "../tools/wri/derive.ts";
import type { Trigger } from "../tools/wri/folds.ts";
import { type Campaign, lanePrompt, selected, sharedPrompt } from "../tools/wri/investigation.ts";
import { overview } from "../tools/wri/read.ts";
import { domainReadinessOf } from "../tools/wri/domains.ts";
import { analyzeRegressions, formatRegressionReport } from "../tools/wri/regressions.ts";
import { wriCampaign } from "./helpers/wri-campaign.ts";

type Secret = (tag: string) => string;
/** The one quote allowed: `tasks.txt` prints each task's public input, which the Builder is shown too. */
const PUBLIC = /^ {2}public: .*$/gmu;
/** `drafted.txt` tells prompts apart by a digest, which names a text without quoting it. */
const DIGEST = /digest [0-9a-f]{12}/gu;
/** What each reader may print that differs with the secrets, put back to one form. */
const ALLOWED = new Map([
  ["tasks", (text: string) => text.replaceAll(PUBLIC, "  public: <input>")],
  ["drafted", (text: string) => text.replaceAll(DIGEST, "digest <digest>")],
]);

const REPO = join(import.meta.dir, "..");
const base = mkdtempSync(join(tmpdir(), "wri-walls-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const catalogue = catalogueText();
const lanes = lanesOf(catalogue);
const owners = ownersOf(catalogue);
// Each word's letters rotated but the ids' (`x-1-002`, `s3`), which are public, so a reader that counts
// characters, words or identifiers it does not already know counts alike under both.
const rotated = (text: string) =>
  text
    .split(" ")
    .map((word) =>
      /\d/u.test(word)
        ? word
        : word.replaceAll(/[a-z]/gu, (letter) =>
            String.fromCodePoint((((letter.codePointAt(0) ?? 97) - 84) % 26) + 97),
          ),
    )
    .join(" ");
const SECRETS: readonly [Secret, Secret] = [(tag) => `CANARY ${tag}`, (tag) => `XQZPWM ${rotated(tag)}`];

/** Every derived file a reader writes from the campaign under `secret`, the temporary folder named alike. */
async function derived(secret: (tag: string) => string, at: string) {
  const dir = join(base, at);
  mkdirSync(join(dir, "camp"), { recursive: true });
  const log = join(dir, "camp", "log.jsonl");
  writeFileSync(
    log,
    wriCampaign(secret)
      .map((event) => `${JSON.stringify(event)}\n`)
      .join(""),
  );
  const out: Record<string, string> = {};
  // A reader that embeds needs a local model; its store holds no prose, which its own test proves.
  for (const reader of READERS.filter(({ embeds }) => embeds !== true)) {
    out[reader.name] = (await readerOutput(reader, sourceOf(log, REPO))).text.replaceAll(dir, "<dir>");
  }
  return out;
}

const shared = (orientation: string, moved: string, read: string) =>
  [
    `## Orientation\n\n${orientation}`,
    `## The moved variable and prior state\n\n${moved}`,
    `## Already read by the primary\n\n${read}`,
    "## Campaigns under review\n\nbuffer-a, read whole",
    "## Hard rules\n\n- quote nothing",
  ].join("\n\n");

const campaigns = (secret: (tag: string) => string, extra: readonly Trigger[] = []): Campaign[] => {
  const { rows, triggers } = overview(wriCampaign(secret));
  return [{ name: "buffer-a", log: "/a/log.jsonl", overview: { rows, triggers: [...triggers, ...extra] } }];
};
const parts = (secret: (tag: string) => string, text: string, extra: readonly Trigger[] = []) => ({
  shared: text,
  campaigns: campaigns(secret, extra),
  catalogue,
  owners,
  report: "/r/report.md",
  common: "/r/shared.md",
});

describe("the no-quote wall", () => {
  it("writes every derived file byte for byte alike, whatever the log's hidden values and texts", async () => {
    const [one, two] = [await derived(SECRETS[0], "one"), await derived(SECRETS[1], "two")];
    expect(Object.keys(one).length).toBeGreaterThan(20);
    // The nearest hostile case: the statement the tasks reader quotes is one the perturbation reaches.
    expect(one.tasks).toContain("CANARY statement");
    expect(two.tasks).not.toEqual(one.tasks);
    expect(new Set(one.tasks?.match(/CANARY \w+/gu))).toEqual(new Set(["CANARY statement"]));
    for (const name of Object.keys(one)) {
      const [first, second] = [one[name], two[name]].map((text) =>
        text === undefined ? text : (ALLOWED.get(name)?.(text) ?? text),
      );
      expect({ name, text: second }).toEqual({ name, text: first });
      expect(first).not.toContain("CANARY");
    }
  }, 60_000);

  it("builds the shared prompt and every lane's prompt byte for byte alike", () => {
    const text = shared("Why the step.", "the gap floor", "nothing yet");
    const [one, two] = SECRETS.map((secret) => [
      sharedPrompt(parts(secret, text)),
      ...lanes.map((each) => lanePrompt({ ...parts(secret, text), lane: each })),
    ]);
    expect(two).toEqual(one);
    expect(one?.join("\n")).not.toContain("CANARY");
  });

  it("renders scored external benchmark regression joins byte for byte alike without leaking log secrets", () => {
    const store = join(base, "bench-wall");
    const put = (file: string, value: JsonValue) => {
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, `${JSON.stringify(value)}\n`);
    };
    put(join(store, "judged", "pi-hd", "soc__t1.json"), {
      arm: "pi-hd",
      task: "soc/t1",
      harness: "hd",
      runtime: "pi-durable",
      points: 20,
      total: 50,
      cut: [],
    });
    put(join(store, "judged", "base-pi-hd", "soc__t1.json"), {
      arm: "base-pi-hd",
      task: "soc/t1",
      harness: "",
      runtime: "pi-durable",
      points: 45,
      total: 50,
      cut: [],
      build: { of: "base", usd: 0 },
    });
    put(join(store, "dataset", "soc", "t1", "eval_result", "eval_pi-hd__soc__t1", "judge_judge.json"), {
      rubrics: [{ index: 0, weight: 10, result: { passed: false, criteria_passed: 1, criteria_count: 3 } }],
    });
    const trajDir = join(store, "dataset", "soc", "t1", "model_traj", "pi-hd__soc__t1");
    mkdirSync(trajDir, { recursive: true });
    writeFileSync(
      join(trajDir, "attempt1.jsonl"),
      `${JSON.stringify({ kind: "solve.call", data: { tool: "bash", args: { command: "helper-tool run" } } })}\n`,
    );
    const campDir = join(base, "camp-wall");
    mkdirSync(join(campDir, "states", "hd", ".toolchain", "bin"), { recursive: true });
    writeFileSync(join(campDir, "states", "hd", ".toolchain", "bin", "helper-tool"), "#!/bin/sh\n");

    const [first, second] = SECRETS.map((secret) => {
      const events = wriCampaign(secret);
      const ready = domainReadinessOf({
        campaign: "buffer-a",
        log: join(campDir, "log.jsonl"),
        events,
        repo: REPO,
        benches: [],
        storeOverride: store,
        extensionsRoot: join(base, "no-ext"),
      });
      const report = analyzeRegressions(ready, events, campDir);
      expect(report.status).toBe("scored");
      return formatRegressionReport(report);
    });
    expect(second).toEqual(first);
    expect(first).toContain("pi-hd (builtSolver");
    expect(first).toContain("helper-tool:");
    expect(first).not.toContain("CANARY");
  });
});

describe("the isolated-lane wall", () => {
  const ISOLATED = lanes.filter(({ isolated }) => isolated);
  const BLIND = lanes.filter(({ blind }) => blind);
  // Another lane's trigger, which only that lane and the open lanes' shared file may read.
  const other: Trigger = { lane: 17, name: "RULINGS REFUSED", detail: "LEAD 3 of 3" };

  it("gives a lane that runs alone or grades blind the same prompt, whatever leads the others are given", () => {
    expect(ISOLATED.length).toBeGreaterThan(0);
    expect(BLIND.length).toBeGreaterThan(0);
    const plain = parts(SECRETS[0], shared("Why the step.", "the gap floor", "nothing yet"));
    const asked =
      "## Operator questions\n\n| id | lanes | question |\n| --- | --- | --- |\n| Q1 | 1, 4, 20 | LEAD asked |";
    const leading = parts(
      SECRETS[1],
      `${shared("LEAD the Builder won", "LEAD the level moved", "LEAD read")}\n\n${asked}`,
      [other],
    );
    /** The leads, with every trigger but the lane's own given another count. */
    const led = (number: number) => ({
      ...leading,
      campaigns: leading.campaigns.map((campaign) => {
        const triggers = campaign.overview.triggers.map((trigger) =>
          trigger.lane === number ? trigger : { ...trigger, detail: `LEAD ${trigger.detail}` },
        );
        return { ...campaign, overview: { ...campaign.overview, triggers } };
      }),
    });
    for (const each of [...ISOLATED, ...BLIND]) {
      const prompt = lanePrompt({ ...plain, lane: each });
      expect({ lane: each.number, prompt: lanePrompt({ ...led(each.number), lane: each }) }).toEqual({
        lane: each.number,
        prompt,
      });
      expect(prompt).toContain("buffer-a, read whole");
      expect(prompt).toContain("quote nothing");
      expect(prompt).not.toContain("Why the step.");
      expect(prompt).not.toContain("the gap floor");
    }
    // The nearest hostile case: an open lane is handed the leads, so the change is one it would show.
    expect(sharedPrompt(leading)).toContain("LEAD the Builder won");
    expect(sharedPrompt(leading)).toContain("LEAD 3 of 3");
    expect(sharedPrompt(led(20))).toContain("REFUSED UNREAD (lane 17): LEAD ");
    const open = lanes.find(({ number }) => number === 4);
    expect(open === undefined ? "" : lanePrompt({ ...leading, lane: open })).toContain(
      "| Q1 | 1, 4, 20 | LEAD asked |",
    );
  });

  it("gives an isolated lane the campaign's rows and its own trigger, and a blind lane neither", () => {
    const fired = campaigns(SECRETS[0])[0]?.overview.triggers ?? [];
    const plain = parts(SECRETS[0], shared("o", "m", "r"));
    for (const each of ISOLATED) {
      const own = fired.find((trigger) => trigger.lane === each.number);
      expect(own).toBeDefined();
      const prompt = lanePrompt({ ...plain, lane: each });
      expect(prompt).toContain("A. campaign and log");
      expect(prompt).toContain(`${own?.name} (lane ${String(each.number)})`);
      const foreign = fired.filter((trigger) => trigger.lane !== each.number);
      for (const trigger of foreign) {
        expect(prompt).not.toContain(`${trigger.name} (lane ${String(trigger.lane)})`);
      }
    }
    for (const each of BLIND) {
      const prompt = lanePrompt({ ...plain, lane: each });
      expect(prompt).not.toContain("A. campaign and log");
      for (const trigger of fired) expect(prompt).not.toContain(`${trigger.name} (lane`);
    }
  });

  it("opens an isolated lane only on its trigger, and never among the lanes a build opens by default", () => {
    expect(ISOLATED.length).toBeGreaterThan(0);
    for (const isolated of ISOLATED) {
      const fired: Trigger[] = [{ lane: isolated.number, name: "FAILS ON ONE CHECK", detail: "2 of 2" }];
      expect(() => selected(lanes, [], [isolated.number])).toThrow(
        `lane ${String(isolated.number)} runs only on its trigger, and the log fired none`,
      );
      expect(selected(lanes, fired, [isolated.number]).isolated).toEqual([isolated]);
      const opened = selected(lanes, fired, null);
      expect(opened.open.some(({ isolated: alone }) => alone)).toBe(false);
      expect(opened.isolated).toEqual([]);
      expect(opened.waiting).toEqual([isolated]);
    }
  });
});
