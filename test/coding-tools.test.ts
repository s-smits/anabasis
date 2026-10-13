// The solver's coding tools are pi's own four: their definitions as pi released them, the presets
// that select them, and the file tools' work done by walled commands, here over a plain shell in
// place of the wall. Then, on the real command wall: one working directory for every tool, the
// three timeout clauses, a failing exit, the CPU record, and a cut command's output kept in the home.
import { describe, expect, it } from "bun:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { createBashToolDefinition } from "../vendor/pi-coding-agent/core/tools/bash.ts";
import { createEditToolDefinition } from "../vendor/pi-coding-agent/core/tools/edit.ts";
import { createReadToolDefinition } from "../vendor/pi-coding-agent/core/tools/read.ts";
import { createWriteToolDefinition } from "../vendor/pi-coding-agent/core/tools/write.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import {
  bashTool,
  codingTools,
  fileTools,
  selectedCodingTools,
  type WallExec,
} from "../src/solve/coding-tools.ts";
import { type CommandWall, makeSeatDirs, shellSeconds, solveDirs } from "../src/solve/command.ts";
import { solveIsolationPolicy } from "../src/verify/solve-sandbox.ts";

const LIMITS = { shellDefaultSeconds: 300, shellMaxSeconds: 900 };

/** A scratch home and what stands in for the wall here: each command by a plain `/bin/sh` in a
 *  fresh folder of its own, its staged files written there first, as `runWalled` gives a command. */
function plainHome() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-coding-tools-")));
  const home = join(root, "home");
  mkdirSync(home);
  const commands: string[] = [];
  let runs = 0;
  const exec: WallExec = async (command, options = {}) => {
    commands.push(command);
    const work = join(root, `run-${String(runs++)}`);
    mkdirSync(work);
    options.stage?.(work);
    const child = Bun.spawn(["/bin/sh", "-c", command], { cwd: work, stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([
      new Response(child.stdout).arrayBuffer(),
      new Response(child.stderr).arrayBuffer(),
    ]);
    return { exitCode: await child.exited, output: Buffer.concat([Buffer.from(out), Buffer.from(err)]) };
  };
  const tools = new Map(fileTools(home, exec).map((tool) => [tool.name, tool]));
  const call = (name: string, params: JsonObject) => {
    const tool = tools.get(name);
    if (tool === undefined) throw new Error(`no tool ${name}`);
    // SAFETY: each test passes the arguments its tool declares.
    return tool.execute("call", params, undefined, undefined, undefined as never);
  };
  return { root, home, commands, call, done: () => rmSync(root, { recursive: true, force: true }) };
}

function text(result: AgentToolResult<unknown>): string {
  return result.content.map((part) => (part.type === "text" ? part.text : `<${part.type}>`)).join("");
}

describe("the solver's coding tools", () => {
  it("are pi's read, edit and write, by pi's own definitions", () => {
    const { home, done } = plainHome();
    try {
      const ours = fileTools(home, async () => ({ exitCode: 0, output: Buffer.alloc(0) }));
      const pis = [
        createReadToolDefinition(home),
        createEditToolDefinition(home),
        createWriteToolDefinition(home),
      ];
      expect(ours.map(({ name }) => name)).toEqual(["read", "edit", "write"]);
      for (const [index, pi] of pis.entries()) {
        const { name, label, description, parameters, promptSnippet, promptGuidelines } = ours[index] ?? pi;
        expect({ name, label, description, promptSnippet, promptGuidelines }).toEqual({
          name: pi.name,
          label: pi.label,
          description: pi.description,
          promptSnippet: pi.promptSnippet,
          promptGuidelines: pi.promptGuidelines,
        });
        expect(JSON.stringify(parameters)).toBe(JSON.stringify(pi.parameters));
      }
    } finally {
      done();
    }
  });

  it("are pi's bash, but for the timeout the host holds a command to", () => {
    const dirs = solveDirs("coding-tools-bash");
    const wall: CommandWall = {
      // SAFETY: no command runs in this test, so the policy is never read.
      base: undefined as never,
      dirs,
      toolTree: null,
      limits: LIMITS,
    };
    const ours = bashTool(wall);
    const pi = createBashToolDefinition(dirs.home);
    expect(ours.name).toBe("bash");
    expect(ours.label).toBe(pi.label);
    // The whole of what the tool says of itself is pi's: what the wall allows is the prompt's to say.
    expect(ours.description).toBe(
      "Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.",
    );
    expect(ours.description).toBe(pi.description);
    expect(ours.promptSnippet).toBe("Execute bash commands (ls, grep, find, etc.)");
    // pi's schema says "no default timeout", which is not so on this host.
    expect(JSON.parse(JSON.stringify(ours.parameters))).toEqual({
      ...JSON.parse(JSON.stringify(pi.parameters)),
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        timeout: {
          type: "number",
          description:
            "Timeout in seconds: 300 when omitted, at most 900; a value outside that range runs at the nearest end of it",
        },
      },
    });
    // Every tool a harness selects, in pi's order whatever order the harness names them in.
    expect(codingTools(wall, ["write", "bash", "read"]).map(({ name }) => name)).toEqual([
      "read",
      "bash",
      "write",
    ]);
  });

  it("are selected by a harness's presets, which name them as pi does", () => {
    expect(selectedCodingTools(["read", "bash", "edit", "write"])).toEqual(["read", "bash", "edit", "write"]);
    expect(selectedCodingTools(["write", "read", "read"])).toEqual(["read", "write"]);
    expect(selectedCodingTools([])).toEqual([]);
    // What a harness kept before pi's names were the presets asked for: the shell alone.
    expect(selectedCodingTools(["shell"])).toEqual(["bash"]);
    expect(() => selectedCodingTools(["bash", "python", "files"])).toThrow(
      "a solve serves pi's coding tools as presets (read, bash, edit, write), not python, files",
    );
  });

  it("lets a named timeout only raise the default, up to the maximum", () => {
    const table: [number | undefined, number, number][] = [
      [undefined, 300, 300],
      [120, 120, 300],
      [0, 1, 300],
      [-5, 1, 300],
      [450.9, 450, 450],
      [900, 900, 900],
      [880, 880, 880],
      [5000, 5000, 900],
    ];
    for (const [timeout, asked, seconds] of table) {
      expect(shellSeconds(timeout, LIMITS)).toEqual({ asked, seconds });
    }
  });
});

describe("the file tools, through walled commands", () => {
  it("write, read and edit one file, by a relative path, an absolute one and ~", async () => {
    const { home, call, done } = plainHome();
    try {
      expect(text(await call("write", { path: "src/a.py", content: "x = 1\ny = 2\n" }))).toBe(
        "Successfully wrote to src/a.py",
      );
      expect(readFileSync(join(home, "src", "a.py"), "utf8")).toBe("x = 1\ny = 2\n");
      expect(text(await call("read", { path: join(home, "src", "a.py") }))).toBe("x = 1\ny = 2\n");
      // `~` is the solver's home, as its shell has it, and not the home of the host's own user.
      expect(text(await call("read", { path: "~/src/a.py", offset: 2 }))).toBe("y = 2\n");
      await call("edit", { path: "~/src/a.py", edits: [{ oldText: "y = 2", newText: "y = 3" }] });
      expect(readFileSync(join(home, "src", "a.py"), "utf8")).toBe("x = 1\ny = 3\n");
      await call("write", { path: "~", content: "" }).then(
        () => {
          throw new Error("a write over the home directory was taken");
        },
        (error: Error) => expect(error.message).toContain("irectory"),
      );
    } finally {
      done();
    }
  });

  it("carry a file's bytes beside the command and never in it", async () => {
    const { root, home, commands, call, done } = plainHome();
    try {
      const content = `'; touch "${join(root, "ran")}"; echo '$(touch ${join(root, "ran")})\n\`id\`\n`;
      await call("write", { path: "odd name's.txt", content });
      expect(readFileSync(join(home, "odd name's.txt"), "utf8")).toBe(content);
      expect(text(await call("read", { path: "odd name's.txt" }))).toBe(content);
      expect(existsSync(join(root, "ran"))).toBe(false);
      expect(commands.some((command) => command.includes("touch"))).toBe(false);
    } finally {
      done();
    }
  });

  it("answer a missing file as pi's own tools do, and refuse one too large to read whole", async () => {
    const { home, call, done } = plainHome();
    try {
      await expect(call("read", { path: "absent.txt" })).rejects.toThrow(
        `ENOENT: no such file or directory, access '${join(home, "absent.txt")}'`,
      );
      await expect(
        call("edit", { path: "absent.txt", edits: [{ oldText: "a", newText: "b" }] }),
      ).rejects.toThrow("Could not edit file: absent.txt. Error code: ENOENT.");
      // 16 MiB and one byte: read whole it would sit in the host's memory, outside every wall.
      Bun.spawnSync(
        ["/bin/sh", "-c", `dd if=/dev/zero of=big.bin bs=1048576 count=16 2>/dev/null; printf x >> big.bin`],
        {
          cwd: home,
        },
      );
      await expect(call("read", { path: "big.bin" })).rejects.toThrow(
        "big.bin is larger than 16 MiB, the most the file tools read: read part of it with bash (head, tail, sed -n)",
      );
    } finally {
      done();
    }
  });

  it("read an image as an attachment, as pi's read does", async () => {
    const { home, call, done } = plainHome();
    try {
      // A 1x1 PNG.
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      );
      writeFileSync(join(home, "dot.png"), png);
      const result = await call("read", { path: "dot.png" });
      expect(result.content.map(({ type }) => type)).toEqual(["text", "image"]);
      expect(text(result)).toStartWith("Read image file [image/png]");
    } finally {
      done();
    }
  });
});

describe("the coding tools on the command wall", () => {
  it.skipIf(runtimeProcess.platform !== "darwin")(
    "share one working directory, name what the wall allowed on a cut, and keep the CPU and the cut output",
    async () => {
      const repoRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-coding-repo-")));
      const dirs = solveDirs(`coding-${String(runtimeProcess.pid)}-${String(Date.now())}`);
      try {
        makeSeatDirs(dirs);
        const base = solveIsolationPolicy({ repoRoot });
        if ("unsupported" in base) throw new Error(`this host cannot run the isolation: ${base.unsupported}`);
        const limits = { shellDefaultSeconds: 1, shellMaxSeconds: 2 };
        const wall: CommandWall = { base, dirs, toolTree: null, limits };
        const tools = new Map(
          codingTools(wall, ["read", "bash", "edit", "write"]).map((tool) => [tool.name, tool]),
        );
        const call = (name: string, params: JsonObject) => {
          const tool = tools.get(name);
          if (tool === undefined) throw new Error(`no tool ${name}`);
          // SAFETY: each call passes the arguments its tool declares.
          return tool.execute("call", params, undefined, undefined, undefined as never);
        };
        const bash = (command: string, timeout?: number) =>
          call("bash", timeout === undefined ? { command } : { command, timeout });

        // One working directory, the home, for a command and for a file tool alike: what one
        // writes by a relative path the other reads by the same.
        expect(text(await bash("pwd -P")).trim()).toBe(realpathSync.native(dirs.home));
        expect(text(await bash("echo kept > note && echo wrote"))).toBe("wrote\n");
        expect(text(await call("read", { path: "note" }))).toBe("kept\n");
        await call("write", { path: "lib/run.sh", content: "echo from-write\n" });
        expect(text(await bash("sh lib/run.sh"))).toBe("from-write\n");
        await call("edit", { path: "lib/run.sh", edits: [{ oldText: "from-write", newText: "from-edit" }] });
        expect(text(await bash("sh ~/lib/run.sh"))).toBe("from-edit\n");
        // The wall decides what a file tool reaches, as it decides for a command.
        writeFileSync(join(repoRoot, "hidden.txt"), "hidden\n");
        await expect(call("read", { path: join(repoRoot, "hidden.txt") })).rejects.toThrow();
        await expect(call("write", { path: join(repoRoot, "made.txt"), content: "x" })).rejects.toThrow();
        expect(existsSync(join(repoRoot, "made.txt"))).toBe(false);

        const sleep = "echo started; sleep 5";
        await expect(bash(sleep)).rejects.toThrow(
          "started\n\n\nCommand timed out after 1 seconds\n\nThe host allows 2 s for one command, and 1 s when you pass none, so there is more time to ask for.",
        );
        await expect(bash(sleep, 9)).rejects.toThrow(
          "Command timed out after 2 seconds\n\nYour 9 s is above the 2 s the host allows one command, so it ran as 2 s, the most there is.",
        );
        await expect(bash(sleep, 2)).rejects.toThrow(
          "Command timed out after 2 seconds\n\nThat is the whole 2 s the host allows one command.",
        );

        const failed = await bash("echo partial; exit 3");
        expect(failed.isError).toBe(true);
        expect(text(failed)).toBe("partial\n\n\nCommand exited with code 3");

        // A cut command's full output stays in this wall's home, where the solver can read it back.
        const cut = text(await bash("seq 1 3000"));
        const full = /Full output: (\S+)\]$/.exec(cut)?.[1] ?? "";
        expect(full.startsWith(join(dirs.home, ".shell-output", "pi-bash-"))).toBe(true);
        expect(text(await bash(`wc -l < ${full}`)).trim()).toBe("3000");
        // The host writes that file itself, so it never writes where a solver's link points: with
        // the folder made a link to the repository, the output is handed in by a walled command,
        // and the repository holds nothing new.
        await bash(`rm -rf ~/.shell-output && ln -s '${repoRoot}' ~/.shell-output`);
        await bash("seq 1 3000");
        expect(readdirSync(repoRoot)).toEqual(["hidden.txt"]);
        expect(readdirSync(dirs.kept)).toEqual(["long-output"]);
        expect(readdirSync(join(dirs.kept, "long-output"))).toEqual([]);
        // The host's folder is the host's: a command can neither write in it nor put a link there.
        const kept = join(dirs.kept, "long-output");
        await bash(
          `rm -rf '${kept}'; ln -s '${repoRoot}' '${dirs.kept}/elsewhere'; echo x > '${kept}/made'; true`,
        );
        expect(readdirSync(dirs.kept)).toEqual(["long-output"]);
        expect(readdirSync(kept)).toEqual([]);

        // A solver that removes its own home still has one for the next command.
        await bash("cd / && rm -rf ~");
        expect(text(await bash("pwd -P")).trim()).toBe(realpathSync.native(dirs.home));
      } finally {
        rmSync(dirs.root, { recursive: true, force: true });
        rmSync(dirs.host, { recursive: true, force: true });
        rmSync(repoRoot, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
