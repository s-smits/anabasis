/**
 * The Built Harness shell's two alignment defects of 2026-09-02, each with its hostile neighbour.
 *
 * Temp root: `darwinUserTempRoot` read the controller's `TMPDIR`, which a launchd run sets to a
 * private directory, while clang and the python3 shim write to the confstr directory whatever the
 * environment says. Measured over the week's recorded runs: 511 compiles failed with `unable to make
 * temporary file`. Tool tree: the adopted bundle's `.toolchain` is a symlink into a `campaigns/`
 * workspace, which the run-data pattern denies by name and which PATH never listed, so a tool the
 * Builder installed answered `command not found` in every case that named it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { type BuiltFilePort, createBuiltBashTool } from "../src/solve/built-bash.ts";
import { commandIsolationPolicy } from "../src/verify/solve-command-isolation.ts";
import { type SolveIsolationPolicy, solveIsolationPolicy } from "../src/verify/solve-sandbox.ts";
import { darwinUserTempRoot } from "../src/verify/wall-policy.ts";
import { withheldInstrumentPaths } from "../src/verify/tool-inventory.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { double } from "./helpers/doubles.ts";
import { errorMessage } from "../src/meta/runtime-values.ts";

const repoRoot = mkdtempSync(join(tmpdir(), "ana-bash-repo-"));
/** These tests prove the wall and the toolchain tree, not the destructive-command guard, which
 *  would refuse the `rm -r` and dynamic-path redirects below first (built-bash.test.ts proves the
 *  guard); they ask with no guard on the path. */
const NO_GUARD = { PATH: "" };
/** What a retained source excerpt carries, so a leak of its bytes has one string to be found by. */
const EXCERPT_MARKER = "ANA-SOURCE-EXCERPT-4e7b";

writeFileSync(join(repoRoot, "hidden-tasks.json"), '{"answer":"leaked"}\n');
// A candidate workspace where the run-data pattern denies by name: `/campaigns/` in the path.
const workspace = join(mkdtempSync(join(tmpdir(), "ana-bash-campaigns-")), "campaigns", "slug", "workspace");
mkdirSync(join(workspace, ".toolchain", "bin"), { recursive: true });
mkdirSync(join(workspace, "correctness-model", "sources"), { recursive: true });
writeFileSync(join(workspace, ".toolchain", "bin", "own-tool"), "#!/bin/sh\necho own-tool ran\n", {
  mode: 0o755,
});
writeFileSync(join(workspace, "correctness-model", "tasks.json"), '{"answer":"leaked"}\n');
// The passage a rule rests on, kept where contract.md offers it: hashed with the correctness model and
// read by review, never by the solver. Its name is what a listing would show.
const EXCERPT = join(workspace, "correctness-model", "sources", "vendor-datasheet.txt");
writeFileSync(EXCERPT, `Origin: https://vendor.example/datasheet rev C, table 4\n${EXCERPT_MARKER}\n`);
const sessionHome = mkdtempSync(join(tmpdir(), "ana-bash-home-"));
afterAll(() => {
  for (const dir of [repoRoot, workspace, sessionHome]) rmSync(dir, { recursive: true, force: true });
});

const policy = solveIsolationPolicy({ repoRoot });
if ("unsupported" in policy) throw new Error(`this host cannot run the isolation: ${policy.unsupported}`);
const session: SolveIsolationPolicy = policy;
const toolTree = join(workspace, ".toolchain");

function port(): BuiltFilePort {
  return { root: ".", files: async () => ({}), applyFiles: async () => {} };
}

async function run(command: string, tree: string | null = null): Promise<{ text: string; threw: boolean }> {
  try {
    const result = await createBuiltBashTool({
      policy: session,
      port: port(),
      home: sessionHome,
      toolTree: tree,
      guardEnv: NO_GUARD,
    }).execute("call-1", double({ command }), undefined, undefined);
    return {
      text: result.content.map((part) => (part.type === "text" ? part.text : "")).join(""),
      threw: false,
    };
  } catch (error) {
    return { text: errorMessage(error), threw: true };
  }
}

describe("the shared temporary directories", () => {
  it.if(runtimeProcess.platform === "darwin")(
    "takes the confstr directory and compiles C under a launchd-shaped private TMPDIR",
    async () => {
      const confstr = Bun.spawnSync(["/usr/bin/getconf", "DARWIN_USER_TEMP_DIR"])
        .stdout.toString()
        .trim()
        .replace(/\/$/, "");
      const previous = Bun.env.TMPDIR;
      Bun.env.TMPDIR = "/private/var/tmp/ana-test-private-tmp";
      try {
        expect(darwinUserTempRoot()).toBe(confstr);
        const result = await run(
          String.raw`printf '#include <stdio.h>\nint main(void){puts("built");return 0;}\n' > a.c && cc a.c -o a && ./a`,
        );
        expect(result.threw).toBe(false);
        expect(result.text).toContain("built");
      } finally {
        if (previous === undefined) delete Bun.env.TMPDIR;
        else Bun.env.TMPDIR = previous;
      }
    },
  );

  it("lets mktemp -d and /tmp writes through and keeps the product's own trees closed", async () => {
    const made = await run(
      'd=$(mktemp -d) && echo x > "$d/f" && cat "$d/f" && rm -r "$d"; mkdir -p /tmp/ana-bash-test-own && echo y > /tmp/ana-bash-test-own/f && cat /tmp/ana-bash-test-own/f && rm -r /tmp/ana-bash-test-own',
    );
    expect(made.text).toContain("x\ny");
    expect(made.threw).toBe(false);
    const verifier = mkdtempSync(join(tmpdir(), "ana-cell-"));
    writeFileSync(join(verifier, "staged.json"), '{"answer":"leaked"}\n');
    try {
      const peek = await run(`cat ${verifier}/staged.json; echo z > ${verifier}/new`);
      expect(peek.text).not.toContain("leaked");
      // Seatbelt refuses the path; the Linux tmpfs overmount makes it absent.
      expect(peek.text).toMatch(/Operation not permitted|No such file or directory/);
    } finally {
      rmSync(verifier, { recursive: true, force: true });
    }
  });
});

describe("the harness's own tool tree", () => {
  it("runs an installed tool by name and keeps the workspace beside it closed", async () => {
    const own = await run("own-tool && cat ../../correctness-model/tasks.json", toolTree);
    expect(own.text).toContain("own-tool ran");
    expect(own.text).not.toContain("leaked");
    const without = await run("own-tool");
    expect(without.threw).toBe(true);
    expect(without.text).toContain("not found");
  });

  // The shell is the solver tool that reads the disk. A command starts in a fresh folder holding only
  // the draft, its home holds only the public task, and the tree beside the one it is given by name
  // stays closed whichever way the excerpt's path is spelt: from the root, or back up from the tool.
  it("keeps a retained source excerpt out of the command's folder, its home and its reach", async () => {
    const listed = await run('find . "$HOME"', toolTree);
    expect(listed.threw).toBe(false);
    expect(listed.text).not.toContain("correctness-model");
    expect(listed.text).not.toContain("vendor-datasheet");
    // Spelt so the command's own text cannot match the marker it searches for.
    const pattern = `${EXCERPT_MARKER.slice(0, -1)}[${EXCERPT_MARKER.slice(-1)}]`;
    const read = await run(
      `own-tool; grep -rs '${pattern}' . "$HOME"; cat ${EXCERPT}; ` +
        'cat "$(dirname "$(command -v own-tool)")/../../correctness-model/sources/vendor-datasheet.txt"',
      toolTree,
    );
    expect(read.text).toContain("own-tool ran");
    expect(read.text).not.toContain(EXCERPT_MARKER);
    // Both reads reach the excerpt's path and are refused there, rather than missing a mistyped one.
    const refused =
      runtimeProcess.platform === "darwin"
        ? /Operation not permitted/g
        : /Operation not permitted|No such file or directory/g;
    expect(read.text.match(refused)).toHaveLength(2);
  });

  // Truss run 298967: the description named a `.toolchain` directory the command cannot see, so
  // every case looked for it there, found nothing and re-implemented the installed engine.
  it("names the installed programs, not a directory the command cannot see", async () => {
    const described = (tree: string | null) =>
      createBuiltBashTool({ policy: session, port: null, home: sessionHome, toolTree: tree }).description;
    expect(described(toolTree)).toContain("run by name: own-tool.");
    expect(described(toolTree)).not.toContain(".toolchain");
    expect(described(null)).not.toContain("run by name");
    expect((await run("ls .toolchain ~/.toolchain", toolTree)).text).toContain("No such file");
  });

  // The same run, one layer on. The list is bounded at twenty and cuts alphabetically, so what fills
  // the first slots decides what the solver hears about. A uv-made venv opens with nine entries that
  // run nothing — `activate` and its .bat, .csh, .fish, .nu, .ps1 and _this.py siblings,
  // `deactivate.bat` and `pydoc.bat`, all mode 644 and sourced — and they spent nearly half the
  // budget, leaving the Builder's own `truss-check` and `sectionprops` unnamed behind `pydoc.bat`
  // under an ellipsis that gave neither a count nor anywhere to look.
  it("names only what the command can run, and says where a cut tail is", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-bash-venv-"));
    const bin = join(root, ".toolchain", "bin");
    mkdirSync(bin, { recursive: true });
    const sourced = [
      "activate",
      "activate.bat",
      "activate.csh",
      "activate.fish",
      "activate.nu",
      "activate.ps1",
      "activate_this.py",
      "deactivate.bat",
      "pydoc.bat",
    ];
    const runnable = [
      "f2py",
      "isympy",
      "markdown-it",
      "normalizer",
      "numpy-config",
      "opensees",
      "openseespy",
      "pip",
      "pip3",
      "pip3.12",
      "py.test",
      "pygmentize",
      "pytest",
      "python",
      "python3",
      "python3.12",
      "sectionprops",
      "truss-check",
      "wheel",
    ];
    for (const name of sourced) {
      writeFileSync(join(bin, name), "# sourced, never executed\n", { mode: 0o644 });
    }
    for (const name of runnable) writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const describe_ = () =>
      createBuiltBashTool({
        policy: session,
        port: null,
        home: sessionHome,
        toolTree: join(root, ".toolchain"),
      }).description;

    const described = describe_();
    for (const name of sourced) expect(described, `${name} cannot be run by name`).not.toContain(name);
    // Nineteen runnable names fit inside the bound once the nine that run nothing stop spending it.
    for (const name of ["truss-check", "sectionprops", "openseespy"]) expect(described).toContain(name);
    expect(described).not.toContain("more this command's PATH holds");

    // Past the bound the tail is named by count and by where it is, rather than by an ellipsis.
    for (const name of ["zplot", "zsolve"]) {
      writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }
    const cut = describe_();
    expect(cut).toContain("zplot, and 1 more this command's PATH holds.");
    expect(cut).not.toContain("zsolve");
    rmSync(root, { recursive: true, force: true });
  });

  it("puts the tree first on PATH and into the policy identity", () => {
    const work = join(sessionHome, "work");
    const temp = join(sessionHome, "tmp");
    const withTree = commandIsolationPolicy(session, { work, home: sessionHome, temp, toolTree });
    const withoutTree = commandIsolationPolicy(session, { work, home: sessionHome, temp });
    expect(withTree.environment.PATH.split(":")[0]).toBe(join(toolTree, "bin"));
    expect(withoutTree.environment.PATH).not.toContain(toolTree);
    expect(withTree.policyHash).not.toBe(withoutTree.policyHash);
    expect(withTree.readAllowRoots.some((root) => root.endsWith("/.toolchain"))).toBe(true);
  });
});

// The operator's withheld-instruments condition: a check's deciding program in the bundle's own
// tree cannot be run by the solver, while the rest of the tree and the host's shared interpreters
// stay, and with nothing withheld the shell is byte-identical to the shell without the condition.
describe("withheld instruments", () => {
  const root = join(mkdtempSync(join(tmpdir(), "ana-bash-withheld-")), "campaigns", "slug", "workspace");
  const tree = join(root, ".toolchain");
  mkdirSync(join(tree, "bin"), { recursive: true });
  writeFileSync(join(tree, "bin", "check-tool"), "#!/bin/sh\necho check-tool ran\n", { mode: 0o755 });
  writeFileSync(join(tree, "bin", "solver-tool"), "#!/bin/sh\necho solver-tool ran\n", { mode: 0o755 });
  const withheld = withheldInstrumentPaths(["check-tool", "sh", "absent-tool"], tree);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  async function shell(command: string, closed: readonly string[]): Promise<string> {
    try {
      const result = await createBuiltBashTool({
        policy: session,
        port: port(),
        home: sessionHome,
        toolTree: tree,
        withheld: closed,
        guardEnv: NO_GUARD,
      }).execute("call-1", double({ command }), undefined, undefined);
      return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    } catch (error) {
      return errorMessage(error);
    }
  }

  it("withholds only the tree's own check tool, never a host interpreter or a missing id", () => {
    expect(withheld).toEqual([join(tree, "bin", "check-tool")]);
    expect(withheldInstrumentPaths(["check-tool"], null)).toEqual([]);
  });

  it("refuses the check-only instrument by name, by path and as a script, and runs the rest", async () => {
    const byName = await shell("check-tool; echo after-name", withheld);
    expect(byName).not.toContain("check-tool ran");
    expect(byName).toContain("after-name");
    const byPath = await shell(
      `${join(tree, "bin", "check-tool")}; sh ${join(tree, "bin", "check-tool")}; cat ${join(tree, "bin", "check-tool")}`,
      withheld,
    );
    expect(byPath).not.toContain("check-tool ran");
    expect(byPath).not.toContain("echo check-tool");
    const rest = await shell("solver-tool && sh -c 'echo shared interpreter ran'", withheld);
    expect(rest).toContain("solver-tool ran");
    expect(rest).toContain("shared interpreter ran");
  });

  it("leaves the check tool running and the description whole when the condition is off", async () => {
    expect(await shell("check-tool", [])).toContain("check-tool ran");
    const described = (closed: readonly string[]) =>
      createBuiltBashTool({
        policy: session,
        port: null,
        home: sessionHome,
        toolTree: tree,
        withheld: closed,
      }).description;
    expect(described([])).toContain("run by name: check-tool, solver-tool.");
    expect(described(withheld)).toContain("run by name: solver-tool.");
    expect(
      createBuiltBashTool({ policy: session, port: null, home: sessionHome, toolTree: tree }).description,
    ).toBe(described([]));
  });

  it("hashes and stages a policy with nothing withheld exactly as one without the condition", () => {
    const work = join(sessionHome, "work");
    const temp = join(sessionHome, "tmp");
    const before = commandIsolationPolicy(session, { work, home: sessionHome, temp, toolTree: tree });
    const empty = commandIsolationPolicy(session, {
      work,
      home: sessionHome,
      temp,
      toolTree: tree,
      withheld: [],
    });
    const closed = commandIsolationPolicy(session, {
      work,
      home: sessionHome,
      temp,
      toolTree: tree,
      withheld,
    });
    expect(empty).toEqual(before);
    expect(closed.policyHash).not.toBe(before.policyHash);
  });
});
