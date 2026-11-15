// The Harness² study's halves that need no container: an arm's harness taken from a campaign by
// the owners the campaign's own handover uses, its own tools served as the container solver serves
// them, and two arms read as a campaign reads a comparison. The campaign is written here with the
// log's own `append`, and its kept states under the digests they open as, as a session's freeze
// keeps them. The compiled solver is run where the container's platform is the host's, and the
// solver from source, as the outside scorer's `pi:` arm starts it, on every platform.
import { afterAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import {
  bundleArm,
  foreignHead,
  foreignPrograms,
  HERE,
  MODULE_FILE,
  placeHarness,
} from "../studies/shared/bundle.ts";
import { exportForClaudeCode } from "../studies/shared/claude-export.ts";
import { harnessIn, keyless, RESULT_FILE, TRACE_FILE } from "../studies/shared/pi-solve.ts";
import { type Agent, type Claude, REFUSED, rollout } from "../studies/harness2/h2/claude.ts";
import { piAgent } from "../studies/harness2/score.ts";
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
import type { JsonObject } from "../src/meta/json-shape.ts";
import { errorMessage } from "../src/meta/runtime-values.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
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
    const before = readdirSync(flat.states).toSorted();
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
    expect(readdirSync(flat.states).toSorted()).toStrictEqual(before);
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

  it("reads a program against the machine a rollout runs on, whose own paths are no fault", () => {
    const linux = { name: "a Linux machine", mac: false, machine: 62, roots: null };
    const mac = { name: "a Mac", mac: true, machine: 183, roots: null };
    expect(foreignHead(head(0xcf, 0xfa, 0xed, 0xfe), linux)).toBe("a Mach-O binary");
    expect(foreignHead(elf(183), linux)).toBe("an ELF binary for machine 183");
    expect(foreignHead(elf(62), linux)).toBeNull();
    expect(foreignHead(Buffer.from("#!/Users/me/venv/bin/python3\n"), linux)).toBeNull();
    expect(foreignHead(head(0xcf, 0xfa, 0xed, 0xfe), mac)).toBeNull();
    expect(foreignHead(elf(183), mac)).toBe("an ELF binary for machine 183");
    expect(foreignHead(readFileSync(capturedExecPath).subarray(0, 128), HERE)).toBeNull();
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
    expect(guide).toContain("`scripts/toolchain/bin`, and nothing puts them on your PATH");
    expect(guide).not.toContain("export PATH");
    expect(guide).toMatch(/written for that runner's files .* find none of them here/u);
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
    expect(guide).toMatch(/limit on turns or time, .* does not hold here/u);
    expect(guide).not.toContain("find none of them here");
    expect(existsSync(join(into, "scripts"))).toBe(false);
    await expect(exportForClaudeCode(into, "starter")).rejects.toThrow(/there already/u);
  });
});

/** The scorer's `pi:` arm: the harness as it is kept, its solver on pi-durable, with no model. */
describe("a harness solved on pi-durable in the benchmark's rollout", () => {
  const pilot: Claude = {
    bin: "claude",
    model: "claude-opus-5-5",
    effort: "high",
    budgetUsd: "5",
    timeoutS: 3600,
    env: {},
  };
  /** One attempt as the arm's agent starts it, before its solver has left anything. */
  const started = (name: string) => {
    const agent = piAgent(pilot);
    const traj = join(root, `pi-arm-${String(runtimeProcess.pid)}-${name}.jsonl`);
    const argv = agent.argv({ prompt: "The task.", treeDir: join(root, "tree"), workspace: root, traj });
    const flag = (flagged: string): string => argv[argv.indexOf(flagged) + 1] ?? "";
    return { agent, traj, argv, flag, logs: flag("--logs") };
  };
  /** What the agent reads of an attempt whose solver left `result` and a trace of `calls` calls. */
  const read = (name: string, result: JsonObject, calls = 0) => {
    const attempt = started(name);
    writeFileSync(join(attempt.logs, RESULT_FILE), capturedJsonStringify(result));
    for (let call = 0; call < calls; call += 1) {
      append(join(attempt.logs, TRACE_FILE), "solve.call", { tool: "bash" });
    }
    return { ...attempt, seen: attempt.agent.seen(attempt.traj) };
  };

  it("gives the solver's commands the environment without its credentials", async () => {
    const names = [
      "PATH",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CLAUDE_CODE_OAUTH_TOKEN3",
      "ANTHROPIC_API_KEY",
      "HOME",
    ];
    expect(Object.keys(keyless(names))).toStrictEqual(names.slice(1, 4));
    // The fix rests on this: a name the shell's own environment holds as undefined is not inherited.
    const said = async (shellEnv: Record<string, undefined>) => {
      let out = "";
      await new NodeExecutionEnv({ cwd: root, shellEnv }).exec(
        'printf "%s" "${HOME-withheld}"',
        {
          onOutput: (chunk) => {
            out += Buffer.from(chunk).toString("utf8");
          },
        },
        BACKGROUND_CONTEXT,
      );
      return out;
    };
    expect(await said({ HOME: undefined })).toBe("withheld");
    expect(await said({})).toBe(runtimeProcess.env.HOME ?? "");
  });

  it("starts the solver inside the harness on the pilot's model, dollars and hour, with no turn limit", () => {
    const { agent, traj, argv, flag, logs } = started("asked");
    expect(flag("--harness")).toBe(join(root, "tree", "harness"));
    expect(["--solver", "--effort", "--budget-usd", "--wall-minutes"].map(flag)).toStrictEqual([
      "claude/claude-opus-5-5",
      "high",
      "5",
      "58",
    ]);
    expect(argv).not.toContain("--model-turns");
    expect(readFileSync(flag("--instruction"), "utf8")).toBe("The task.");
    // A solver killed before it wrote its result is a dead agent, which a rollout rolls again.
    expect(agent.seen(traj)).toStrictEqual({ turns: 0, subtype: "None", tools: 0, costUsd: 0 });
    expect(existsSync(logs)).toBe(false);
  });

  it("reads each ending as a rollout's log names it, and a session that failed as a non-result", () => {
    const done = read("done", { ending: "submitted", turns: 7, billed: 1.2, reportedCost: 1.5 }, 2);
    expect(done.seen).toStrictEqual({ turns: 7, subtype: "success", tools: 2, costUsd: 1.5 });
    expect(readFileSync(done.traj, "utf8").trim().split("\n")).toHaveLength(2);
    expect(existsSync(done.logs)).toBe(false);
    const spent = read("spent", { ending: "budget", turns: 30, billed: 5.02, reportedCost: null });
    expect(spent.seen).toMatchObject({ subtype: "error_max_budget_usd", costUsd: 5.02 });
    expect(read("threw", { ending: "crash", crash: "the session threw" }).seen.subtype).toBe(REFUSED);
    expect(read("silent", { ending: "provider" }).seen.subtype).toBe(REFUSED);
    // The solver's own loss stays its own: it is scored on what it left.
    expect(read("late", { ending: "wall-ended", turns: 40 }).seen.subtype).toBe("wall-ended");
  });

  it("rolls any agent as it rolls Claude Code: a delivery, a second attempt after none, none after a spent budget", async () => {
    const [store, task, tree] = [join(root, "pi-store"), "g/task1", join(root, "pi-no-tree")];
    mkdirSync(join(store, task, "task_folder"), { recursive: true });
    mkdirSync(tree);
    const rolled = async (label: string, script: string, endings: readonly string[]) => {
      let attempts = 0;
      const agent: Agent = {
        stage: (_tree, workspace) => writeFileSync(join(workspace, "staged"), "by the agent\n"),
        argv: () => ["/bin/sh", "-c", script],
        seen: () => {
          attempts += 1;
          return { turns: 3, subtype: endings[attempts - 1] ?? "None", tools: 2, costUsd: 0.25 };
        },
      };
      const env = { PATH: runtimeProcess.env.PATH ?? "" };
      const billed = await rollout({ store, task, label }, tree, { ...pilot, timeoutS: 30, env }, agent);
      const log = readdirSync(join(store, ".harness2-logs")).find((file) => file.includes(`_${label}_`));
      return {
        attempts,
        billed,
        log: readFileSync(join(store, ".harness2-logs", log ?? ""), "utf8"),
        delivered: join(store, task, "model_output", label),
      };
    };
    const made = await rolled("made", "cat staged > output/report.md", ["success"]);
    expect(made).toMatchObject({ attempts: 1, billed: 0.25 });
    expect(readFileSync(join(made.delivered, "report.md"), "utf8")).toBe("by the agent\n");
    expect(made.log).toContain("attempt 1: rc=0 result=success turns=3 tools=2 cost_usd=0.2500");
    const none = await rolled("none", "true", [REFUSED, "None"]);
    expect(none).toMatchObject({ attempts: 2, billed: 0.5 });
    expect(none.log).toContain("NO OUTPUT");
    expect(existsSync(none.delivered)).toBe(false);
    expect((await rolled("spent", "true", ["error_max_budget_usd"])).attempts).toBe(1);
  });

  it("lists a campaign harness's own tool and finds its program before any rollout, and starts none without the word", async () => {
    const SCORE = new URL("../studies/harness2/score.ts", import.meta.url).pathname;
    const made = await campaign("on-pi", () => undefined, tooled());
    const place = join(root, "pi-whole");
    const [jb, out, task] = [join(place, "jb"), join(place, "out"), "alpha/task1"];
    mkdirSync(join(jb, "dataset", "main", task, "task_folder"), { recursive: true });
    writeFileSync(join(jb, "dataset", "main", task, "task_folder", "TASK_INSTRUCTIONS.txt"), "Report.");
    writeFileSync(join(jb, "dataset", "main", task, "RUBRICS.json"), "{}");
    for (const dir of [join(jb, "eval"), join(jb, ".venv", "bin"), join(place, "tmp")]) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(join(jb, "eval", "judge.py"), "# a stand-in that nothing here runs\n");
    writeFileSync(join(jb, ".venv", "bin", "python"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const score = (...args: string[]) =>
      runSync(
        [capturedExecPath, SCORE, "score", ...args, "--out", out, "--jb", jb, "--tasks", task].concat(
          "--api-base",
          "http://127.0.0.1:9/v1",
        ),
        { env: { ...runtimeProcess.env, TMPDIR: join(place, "tmp") }, timeout: 120_000 },
      );
    const arm = ["--arm", `pi:${made.log}`, "--harness", made.child, "--name", "pi-tooled"];
    const dry = score(...arm, "--dry-run");
    const told = decodeOutput(dry.stdout);
    expect(decodeOutput(dry.stderr)).toBe("");
    expect(dry.exitCode).toBe(0);
    expect(told).toContain("on pi-durable, inside the harness itself");
    // The export of this same harness names `doubled` unavailable and leaves `mark` off the path.
    expect(told).toMatch(/pi-solve: tools \[.*"doubled".*"submit"\]; 1 installed programs: \S+\/bin\/mark/u);
    const tree = join(out, "trees", "pi-tooled");
    expect((await openHarness(join(tree, "harness"))).digest).toBe(made.child);
    expect(existsSync(join(tree, "CLAUDE.md"))).toBe(false);
    // The tree and its build's price are all another machine needs: no campaign is read again.
    const elsewhere = ["--arm", `pi:${join(place, "no-campaign")}`, "--name", "pi-tooled"];
    expect(score(...elsewhere, "--dry-run").exitCode).toBe(0);
    renameSync(`${tree}.build.json`, `${tree}.build.kept`);
    expect(score(...elsewhere, "--dry-run").exitCode).not.toBe(0);
    renameSync(`${tree}.build.kept`, `${tree}.build.json`);
    const unsaid = score(...arm);
    expect(unsaid.exitCode).not.toBe(0);
    expect(decodeOutput(unsaid.stderr)).toContain("--yes");
    expect(existsSync(join(out, "dataset", task, "model_output"))).toBe(false);
    expect(readdirSync(join(place, "tmp"))).toStrictEqual([]);
  }, 240_000);
});
