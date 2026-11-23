// The Harness² study's halves that need no container: an arm's harness taken from a campaign by
// the owners the campaign's own handover uses, and two arms read as a campaign reads a comparison. The campaign is written here with the
// log's own `append`, and its kept states under the digests they open as, as a session's freeze
// keeps them. The compiled solver is run where the container's platform is the host's, and the
// solver from source, as the outside scorer's `pi:` arm starts it, on every platform.
import { afterAll, describe, expect, it } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { bundleArm, HERE, placeHarness, sourceNamed } from "../studies/shared/bundle.ts";
import { foreignHead, foreignPrograms } from "../src/harness/place.ts";
import { exportForClaudeCode, ownPython } from "../studies/shared/claude-export.ts";
import { keyless, RESULT_FILE, TRACE_FILE } from "../studies/shared/pi-solve.ts";
import { type Agent, type Claude, inGroup, REFUSED, rollout } from "../studies/harness2/h2/claude.ts";
import { installTree, readTree, validate } from "../studies/harness2/h2/tree.ts";
import { piAgent } from "../studies/harness2/score.ts";
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
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { errorMessage } from "../src/meta/runtime-values.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { openHarness, treeContent } from "../src/harness/open.ts";
import { EXAMPLE, HOST_ONLY, writeStarter } from "../src/harness/starter.ts";
import { writeHarness } from "./helpers/write-harness.ts";

/** A harness of the shell and one program, `mark`. */
const MARKED = {
  spec: { presets: ["bash"], tools: [] },
  programs: { mark: "#!/bin/sh\necho marked\n" },
};
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-study-harness2-test-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

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

  it("reads an arm's source from its two options, and refuses a kept harness of the starter", () => {
    expect(sourceNamed("starter", undefined)).toBe("starter");
    expect(sourceNamed("a-run", undefined)).toEqual({ campaign: "a-run" });
    expect(sourceNamed("a-run", "B")).toEqual({ campaign: "a-run", harness: "B" });
    expect(() => sourceNamed("starter", "B")).toThrow();
  });
});

describe("the container solver", () => {
  it("loads as one compiled file, where no file of the tree is beside it", () => {
    // The answer tool does not read its capture program from beside itself as it loads, which a
    // compiled solver does not hold, so the solver would end before it read a flag.
    const solver = join(root, "pi-solve-here");
    const source = join(import.meta.dir, "..", "studies", "shared", "pi-solve.ts");
    runSync([capturedExecPath, "build", "--compile", source, "--outfile", solver]);
    expect(decodeOutput(runSync([solver], { cwd: root }).stderr)).toContain("pi-solve needs --harness");
  }, 120_000);

  const native = runtimeProcess.platform === "linux" && runtimeProcess.arch === "x64";
  it.skipIf(!native)(
    "bundles a harness, and the compiled solver lists its tools or ends one that does not open as its own fail",
    async () => {
      const dry = async (name: string, spec?: string) => {
        const made = await campaign(name, () => undefined, MARKED);
        const mount = join(root, `mount-${name}`);
        await bundleArm(mount, { campaign: made.log, harness: made.child });
        if (spec !== undefined) writeFileSync(join(mount, "harness", "agent", "tools-spec.json"), spec);
        const logs = join(root, `logs-${name}`);
        mkdirSync(logs);
        writeFileSync(join(logs, "instruction.md"), "Fix it.");
        const flags = [
          ["--harness", join(mount, "harness")],
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
      expect(await dry("served")).toMatchObject({ ending: "dry-run", tools: ["bash", "submit"] });
      const declaring = '{ "presets": ["bash"], "tools": [{ "name": "doubled", "kind": "reader" }] }';
      const unopened = await dry("unopened", declaring);
      expect(unopened.ending).toBe("broken-harness");
      expect(unopened.reason).toContain("declares 1 tool (doubled)");
    },
    240_000,
  );
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
    // A link that stays in the tree is carried with what it names, to a file or to a folder.
    symlinkSync("fine", join(tree, "venv", "bin", "sh"));
    symlinkSync("bin", join(tree, "venv", "lib64"));
    await foreignPrograms(tree);
    writeFileSync(join(tree, "venv", "bin", "tool"), "#!/private/tmp/venv/bin/python\n");
    writeFileSync(join(tree, "mac"), head(0xcf, 0xfa, 0xed, 0xfe));
    await expect(foreignPrograms(tree)).rejects.toThrow(/mac \(a Mach-O binary\), venv\/bin\/tool/u);
    // A link out of the tree leads nowhere on another machine, by an absolute path or one above it.
    const links = join(root, "links");
    mkdirSync(join(links, "bin"), { recursive: true });
    symlinkSync("/opt/somewhere/python3.14", join(links, "bin", "python3.14"));
    symlinkSync("../../outside", join(links, "bin", "up"));
    symlinkSync("..", join(links, "parent"));
    await expect(foreignPrograms(links, HERE)).rejects.toThrow(
      /bin\/python3\.14 \(a link to \/opt\/somewhere\/python3\.14, outside the tree\), bin\/up \(a link to \.\.\/\.\.\/outside, outside the tree\), parent \(a link to \.\., outside the tree\)/u,
    );
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
  it("installs a tree into a task's workspace with its links as links, its modes and nothing it generates", () => {
    const tree = join(root, "linked-tree");
    const toolchain = join(tree, "scripts", "toolchain");
    mkdirSync(join(toolchain, "bin"), { recursive: true });
    mkdirSync(join(toolchain, "lib", "pkg", "__pycache__"), { recursive: true });
    mkdirSync(join(tree, ".claude"), { recursive: true });
    writeFileSync(join(tree, "CLAUDE.md"), "# Guide\n");
    writeFileSync(join(toolchain, "bin", "python3"), "#!/bin/sh\necho own\n", { mode: 0o755 });
    writeFileSync(join(toolchain, "lib", "pkg", "mod.py"), "X = 1\n");
    writeFileSync(join(toolchain, "lib", "pkg", "__pycache__", "mod.pyc"), "compiled");
    writeFileSync(join(tree, ".claude", "settings.json"), '{"hooks": "of the tree"}\n');
    // A link to a file, a link to a folder, as a virtual environment's `lib64 -> lib`, and one that
    // leads nowhere: the copy file by file wrote the first out as its target and dropped the others.
    symlinkSync("python3", join(toolchain, "bin", "python"));
    symlinkSync("lib", join(toolchain, "lib64"));
    symlinkSync("/nowhere/python3.14", join(toolchain, "bin", "python3.14"));
    // The workspace already holds the task, as a rollout's does when it stages the tree.
    const workspace = join(root, "linked-workspace");
    mkdirSync(join(workspace, "task"), { recursive: true });
    writeFileSync(join(workspace, "task", "prompt.md"), "the task\n");
    installTree(tree, workspace);
    const content = (dir: string) => treeContent(dir).filter(({ path }) => !path.includes("__pycache__"));
    expect(content(join(workspace, "scripts"))).toStrictEqual(content(join(tree, "scripts")));
    expect(treeContent(join(workspace, "scripts")).some(({ path }) => path.includes("__pycache__"))).toBe(
      false,
    );
    expect(readFileSync(join(workspace, "scripts", "toolchain", "lib64", "pkg", "mod.py"), "utf8")).toBe(
      "X = 1\n",
    );
    expect(readFileSync(join(workspace, "task", "prompt.md"), "utf8")).toBe("the task\n");
    // The settings Claude Code reads are the installer's, never the tree's own.
    expect(readFileSync(join(workspace, ".claude", "settings.json"), "utf8")).toBe("{}\n");
    expect(readFileSync(join(workspace, "CLAUDE.md"), "utf8")).toBe("# Guide\n");
  });

  it("makes the guide CLAUDE.md and copies the programs under scripts", async () => {
    const programs = {
      ...MARKED.programs,
      cat: "#!/bin/sh\necho the harness's cat\n",
      stage:
        "#!/bin/sh\n# stage [public/task.json] [--out DIR]\n#\n# Writes each input file of the task to DIR.\ncat public/task.json\n",
      count:
        "#!/bin/sh\n# count <file> [<file> ...] | count --task public/task.json\n#\n# Counts records.\necho 1\n",
      "python3.12": "#!/bin/sh\necho the harness's interpreter\n",
    };
    const own = `# Operating Guide\n\n## Programs and tools\n- \`mark\`: prints marked.\n- \`stage\`: unpacks public/task.json.\n\n## Domain notes\nA mark counts once.\n\n${HOST_ONLY}\nAn answer over three lines is not valid.\n`;
    const made = await campaign("exported", () => undefined, { ...MARKED, programs, guide: own });
    const into = join(root, "claude-tooled");
    const record = await exportForClaudeCode(into, { campaign: made.log, harness: made.child });
    expect(record.harness).toBe(made.child);
    expect(record.dropped).toStrictEqual(["agent/tools-spec.json", "agent/tools.ts"]);
    expect(record.hostOnlyPrograms).toStrictEqual(["stage"]);
    const guide = readFileSync(join(into, "CLAUDE.md"), "utf8");
    expect(guide).toContain("These harness programs are on your PATH");
    expect(guide).toContain("\n- cat\n- count: count <file> [<file> ...]\n- mark\n");
    expect(guide).not.toContain("stage");
    expect(guide).not.toContain("public/task.json");
    expect(guide).not.toContain("Writes each input file");
    expect(guide).toContain("(under `scripts/toolchain/bin`, behind system programs)");
    // No interpreter is named, the tool tree's own among its programs neither: a note that named
    // the harness's sent a solver to it for a look.
    expect(guide).not.toMatch(/python|interpreter/u);
    expect(guide).not.toContain("scripts/toolchain/bin/mark");
    expect(guide).not.toContain("export PATH");
    // What the guide keeps under its last heading, for the exam's own answer, stays behind.
    expect(guide.endsWith("- `mark`: prints marked.\n\n## Domain notes\nA mark counts once.\n")).toBe(true);
    expect(guide).not.toContain("three lines");
    expect(readFileSync(join(into, "scripts", "toolchain", "bin", "mark"), "utf8")).toContain("echo marked");
    // The tree holds the programs once: the copy of the harness kept for provenance has none.
    expect(existsSync(join(into, "harness", ".toolchain"))).toBe(false);
    // Installed as a rollout installs it, the one hook of the settings Claude Code reads writes
    // what a command runs first: after it the harness's program starts by name, and a name the
    // machine has too still starts the machine's.
    const workspace = join(root, "claude-tooled-workspace");
    installTree(into, workspace);
    expect(existsSync(join(workspace, ".claude", "hooks.json"))).toBe(false);
    const settings = parseJsonAs<{ hooks: { SessionStart: [{ hooks: [{ command: string }] }] } }>(
      readFileSync(join(workspace, ".claude", "settings.json"), "utf8"),
    );
    const out = join(root, "claude-tooled-mark.out");
    const env = { PATH: "/usr/bin:/bin", CLAUDE_PROJECT_DIR: workspace, CLAUDE_ENV_FILE: `${out}.env` };
    const run = async (script: string) =>
      inGroup(["/bin/sh", "-c", script], {
        cwd: workspace,
        env,
        stdout: out,
        stderr: `${out}.err`,
        timeoutS: 30,
      });
    expect(await run("mark")).not.toBe(0);
    expect(await run(settings.hooks.SessionStart[0].hooks[0].command)).toBe(0);
    expect(await run('. "$CLAUDE_ENV_FILE" && mark && echo cat | cat')).toBe(0);
    expect(readFileSync(out, "utf8")).toBe("marked\ncat\n");
    expect(parseJsonAs<{ harness: string }>(readFileSync(join(into, "export.json"), "utf8")).harness).toBe(
      made.child,
    );
    expect(() => validate(readTree(into))).not.toThrow();
  });

  it("strips host-only prose and offloads large reference sections into installable Claude Code skills", async () => {
    const programs = {
      ...MARKED.programs,
      "check-answer": "#!/bin/sh\n# check-answer [answer.json] [public/task.json]\nexit 0\n",
      "profile-data": "#!/bin/sh\n# profile-data <file> [<file> ...] (e.g. public/files/*.csv)\nexit 0\n",
    };
    const notes = Array.from(
      { length: 24 },
      (_, index) =>
        `- Topic ${String(index + 1)}: detailed domain methodology explaining how to handle measurement bias and variance across strata (${"x".repeat(60)}).`,
    ).join("\n");
    const own = [
      "# Operating Guide",
      "",
      "Deliver estimates in answer.json. You have 20 model turns: batch work into few commands.",
      "",
      "## Programs and tools",
      "- `profile-data public/files/*.csv`: inspects missing counts and ranges.",
      "- `check-answer`: tests answer.json against R1-R3.",
      "",
      "## Workflow (aim for about 6-10 turns)",
      "A good solve fits in 6-10 turns:",
      "1. One command: `cat public/task.json public/answer-format.json; ls -la public/files` (public/resources/ only repeats rules; skip it), then read every non-data document whole.",
      "2. Profile every table with `profile-data` before modelling.",
      "3. Write answer.json, run `check-answer`, then submit.",
      "",
      "## Validity (rules R1-R5 made concrete)",
      "- Every estimate must appear in answer.json with a workspace source_file.",
      "",
      "## Domain notes",
      notes,
      "",
    ].join("\n");
    const made = await campaign("exported-skills", () => undefined, { ...MARKED, programs, guide: own });
    const into = join(root, "claude-skills");
    const record = await exportForClaudeCode(into, { campaign: made.log, harness: made.child });
    expect(record.hostOnlyPrograms).toStrictEqual(["check-answer"]);
    expect(record.skills).toStrictEqual(["domain-notes"]);
    const guide = readFileSync(join(into, "CLAUDE.md"), "utf8");
    expect(guide).not.toContain("6-10 turns");
    expect(guide).not.toContain("20 model turns");
    expect(guide).not.toContain("public/resources/");
    expect(guide).not.toContain("public/task.json");
    expect(guide).not.toContain("answer.json");
    expect(guide).not.toContain("check-answer");
    expect(guide).not.toContain("Validity (rules R1-R5");
    expect(guide).toContain("1. Read every non-data document whole.");
    expect(guide).toContain("2. Profile every table with `profile-data` before modelling.");
    expect(guide).toContain("- `profile-data *.csv`: inspects missing counts and ranges.");
    expect(guide).toContain("use the `domain-notes` skill.");
    expect(guide.length).toBeLessThan(2000);
    const skillPath = join(into, ".claude", "skills", "domain-notes", "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);
    expect(readFileSync(skillPath, "utf8")).toContain("Topic 24:");
    // Valid under Harness²'s Claude Code surface validator and copied intact by installTree.
    expect(() => validate(readTree(into))).not.toThrow();
    const workspace = join(root, "claude-skills-workspace");
    installTree(into, workspace);
    expect(existsSync(join(workspace, ".claude", "skills", "domain-notes", "SKILL.md"))).toBe(true);
  });

  it("copies a tool tree whose programs run where it is exported byte for byte, asking no installer, and refuses it where they do not", async () => {
    // An ELF header for x86-64, whose bytes are all ASCII, so a program written as text holds it.
    const elf = `\u007FELF${"\0".repeat(14)}>\0`;
    const programs = { mark: "#!/bin/sh\necho marked\n", native: elf };
    const made = await campaign("exported-native", () => undefined, { ...MARKED, programs });
    const asked: string[] = [];
    const python = {
      interpreter: (version: string) => {
        asked.push(version);
        return null;
      },
      install: (_target: string, requirement: string) => {
        asked.push(requirement);
        return "no build";
      },
    };
    const linux = { name: "a Linux machine", mac: false, machine: 62, roots: null };
    const source = { campaign: made.log, harness: made.child };
    const into = join(root, "claude-native");
    const record = await exportForClaudeCode(into, source, linux, python);
    expect(asked).toStrictEqual([]);
    expect(record).not.toHaveProperty("rebuilt");
    const kept = join(made.states, made.child, ".toolchain");
    const exported = join(into, "scripts", "toolchain");
    const names = readdirSync(kept, { recursive: true, encoding: "utf8" }).toSorted();
    expect(readdirSync(exported, { recursive: true, encoding: "utf8" }).toSorted()).toStrictEqual(names);
    for (const name of names.filter((one) => one.includes("/"))) {
      expect(readFileSync(join(exported, name))).toStrictEqual(readFileSync(join(kept, name)));
    }
    const mac = { name: "a Mac", mac: true, machine: 183, roots: null };
    await expect(exportForClaudeCode(join(root, "claude-native-mac"), source, mac, python)).rejects.toThrow(
      /on a Mac: bin\/native \(an ELF binary for machine 62\), which no Python distribution or interpreter in the tree installed/u,
    );
    expect(existsSync(join(root, "claude-native-mac"))).toBe(false);
  });

  it("refuses a tree whose own python3 cannot start here, and counts what one that starts imports", async () => {
    const tree = (name: string, launcher: string) => {
      const dir = join(root, name);
      const site = join(dir, "scripts", "toolchain", "lib", "python3.99", "site-packages");
      mkdirSync(join(dir, "scripts", "toolchain", "bin"), { recursive: true });
      mkdirSync(join(site, "fine-1.0.dist-info"), { recursive: true });
      writeFileSync(join(dir, "scripts", "toolchain", "bin", "python3"), launcher, { mode: 0o755 });
      writeFileSync(join(site, "fine.py"), "X = 1\n");
      writeFileSync(join(site, "broken.py"), "import a_module_no_machine_has\n");
      writeFileSync(join(site, "fine-1.0.dist-info", "RECORD"), "fine.py,,\nbroken.py,,\n");
      return dir;
    };
    const env = { PATH: runtimeProcess.env.PATH ?? "" };
    // The launcher a Mac-built reference carried: its campaign machine's interpreter, by path.
    const named = tree("own-python-named", '#!/bin/sh\nexec /nowhere/bin/python3.14 "$@"\n');
    await expect(ownPython(named, env)).rejects.toThrow(
      /bin\/python3 cannot start here \(exit 12[67]: .*\/nowhere\/bin\/python3\.14/u,
    );
    // The launcher that takes the machine's interpreter with the tree's packages on its path.
    const site = '$(dirname "$0")/../lib/python3.99/site-packages';
    const taken = tree("own-python-taken", `#!/bin/sh\nPYTHONPATH="${site}" exec python3 "$@"\n`);
    expect(await ownPython(taken, env)).toMatch(
      /^its python3 is 3\.\d+\.\d+ and imports 1 of 2 of its modules, not broken$/u,
    );
    // A module whose import ends the interpreter, as a native one built for another minor can: the
    // count is said to have ended, and the read is not refused.
    writeFileSync(
      join(taken, "scripts", "toolchain", "lib", "python3.99", "site-packages", "broken.py"),
      "import os\nos._exit(3)\n",
    );
    expect(await ownPython(taken, env)).toBe(
      "its python3 starts, and the count of its modules ended (exit 3: )",
    );
    expect(await ownPython(join(root, "claude-starter-less"), env)).toBeNull();
    // A link to the campaign machine's interpreter leads nowhere here: the same defect, and no file
    // to a reader that follows links.
    const linked = tree("own-python-linked", "");
    rmSync(join(linked, "scripts", "toolchain", "bin", "python3"));
    symlinkSync("/nowhere/bin/python3.14", join(linked, "scripts", "toolchain", "bin", "python3"));
    await expect(ownPython(linked, env)).rejects.toThrow(/bin\/python3 cannot start here/u);
  });

  it("writes the starter's guide under the runtime header with no tool or skill line, and refuses a tree already made", async () => {
    const into = join(root, "claude-starter");
    const record = await exportForClaudeCode(into, "starter");
    expect(record).toMatchObject({ campaign: null, toolchain: null, searched: [] });
    const guide = readFileSync(join(into, "CLAUDE.md"), "utf8");
    expect(guide.startsWith("# Runtime environment")).toBe(true);
    expect(guide).toContain("Follow the task prompt and write all requested deliverables");
    expect(guide).not.toContain("scripts/toolchain");
    expect(guide).not.toContain("on your PATH");
    expect(guide).not.toContain("## On-demand skills");
    // The Starter's own host-only section is its last and holds nothing, so its export ends as it did.
    expect(guide.endsWith("## Domain notes\nNone yet.\n")).toBe(true);
    expect(existsSync(join(into, "scripts"))).toBe(false);
    expect(existsSync(join(into, ".claude"))).toBe(false);
    expect(() => validate(readTree(into))).not.toThrow();
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

  it("lists a campaign harness's tools and finds its program before any rollout, and starts none without the word", async () => {
    const SCORE = new URL("../studies/harness2/score.ts", import.meta.url).pathname;
    const made = await campaign("on-pi", () => undefined, MARKED);
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
    // Here `mark` leads the path; the export of this same harness puts it behind the machine's own.
    expect(told).toMatch(/pi-solve: tools \["bash","submit"\]; 1 installed programs: \S+\/bin\/mark/u);
    const tree = join(out, "trees", "pi-tooled");
    expect((await openHarness(join(tree, "harness"))).digest).toBe(made.child);
    expect(existsSync(join(tree, "CLAUDE.md"))).toBe(false);
    expect(
      parseJsonAs<{ harness: string; mode: string }>(readFileSync(join(tree, "export.json"), "utf8")),
    ).toMatchObject({ harness: made.child, mode: "pi" });
    // The tree and its build's price are all another machine needs: no campaign is read again.
    const elsewhere = ["--arm", `pi:${join(place, "no-campaign")}`, "--name", "pi-tooled"];
    expect(score(...elsewhere, "--dry-run").exitCode).toBe(0);
    renameSync(`${tree}.build.json`, `${tree}.build.kept`);
    expect(score(...elsewhere, "--dry-run").exitCode).not.toBe(0);
    renameSync(`${tree}.build.kept`, `${tree}.build.json`);
    const unsaid = score(...arm);
    expect(unsaid.exitCode).not.toBe(0);
    expect(decodeOutput(unsaid.stderr)).toContain("--yes");
    // A tree written here for another machine is priced and rolls nothing; a rollout names none.
    const far = (machine: string) =>
      runSync(
        [capturedExecPath, SCORE, "tree", "--arm", "starter", "--name", "far", "--out", out].concat(
          "--for",
          machine,
        ),
        { env: { ...runtimeProcess.env, TMPDIR: join(place, "tmp") }, timeout: 120_000 },
      );
    expect(far("plan9-x64").exitCode).not.toBe(0);
    expect(existsSync(join(out, "trees", "far"))).toBe(false);
    expect(decodeOutput(far("linux-x64").stdout)).toContain(", for linux-x64, under ");
    expect(readFileSync(join(out, "trees", "far.build.json"), "utf8")).toBe('{"of":"starter","usd":0}\n');
    expect(score(...arm, "--for", "linux-x64", "--dry-run").exitCode).not.toBe(0);
    expect(existsSync(join(out, "dataset", task, "model_output"))).toBe(false);
    expect(readdirSync(join(place, "tmp"))).toStrictEqual([]);
  }, 240_000);

  it("strips Host-only from pi-solve prompts, stages harness into logs, and honors ANA_SOLVER_WRAP", async () => {
    const made = await campaign("pi-host-only", () => undefined, {
      ...MARKED,
      guide: `# Operating Guide\n\nKeep general method.\n\n${HOST_ONLY}\nExam-only rule never shown outside.\n`,
    });
    const tree = join(root, "pi-wrapped-tree");
    mkdirSync(join(tree, "harness"), { recursive: true });
    cpSync(join(made.states, made.child), join(tree, "harness"), { recursive: true });
    const prevWrap = runtimeProcess.env.ANA_SOLVER_WRAP;
    runtimeProcess.env.ANA_SOLVER_WRAP = "/usr/bin/env";
    try {
      const traj = join(root, `pi-wrap-${String(runtimeProcess.pid)}.jsonl`);
      const argv = piAgent(pilot).argv({ prompt: "Solve task.", treeDir: tree, workspace: root, traj });
      expect(argv[0]).toBe("/usr/bin/env");
      const staged = argv[argv.indexOf("--harness") + 1] ?? "";
      expect(staged).not.toBe(join(tree, "harness"));
      expect(existsSync(join(staged, "agent", "BUILT_AGENTS.md"))).toBe(true);
      const logs = argv[argv.indexOf("--logs") + 1] ?? "";
      const dry = runSync([...argv, "--dry-run"], { cwd: root });
      expect(dry.exitCode).toBe(0);
      const result = parseJsonAs<{ ending: string; tools: string[]; prompt: string }>(
        readFileSync(join(logs, RESULT_FILE), "utf8"),
      );
      expect(result.ending).toBe("dry-run");
      expect(result.tools).toStrictEqual(["bash", "submit"]);
      expect(result.prompt).toContain("Keep general method.");
      expect(result.prompt).not.toContain("Exam-only rule never shown outside.");
    } finally {
      if (prevWrap === undefined) delete runtimeProcess.env.ANA_SOLVER_WRAP;
      else runtimeProcess.env.ANA_SOLVER_WRAP = prevWrap;
    }
  });
});

describe("the arms table over a store of judged records", () => {
  it("prints the judge's criteria beside an arm's points, and an unknown count where its details are gone", () => {
    const out = join(root, "table");
    /** One judged record of `arm`, and the judge's details with each rubric's criteria passed and read. */
    const judged = (
      arm: string,
      task: string,
      points: number,
      rubrics: (readonly [number, number])[] | null,
    ) => {
      const key = task.replace("/", "__");
      const label = `${arm}__${key}`;
      mkdirSync(join(out, "judged", arm), { recursive: true });
      writeFileSync(
        join(out, "judged", arm, `${key}.json`),
        capturedJsonStringify({
          arm,
          task,
          label,
          points,
          total: 10,
          solveUsd: 1,
          judgeUsd: 1,
          seconds: 60,
          cut: [],
        }),
      );
      if (rubrics === null) return;
      const place = join(out, "dataset", task, "eval_result", `eval_${label}`);
      mkdirSync(place, { recursive: true });
      writeFileSync(
        join(place, "claude-opus-5-5_judge.json"),
        capturedJsonStringify({
          rubrics: rubrics.map(([passed, count], index) => ({
            index,
            result: { criteria_passed: passed, criteria_count: count },
          })),
        }),
      );
    };
    // A rubric pays all or nothing: `near` misses one criterion of four and loses six points to `far`.
    judged("near", "stat/task2", 4, [
      [3, 3],
      [3, 4],
    ]);
    judged("far", "stat/task2", 10, [
      [3, 3],
      [4, 4],
    ]);
    judged("blind", "stat/task2", 10, null);
    for (const arm of ["near", "far", "blind"]) judged(arm, "bio/task2", 10, [[2, 2]]);
    const score = new URL("../studies/harness2/score.ts", import.meta.url).pathname;
    const printed = decodeOutput(
      runSync([capturedExecPath, score, "table", "--out", out, "--tasks", "stat/task2,bio/task2"]).stdout,
    );
    const line = (arm: string) =>
      printed.split("\n").find((each) => each.trimStart().startsWith(`${arm} `)) ?? "";
    expect(line("near")).toContain("score 14/20 (70.0%) criteria 8/9 ");
    expect(line("far")).toContain("score 20/20 (100.0%) criteria 9/9 ");
    expect(line("blind")).toContain("score 20/20 (100.0%) criteria ?/? ");
  });

  it("reads one arm's rollouts as a spread over the fair uncut tasks every one scored, the worst task first", () => {
    const out = join(root, "spread");
    const judged = (arm: string, task: string, points: number, cut: readonly string[] = []) => {
      mkdirSync(join(out, "judged", arm), { recursive: true });
      writeFileSync(
        join(out, "judged", arm, `${task.replace("/", "__")}.json`),
        capturedJsonStringify({ arm, task, label: arm, points, total: 10, cut }),
      );
    };
    judged("a", "stat/task2", 8);
    judged("b", "stat/task2", 6);
    judged("a", "bio/task2", 2);
    judged("b", "bio/task2", 4);
    // Nearest hostile cases: a task one rollout lacks, a first task, which is not fair, and a task
    // another arm's record cut, which leaves the block for every arm as it does in `table`.
    judged("a", "chem/task2", 10);
    judged("a", "stat/task1", 10);
    judged("b", "stat/task1", 10);
    judged("a", "soc/task2", 10);
    judged("b", "soc/task2", 10);
    judged("other", "soc/task2", 10, ["big.csv"]);
    const score = new URL("../studies/harness2/score.ts", import.meta.url).pathname;
    const printed = decodeOutput(
      runSync([capturedExecPath, score, "spread", "--out", out, "--name", "a,b"]).stdout,
    );
    expect(printed.split("\n").filter((line) => line !== "")).toEqual([
      "2 rollouts over the 2 fair uncut tasks each scored",
      "  a 10/20",
      "  b 10/20",
      "  range 10 to 10 (0 points)",
      "bio/task2: 2 to 4 of 10, mean 30.0%",
      "stat/task2: 6 to 8 of 10, mean 70.0%",
    ]);
    const misspelt = runSync([capturedExecPath, score, "spread", "--out", out, "--name", "a,c"]);
    expect(misspelt.exitCode).not.toBe(0);
    expect(decodeOutput(misspelt.stdout)).toBe("");
  });
});
