// The Harness² study's halves that need no container: an arm's harness taken from a campaign by
// the owners the campaign's own handover uses, its own tools served as the container solver serves
// them, and two arms read as a campaign reads a comparison. The campaign is written here with the
// log's own `append`, and its kept states under the digests they open as, as a session's freeze
// keeps them. The compiled solver is run where the container's platform is the host's.
import { afterAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import {
  bundleArm,
  foreignHead,
  foreignPrograms,
  MODULE_FILE,
  placeHarness,
} from "../studies/shared/bundle.ts";
import { exportForClaudeCode } from "../studies/shared/claude-export.ts";
import { harnessIn, RESULT_FILE } from "../studies/shared/pi-solve.ts";
import { halves, readArms, shortfall, streamOf, type Trial, trialsOf } from "../studies/shared/scores.ts";
import { append } from "../src/kernel/log.ts";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "../src/meta/json-runtime.ts";
import { errorMessage } from "../src/meta/runtime-values.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { runSync } from "../src/meta/subprocess.ts";
import { openHarness } from "../src/harness/open.ts";
import { EXAMPLE, writeStarter } from "../src/harness/starter.ts";
import { writeHarness } from "./helpers/write-harness.ts";

// SAFETY: the harness tool below uses only the context's abort signal, no tool API methods.
const UNUSED_API = undefined as never;
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-study-harness2-test-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A harness with one tool of its own, `doubled`, whose call reads the task's public input and runs
 *  one of the harness's programs; `load` is the line its module runs first. */
const tooled = (load = "") => ({
  spec: { presets: ["bash"], tools: [{ name: "doubled", kind: "reader" }] },
  tools: `import { defineDraftTool } from "@ana/agent-bundle";
import { Type } from "@earendil-works/pi-ai";
import { execFileSync } from "node:child_process";
${load}
export const createDomainHarness = (task) => ({ tools: [defineDraftTool({
  name: "doubled", label: "Doubled", description: "Doubles n.",
  parameters: Type.Object({ n: Type.Number() }),
  run: ({ n }) => ({ text: \`\${task.publicInput.instruction} \${String(n * 2)} \${execFileSync("mark", { encoding: "utf8" }).trim()}\` }),
})] });`,
  programs: { mark: "#!/bin/sh\necho marked\n" },
});
const clock = () => ({ started: null, seconds: 600 });

/** A campaign folder `name` with the starter and one child kept, and `events` in its log. */
async function campaign(
  name: string,
  events: (log: string, starter: string, child: string) => void,
  child: Parameters<typeof writeHarness>[1] = EXAMPLE,
) {
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
  const kept = await keep((into) => writeHarness(into, child));
  const log = join(dir, "log.jsonl");
  append(log, "build.started", { session: "b-1", parent: starter });
  append(log, "build.finished", { session: "b-1", ended: "finished", harness: kept, changed: true });
  events(log, starter, kept);
  return { log, states, starter, child: kept };
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

describe("the harness's own tools, served in the container", () => {
  it("lists and calls a harness's tool through the loader a campaign uses, and names a tool that fails to load", async () => {
    const dir = join(root, "tooled");
    writeHarness(dir, tooled());
    const { module } = await openHarness(dir);
    const env = new NodeExecutionEnv({ cwd: root });
    const { domain } = await harnessIn({ harness: dir, module, instruction: "Fix it." }, env, clock());
    expect(domain.map(({ name }) => name)).toStrictEqual(["doubled"]);
    const [doubled] = domain;
    const result = await doubled?.execute({ n: 4 }, UNUSED_API, BACKGROUND_CONTEXT);
    expect(result?.output).toStrictEqual([{ type: "text", text: "Fix it. 8 marked" }]);
    const broken = join(root, "tooled-broken");
    writeHarness(broken, tooled('throw new Error("no engine here");'));
    const failing = (await openHarness(broken)).module;
    await expect(
      harnessIn({ harness: broken, module: failing, instruction: "Fix it." }, env, clock()),
    ).rejects.toThrow("no engine here");
  });

  const native = runtimeProcess.platform === "linux" && runtimeProcess.arch === "x64";
  it.skipIf(!native)(
    "bundles a harness with tools, and the compiled solver lists them or ends a broken one as its own fail",
    async () => {
      const dry = async (name: string, load?: string) => {
        const made = await campaign(name, () => undefined, tooled(load));
        const mount = join(root, `mount-${name}`);
        await bundleArm(mount, { campaign: made.log, harness: made.child });
        const logs = join(root, `logs-${name}`);
        mkdirSync(logs);
        writeFileSync(join(logs, "instruction.md"), "Fix it.");
        const flags = [
          ["--harness", join(mount, "harness")],
          ["--module", join(mount, MODULE_FILE)],
          ["--instruction", join(logs, "instruction.md")],
          ["--model", "google/gemini-3.5-flash"],
          ["--base-url", "http://127.0.0.1:9/v1"],
          ["--key", "unused"],
          ["--effort", "high"],
          ["--model-turns", "20"],
          ["--wall-minutes", "30"],
          ["--prompts", "24"],
          ["--logs", logs],
        ].flat();
        runSync([join(mount, "pi-solve"), ...flags, "--dry-run"], { cwd: logs });
        return parseJsonAs<{ ending: string; tools?: string[]; reason?: string }>(
          readFileSync(join(logs, RESULT_FILE), "utf8"),
        );
      };
      expect(await dry("served")).toMatchObject({ ending: "dry-run", tools: ["bash", "doubled", "submit"] });
      const unloaded = await dry("unloaded", 'throw new Error("no engine here");');
      expect(unloaded.ending).toBe("broken-harness");
      expect(unloaded.reason).toContain("no engine here");
    },
    240_000,
  );
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

  it("gives a non-result retried later no half's or stream's place, so the retry takes the one it stood in", () => {
    const retried = [
      trial("t1", 0, 0),
      trial("t1", null, 1),
      trial("t1", 0.1, 2),
      trial("t1", 0.2, 3),
      trial("t1", 0.3, 4),
    ];
    const [first, last] = halves(retried);
    expect(first.map(({ score }) => score)).toStrictEqual([0, 0.3]);
    expect(last.map(({ score }) => score)).toStrictEqual([0.1, 0.2]);
    expect(streamOf(retried, 1).map(({ score }) => score)).toStrictEqual([0.1]);
  });

  it("reads a Harbor exception as a non-result, keeps an agent's timeout as its fail, and puts a trial with no start last", () => {
    const line = (
      name: string,
      harbor: { started_at?: string; exception_info?: { exception_type: string } },
    ) => {
      const path = join(root, "thrown", name);
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "result.json"), capturedJsonStringify(harbor));
      return capturedJsonStringify({ task: "t1", trial: name, path, score: 0 });
    };
    const at = "2026-11-02T10:00:00Z";
    const read = trialsOf(
      [
        line("unstarted", {}),
        line("crashed", { started_at: at, exception_info: { exception_type: "RuntimeError" } }),
        line("timed", { started_at: at, exception_info: { exception_type: "AgentTimeoutError" } }),
      ].join("\n"),
    );
    expect(read.map(({ trial: name, score }) => [name, score])).toStrictEqual([
      ["crashed", null],
      ["timed", 0],
      ["unstarted", 0],
    ]);
  });
});

describe("a harness's programs, checked against the container", () => {
  const head = (...bytes: number[]) => Buffer.from(bytes);
  const elf = (machine: number) => {
    const bytes = Buffer.alloc(20);
    bytes.writeUInt32BE(0x7f_45_4c_46, 0);
    bytes.writeUInt16LE(machine, 18);
    return bytes;
  };

  it("names a Mach-O binary, an ELF for another processor and a host interpreter, and passes what the container runs", () => {
    expect(foreignHead(head(0xcf, 0xfa, 0xed, 0xfe))).toBe("a Mach-O binary");
    expect(foreignHead(elf(183))).toBe("an ELF binary for machine 183");
    expect(foreignHead(Buffer.from("#!/Users/me/venv/bin/python3\n"))).toContain("host path");
    expect(foreignHead(elf(62))).toBeNull();
    expect(foreignHead(Buffer.from("#!/usr/bin/env python3\n"))).toBeNull();
    expect(foreignHead(Buffer.from("#!/bin/sh\n"))).toBeNull();
    expect(foreignHead(Buffer.from("plain text"))).toBeNull();
  });

  it("refuses a tool tree holding foreign programs by path, and passes one the container runs", async () => {
    const tree = join(root, "programs");
    mkdirSync(join(tree, "venv", "bin"), { recursive: true });
    writeFileSync(join(tree, "fine"), "#!/bin/sh\necho ok\n");
    writeFileSync(join(tree, "linux"), elf(62));
    await foreignPrograms(tree);
    writeFileSync(join(tree, "venv", "bin", "tool"), "#!/private/tmp/venv/bin/python\n");
    writeFileSync(join(tree, "mac"), head(0xcf, 0xfa, 0xed, 0xfe));
    await expect(foreignPrograms(tree)).rejects.toThrow(/mac \(a Mach-O binary\), venv\/bin\/tool/u);
  });

  it("leaves no mount behind when a bundle fails, so the next attempt is not refused as made", async () => {
    const into = join(root, "mount-failed");
    const missing = { campaign: join(root, "no-campaign", "log.jsonl") };
    const why = async () => bundleArm(into, missing).then(() => "made", errorMessage);
    expect(await why()).not.toContain("there already");
    expect(existsSync(into)).toBe(false);
    expect(await why()).not.toContain("there already");
  });
});

describe("a harness written out for Claude Code", () => {
  it("makes the guide CLAUDE.md, copies the programs under scripts and names the harness's own tools as unavailable", async () => {
    const made = await campaign("exported", () => undefined, tooled());
    const into = join(root, "claude-tooled");
    const record = await exportForClaudeCode(into, { campaign: made.log, harness: made.child });
    expect(record.harness).toBe(made.child);
    expect(record.dropped).toStrictEqual(["agent/tools-spec.json", "agent/tools.ts"]);
    expect(record.unavailable).toStrictEqual(["doubled"]);
    const guide = readFileSync(join(into, "CLAUDE.md"), "utf8");
    expect(guide).toContain("doubled. They are not available here");
    expect(guide).toContain('export PATH="$PWD/scripts/toolchain/bin:$PATH"');
    expect(readFileSync(join(into, "scripts", "toolchain", "bin", "mark"), "utf8")).toContain("echo marked");
    expect(parseJsonAs<{ harness: string }>(readFileSync(join(into, "export.json"), "utf8")).harness).toBe(
      made.child,
    );
  });

  it("writes the starter's guide under the note with no tool or program line, and refuses a tree already made", async () => {
    const into = join(root, "claude-starter");
    const record = await exportForClaudeCode(into, "starter");
    expect(record).toMatchObject({ campaign: null, unavailable: [], toolchain: null, searched: [] });
    const guide = readFileSync(join(into, "CLAUDE.md"), "utf8");
    expect(guide.startsWith("# How this harness reaches you")).toBe(true);
    expect(guide).not.toContain("not available here");
    expect(guide).not.toContain("scripts/toolchain");
    expect(existsSync(join(into, "scripts"))).toBe(false);
    await expect(exportForClaudeCode(into, "starter")).rejects.toThrow(/there already/u);
  });
});
