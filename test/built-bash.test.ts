/**
 * The shell the Built solver actually gets: what it can run, what it can name, what it may reach,
 * what survives between commands and what the draft carries back.
 *
 * Every case drives `createBuiltBashTool` the way a solve does — one session home, one in-memory
 * DraftStore stand-in — so the wall, the toolchain and the file exchange are proved together. The
 * session-level walls around the whole worker are proved by `solve-sandbox.test.ts`; this file owns
 * the per-command cell.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { homedir, tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { SAFEGUARDS_LOG_FILE, createSafeguardContext } from "../src/meta/safeguard.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { BUILT_BASH_TOOL, type BuiltFilePort, createBuiltBashTool } from "../src/solve/built-bash.ts";
import { DEFAULT_HARNESS_SETTINGS } from "../src/truth/harness-config.ts";
import { seedSessionHome } from "../src/solve/generated-tool-worker.ts";
import {
  RUN_DATA_DENY_PATTERNS,
  hostToolchainEnv,
  PROTECTED_HOME_NAMES,
  runDataDenyPaths,
  toolchainPathDirs,
} from "../src/verify/wall-policy.ts";
import {
  BUILT_COMMAND_SCRATCH_ROOT,
  commandIsolationEnvironment,
  commandIsolationPolicy,
  stageCommandIsolation,
} from "../src/verify/solve-command-isolation.ts";
import { type SolveIsolationPolicy, solveIsolationPolicy } from "../src/verify/solve-sandbox.ts";
import { serializeGeneratedToolParentFrame } from "../src/solve/generated-tool-worker-protocol.ts";
import { double } from "./helpers/doubles.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { errorMessage } from "../src/meta/runtime-values.ts";

const repoRoot = mkdtempSync(join(tmpdir(), "ana-bash-repo-"));
/** A stand-in for the private temporary tree production makes beside each command's work tree. */
const EXAMPLE_TEMP = "/tmp/ana-scratch-example-tmp";
const onDarwin = runtimeProcess.platform === "darwin";
const onLinux = runtimeProcess.platform === "linux";
// Seatbelt refuses a protected read with "Operation not permitted"; under bubblewrap the path is
// absent from the namespace, so the toolchain reports it missing (a write hits a read-only root).
// The bytes never appearing is the assertion that matters — this only names how the refusal reads.
const REFUSED = onLinux
  ? /Operation not permitted|No such file or directory|Read-only file system|Permission denied/
  : /Operation not permitted/;

/** A canary planted outside every tree the command owns, and the command that tries to read it. */
interface Closed {
  name: string;
  plant: () => { command: string; canary: string; cleanup: () => void };
}

writeFileSync(join(repoRoot, "hidden-tasks.json"), '{"answer":"leaked"}\n');
afterAll(() => rmSync(repoRoot, { recursive: true, force: true }));

const policy = solveIsolationPolicy({ repoRoot });
if ("unsupported" in policy) throw new Error(`this host cannot run the isolation: ${policy.unsupported}`);
const session: SolveIsolationPolicy = policy;

// One session home, as production creates one per worker session. `run` reuses it, so a command
// installing into HOME is visible to the next command exactly as it is in a real solve.
const sessionHome = mkdtempSync(join(tmpdir(), "ana-bash-home-"));
afterAll(() => rmSync(sessionHome, { recursive: true, force: true }));

const EXAMPLE_DIRS = { work: "/tmp/ana-scratch-example", home: sessionHome, temp: EXAMPLE_TEMP };

/** One in-memory stand-in for the worker's DraftStore, so the test owns both ends of the
 *  exchange without a worker process. */
/** Root `.` puts the draft at the top of the command's folder, so most commands here name draft
 *  files directly; the named-root layout production uses has its own test. */
function port(initial: Record<string, string>, root = ".") {
  const state = { files: { ...initial }, applied: 0 };
  const wired: BuiltFilePort = {
    root,
    files: async () => ({ ...state.files }),
    applyFiles: async (files) => {
      state.files = files;
      state.applied += 1;
    },
  };
  return { state, wired };
}

/** `guard: false` asks no destructive-command guard, for the tests that prove the wall itself:
 *  the host's guard refuses a truncating redirect into the operator's home before the wall sees
 *  it, and those tests assert the wall's refusal. Every other test runs as production does. */
async function run(
  wired: BuiltFilePort,
  command: string,
  timeout?: number,
  guard = true,
): Promise<{ text: string; threw: boolean; details: unknown }> {
  const tool = createBuiltBashTool({
    policy: session,
    port: wired,
    home: sessionHome,
    guardEnv: guard ? Bun.env : { PATH: "" },
  });
  try {
    const result = await tool.execute(
      "call-1",
      double(timeout === undefined ? { command } : { command, timeout }),
      undefined,
      undefined,
    );
    return {
      text: result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
      threw: false,
      details: result.details,
    };
  } catch (error) {
    return { text: errorMessage(error), threw: true, details: null };
  }
}

describe("the shell the solver is given", () => {
  it.concurrent("carries the name the registration uses", () => {
    expect(createBuiltBashTool({ policy: session, port: port({}).wired, home: sessionHome }).name).toBe(
      BUILT_BASH_TOOL,
    );
  });

  // The `shell` preset (operator decision 2026-09-14): a structured answer keeps its own writer, so
  // this shell has no draft files. Work survives in the session home; the work tree returns nothing.
  it.concurrent("keeps work in the session home and returns no draft files under the shell preset", async () => {
    const tool = createBuiltBashTool({ policy: session, port: null, home: sessionHome });
    const text = async (command: string): Promise<string> =>
      (await tool.execute("call-1", double({ command }), undefined, undefined)).content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n");
    await text('echo gone > shell-preset-here.txt && cd "$HOME" && echo kept > shell-preset-kept.txt');
    const second = await text('ls && cd "$HOME" && cat shell-preset-kept.txt');
    expect(second).toContain("kept");
    expect(second).not.toContain("shell-preset-here.txt");
    expect(second).not.toContain("Draft files now");
    expect(tool.description).toContain("nothing there becomes your answer");
    // Every runtime the toolchain case below runs by name is named, and none is called complete.
    expect(tool.description).toContain("sh, bun, node, python3");
    expect(tool.description).toContain("check one before building on it");
  });
});

describe("a command over the draft files", () => {
  it.concurrent("runs the draft's own files and carries what it wrote back into the draft", async () => {
    const { state, wired } = port({ "main.py": "print('from the draft')\n" });
    const result = await run(wired, "python3 main.py && echo made > note.txt");
    expect(result.threw).toBe(false);
    expect(result.text).toContain("from the draft");
    expect(state.files["note.txt"]).toBe("made\n");
    expect(state.files["main.py"]).toBe("print('from the draft')\n");
    expect(result.text).toContain("Draft files now: 2");
  });

  it.concurrent("shows the draft in a folder named after the answer root, as the checker lays it out", async () => {
    // Run 08c0f2: with the draft at the top of the folder, `firmware/firmware.ino` compiled as
    // `firmware` in the shell and failed at the checker, which found it one folder deeper.
    const { state, wired } = port(
      { "firmware.ino": "flat\n", "firmware/firmware.ino": "nested\n" },
      "firmware",
    );
    const result = await run(
      wired,
      "cat firmware/firmware.ino && echo x > scratch.txt && echo y > firmware/fw.h",
    );
    expect(result.text).toContain("flat");
    expect(result.text).not.toContain("nested");
    expect(Object.keys(state.files).sort()).toStrictEqual(["firmware.ino", "firmware/firmware.ino", "fw.h"]);
    expect(createBuiltBashTool({ policy: session, port: wired, home: sessionHome }).description).toContain(
      "whose `firmware/` folder is your answer's `firmware` root",
    );
  });

  it.concurrent("represents a deletion, which the file tools alone cannot express", async () => {
    const { state, wired } = port({ "keep.txt": "keep\n", "drop.txt": "drop\n" });
    await run(wired, "rm drop.txt");
    expect(Object.keys(state.files)).toStrictEqual(["keep.txt"]);
  });

  // A failing command can still produce useful output. Keep the files it wrote before failing so
  // the agent can inspect or continue that work.
  it.concurrent("keeps the files a failing command wrote and still reports the failure", async () => {
    const { state, wired } = port({});
    const result = await run(wired, "echo partial > out.txt; exit 3");
    expect(result.threw).toBe(true);
    expect(result.text).toContain("exited with code 3");
    expect(state.files["out.txt"]).toBe("partial\n");
  });

  it.concurrent("restores draft files in each command's fresh working directory", async () => {
    const { state, wired } = port({});
    await run(wired, "echo one > tracked.txt && echo two > .hidden-untracked");
    const second = await run(wired, String.raw`ls -a | tr '\n' ' '`);
    expect(state.applied).toBe(2);
    expect(second.text).toContain("tracked.txt");
    // `.hidden-untracked` came back through the draft, not through a shared directory.
    expect(Object.keys(state.files)).toContain(".hidden-untracked");
  });
});

describe("the toolchain a command can name", () => {
  // A read grant lets a toolchain be opened; PATH decides whether it can be named. Both come from
  // wall-policy.ts, so a toolchain the Harness Builder installs becomes usable without a second
  // list being edited. Measured before this held: arduino-cli, pio and uv ran from
  // /opt/homebrew/bin while rustc reported "command not found" with ~/.cargo/bin/rustc readable.
  it.concurrent("searches the same install roots the profile opens for reading", () => {
    const searched = commandIsolationEnvironment(EXAMPLE_DIRS).PATH.split(":");
    for (const dir of toolchainPathDirs()) {
      expect(searched).toContain(dir);
      // Every searched directory exists, so PATH never names a place this host does not have.
      expect(existsSync(dir)).toBe(true);
    }
  });

  // HOME stays inside the scratch tree because writes outside it are refused. The cost is a
  // toolchain that looks for its own installation under $HOME: rustc failed with "rustup could not
  // choose a version" while ~/.rustup sat readable. These names put it back, read-only.
  it.concurrent("points a toolchain at its real installation without moving HOME off the scratch tree", () => {
    const scratch = "/tmp/ana-scratch-example";
    const environment = commandIsolationEnvironment({ work: scratch, home: scratch, temp: EXAMPLE_TEMP });
    expect(environment.HOME).toBe(scratch);
    for (const [name, value] of Object.entries(hostToolchainEnv())) {
      expect(environment[name]).toBe(value);
      expect(value.startsWith(scratch)).toBe(false);
      expect(existsSync(value)).toBe(true);
    }
  });

  it.concurrent("compiles and runs a C program, the runtime the previous profile advertised and refused", async () => {
    const { wired } = port({ "main.c": '#include <stdio.h>\nint main(){printf("cc ok\\n");return 0;}\n' });
    const result = await run(wired, "cc main.c -o out && ./out");
    expect(result.threw).toBe(false);
    expect(result.text).toContain("cc ok");
  });

  // A resolver walks every ancestor of the file it opens. With the shared scratch parent denied and
  // no traversal grant, an interpreter run through a recorded scratch tree failed with
  // "EPERM: operation not permitted, lstat <parent>" for every script on disk while `-e` still
  // worked, so nothing the agent wrote could run.
  it.concurrent("runs a script from disk, not only from -e", async () => {
    const { wired } = port({ "solve.js": "console.log(41 + 1);\n" });
    const result = await run(wired, "bun solve.js");
    expect(result.threw).toBe(false);
    expect(result.text).toContain("42");
  }, 180_000);

  it.concurrent("still runs the whole toolchain, so a narrowed profile fails here rather than inside a run", async () => {
    const { wired } = port({ "main.py": "print('py ok')\n" });
    const result = await run(
      wired,
      "sh -c 'echo sh ok' && bun --no-env-file -e \"console.log('bun ok')\" && " +
        "python3 main.py && mkdir -p a/b && echo x | grep x | sed s/x/y/ | awk '{print \"pipe\", $1}'",
    );
    expect(result.threw).toBe(false);
    for (const line of ["sh ok", "bun ok", "py ok", "pipe y"]) expect(result.text).toContain(line);
    if (onDarwin) {
      // Nothing had to be declared for this to work: the read default is open, and the toolchain
      // roots the previous allow list had to enumerate are simply not denied.
      const { profile } = commandIsolationPolicy(session, EXAMPLE_DIRS);
      for (const root of ["/usr", "/opt", "/Library"]) expect(profile).not.toContain(`(subpath "${root}")`);
    }
  });
});

describe("the command profile", () => {
  it.skipIf(!onLinux)(
    "opens reads, overmounts protected roots, and binds the work tree and session home read-write",
    () => {
      const isolation = commandIsolationPolicy(session, EXAMPLE_DIRS);
      expect(isolation.mechanismId).toBe("linux-bwrap/v1");
      expect(isolation.profile).toContain("linux-bwrap command isolation");
      const staged = stageCommandIsolation(isolation, "/tmp/ignored-on-linux", "true");
      expect(staged).not.toContain("'--unshare-net'");
      expect(staged).toContain("'--ro-bind' '/' '/'");
      expect(staged).toContain("'--bind' '/tmp/ana-scratch-example' '/tmp/ana-scratch-example'");
      // The repository is closed by a rule that names it, the way Darwin closes it, rather than by
      // never having been bound. The same holds for the credential stores.
      expect(staged).toContain(`'--tmpfs' '${repoRoot}'`);
      // A protected root is covered either by its own hiding rule or by an ancestor tmpfs: the Linux
      // profile hides the whole session home and re-binds only declared toolchain roots.
      for (const name of PROTECTED_HOME_NAMES) {
        const root = join(homedir(), name);
        if (!existsSync(root)) continue;
        const ownRule = staged.includes(`'--tmpfs' '${root}'`) || staged.includes(`'/dev/null' '${root}'`);
        const wholeHomeHidden =
          staged.includes(`'--tmpfs' '${Bun.env.HOME}'`) && root.startsWith(String(Bun.env.HOME));
        expect(ownRule || root.startsWith(sessionHome) || wholeHomeHidden).toBe(true);
      }
      // The root bind opens the host BEFORE anything is hidden, and the one writable tree is bound
      // back AFTER: a protected root that landed after its own tmpfs would be readable again.
      const openedAt = staged.indexOf("'--ro-bind' '/' '/'");
      const hiddenAt = staged.indexOf(`'--tmpfs' '${repoRoot}'`);
      expect(hiddenAt).toBeGreaterThan(openedAt);
      expect(staged.indexOf("'--bind' '/tmp/ana-scratch-example'")).toBeGreaterThan(hiddenAt);
      expect(staged).toContain(`'--bind' '${sessionHome}' '${sessionHome}'`);
    },
  );

  it.skipIf(!onLinux)("hides the shared temporary directory and every peer checkout under it", () => {
    // One command's scratch tree, a concurrent verification's staged workdir and this command's own
    // tree all live in the shared temporary directory. It is hidden whole and the one tree comes
    // back, so a sibling is closed without its mkdtemp path being known when the policy is written.
    expect(commandIsolationPolicy(session, EXAMPLE_DIRS).readDenies).toContain(tmpdir());
    // A peer checkout carrying run data is closed as a path, because a mount cannot match a name.
    // It sits beside the verified repository, which is where the 2026-08-04 leak was read from.
    const peer = mkdtempSync(join(tmpdir(), "ana-peer-checkout-"));
    mkdirSync(join(peer, "domains", "shared-slug", "correctness-model"), { recursive: true });
    try {
      expect(runDataDenyPaths(session.deniedReadRoots)).toContain(peer);
      expect(commandIsolationPolicy(session, EXAMPLE_DIRS).readDenies).toContain(peer);
    } finally {
      rmSync(peer, { recursive: true, force: true });
    }
  });

  it.skipIf(!onDarwin)("opens reads by default and closes writes everywhere but one scratch tree", () => {
    const { profile } = commandIsolationPolicy(session, EXAMPLE_DIRS);
    const lines = profile.split("\n");
    expect(lines[1]).toBe("(allow default)");
    // Outbound network is open (operator decision 2026-08-15, reaffirmed 2026-09-06), in the same
    // spelling the Harness Builder's authoring wall uses.
    expect(profile).toContain("(allow network*)");
    expect(profile).not.toContain("(deny network*)");
    // Seatbelt takes the last matching rule, so the order is the policy: the whole-filesystem write
    // deny comes first and the one scratch tree re-opens after it.
    const rootDeny = lines.findIndex((line) => line.startsWith("(deny file-write*"));
    expect(rootDeny).toBeGreaterThan(0);
    expect(lines.findIndex((line) => line.startsWith("(allow file-write*"))).toBeGreaterThan(rootDeny);
    // The repository stays closed to writes even after the re-allow, through the rename guards
    // emitted last, so widening the scratch tree could never open it.
    expect(profile.slice(profile.indexOf("(allow file-write*"))).toContain(repoRoot);
  });

  it.skipIf(!onDarwin)("closes run data by name, so a copy in an unnamed place is closed too", () => {
    const own = join(BUILT_COMMAND_SCRATCH_ROOT, "run-mine", "work");
    const { profile } = commandIsolationPolicy(session, { work: own, home: sessionHome, temp: EXAMPLE_TEMP });
    const lines = profile.split("\n");
    // Reads are open, so the read boundary is the deny list. Two kinds of rule carry it: subpaths
    // for the places this run knows (its repository, the credential stores, the shared scratch
    // parent) and name patterns for run data wherever an earlier run left a copy.
    for (const pattern of RUN_DATA_DENY_PATTERNS) expect(profile).toContain(`(regex #"${pattern}")`);
    expect(profile).toContain(`(subpath "${repoRoot}")`);
    expect(profile).toContain(`(subpath "${BUILT_COMMAND_SCRATCH_ROOT}")`);
    // This command's own tree is re-opened after the shared parent is denied, so a sibling case's
    // draft stays closed while the command can still read what it wrote. Seatbelt takes the last
    // matching rule, so that order is the property.
    const lastIndexWhere = (matches: (line: string) => boolean): number =>
      lines.reduce((found, line, index) => (matches(line) ? index : found), -1);
    const parentDeny = lastIndexWhere((line) => line.includes(`(subpath "${BUILT_COMMAND_SCRATCH_ROOT}")`));
    expect(parentDeny).toBeGreaterThan(0);
    expect(lastIndexWhere((line) => line.includes(`(subpath "${own}")`))).toBeGreaterThan(parentDeny);
    expect(lastIndexWhere((line) => line.includes(`(subpath "${sessionHome}")`))).toBeGreaterThan(parentDeny);
  });

  it.concurrent("records a command policy identity distinct from the session policy", () => {
    const isolation = commandIsolationPolicy(session, EXAMPLE_DIRS);
    expect(isolation.policyHash).not.toBe(session.policyHash);
    expect(
      commandIsolationPolicy(session, { ...EXAMPLE_DIRS, work: "/tmp/ana-scratch-other" }).policyHash,
    ).not.toBe(isolation.policyHash);
  });

  it.concurrent("names the private temporary tree in the environment and opens it in the policy", () => {
    expect(commandIsolationEnvironment(EXAMPLE_DIRS).TMPDIR).toBe(EXAMPLE_TEMP);
    expect(commandIsolationEnvironment(EXAMPLE_DIRS).HOME).toBe(sessionHome);
    expect(commandIsolationPolicy(session, EXAMPLE_DIRS).scratchRoots).toContain(EXAMPLE_TEMP);
  });

  // run49-sol-0902 counted 284 compiler temporary-file and 40 temporary-directory permission
  // failures: TMPDIR pointed at the session home, which every later command inherits. A tree per
  // command is writable to any depth, is neither the home nor the work tree, and is gone when the
  // command ends, so a build's scratch is not returned as a draft file.
  it.concurrent("gives each command a writable TMPDIR of its own and takes it away again", async () => {
    const { state, wired } = port({});
    const result = await run(
      wired,
      // Spelled as the prompt's shell rules ask: a redirect to a relative literal path, since the
      // guard refuses `> "$TMPDIR/…"` as a dynamic target (2026-09-06, guard on the Built path).
      'mkdir -p "$TMPDIR/deep/er" && cd "$TMPDIR/deep/er" && echo scratch > one.txt && ' +
        String.raw`cat one.txt && printf "at %s\n" "$TMPDIR"`,
    );
    expect(result.threw).toBe(false);
    expect(result.text).toContain("scratch");
    const reported = String(result.text.split("at ")[1]).split("\n")[0] ?? "";
    // Derived from the constant so a renamed scratch parent moves this with it.
    expect(reported).toContain(
      `${BUILT_COMMAND_SCRATCH_ROOT.slice(BUILT_COMMAND_SCRATCH_ROOT.lastIndexOf("/"))}/`,
    );
    expect(reported.endsWith("/tmp")).toBe(true);
    expect(reported.startsWith(sessionHome)).toBe(false);
    expect(existsSync(reported)).toBe(false);
    expect(Object.keys(state.files)).toStrictEqual([]);
  });
});

describe("what a command cannot reach", () => {
  const closed: Closed[] = [
    {
      name: "the verified repository",
      plant: () => ({
        command: `cat ${repoRoot}/hidden-tasks.json`,
        canary: "leaked",
        cleanup: () => undefined,
      }),
    },
    {
      // What a second case solved at the same time holds: a draft under the shared parent, with a
      // name this command never learns but could list. Cases of one family carry near-identical
      // drafts, so a readable sibling would make three concurrent trials less than independent.
      name: "another case's scratch tree",
      plant: () => {
        mkdirSync(BUILT_COMMAND_SCRATCH_ROOT, { recursive: true, mode: 0o700 });
        const sibling = mkdtempSync(join(BUILT_COMMAND_SCRATCH_ROOT, "run-"));
        writeFileSync(join(sibling, "answer.py"), "print('another case draft')\n");
        return {
          command: `ls ${BUILT_COMMAND_SCRATCH_ROOT}; cat ${sibling}/answer.py`,
          canary: "another case draft",
          cleanup: () => rmSync(sibling, { recursive: true, force: true }),
        };
      },
    },
    {
      // The measured leak this profile closes. A live run holds `domains/<slug>/correctness-model`
      // inside its own worktree, which the session policy denies; every earlier run holds the same
      // files in a worktree of its own, which it does not name. Runs repeat a slug, so the
      // neighbour is not another domain's data but this task family's own tasks and verifier source.
      name: "another run's worktree holding the same domain's answer key",
      plant: () => {
        const peer = mkdtempSync(join(tmpdir(), "ana-peer-worktree-"));
        const model = join(peer, "domains", "shared-slug", "correctness-model");
        mkdirSync(model, { recursive: true });
        writeFileSync(join(model, "tasks.json"), '[{"taskId":"t1","publicInput":{"leaked":true}}]\n');
        writeFileSync(join(model, "evaluator.ts"), "// leaked verifier source\n");
        return {
          command: `cat ${model}/tasks.json ${model}/evaluator.ts`,
          canary: "leaked",
          cleanup: () => rmSync(peer, { recursive: true, force: true }),
        };
      },
    },
    {
      // One rule, two mechanisms: Darwin matches the `campaigns` name wherever it sits, and
      // bubblewrap has the whole shared temporary directory overmounted.
      name: "campaign data in a carrier that names no run",
      plant: () => {
        const carrier = mkdtempSync(join(tmpdir(), "ana-open-home-"));
        const campaign = join(carrier, "campaigns", "some-run");
        mkdirSync(campaign, { recursive: true });
        writeFileSync(join(campaign, "case.json"), '{"leaked":true}\n');
        return {
          command: `cat ${join(campaign, "case.json")}`,
          canary: "leaked",
          cleanup: () => rmSync(carrier, { recursive: true, force: true }),
        };
      },
    },
    {
      name: "ordinary operator-home state",
      plant: () => {
        const ordinary = mkdtempSync(join(Bun.env.HOME ?? tmpdir(), ".ana-built-home-"));
        writeFileSync(join(ordinary, "canary.txt"), "HOST-HOME-CANARY\n");
        return {
          command: `ls -A ${ordinary}; cat ${join(ordinary, "canary.txt")}`,
          canary: "HOST-HOME-CANARY",
          cleanup: () => rmSync(ordinary, { recursive: true, force: true }),
        };
      },
    },
  ];
  for (const { name, plant } of closed) {
    it.concurrent(`refuses ${name}`, async () => {
      const { command, canary, cleanup } = plant();
      try {
        const result = await run(port({}).wired, command);
        expect(result.text).not.toContain(canary);
        expect(result.text).toMatch(REFUSED);
      } finally {
        cleanup();
      }
    });
  }

  // The two mechanisms refuse differently and the assertion is about neither: Seatbelt denies the
  // listing, bubblewrap overmounts the directory so the listing succeeds and shows nothing. What
  // has to hold on both is that no entry the host actually has ever appears.
  it.concurrent("refuses the operator's own transport state", async () => {
    const transport = join(Bun.env.HOME ?? "", ".ssh");
    const onDisk = existsSync(transport) ? readdirSync(transport) : [];
    const result = await run(port({}).wired, `ls -A ${transport}`);
    if (onDisk.length === 0) expect(result.text).toMatch(REFUSED);
    for (const entry of onDisk) expect(result.text).not.toContain(entry);
  });

  // `stat` is a separate operation from `open`. The temporary-directory grant names
  // `file-read-metadata` outright and Seatbelt prefers the rule naming the more specific operation,
  // so a scratch-parent deny naming only `file-read*` left the size of a sibling case's draft
  // readable: measured 2026-09-03, `stat` answered "28 bytes" while `cat` of the same file answered
  // "Operation not permitted". The slug directory itself stays ordinary, so library paths such as
  // sympy/polys/domains do not become run data because an ancestor has that generic name.
  it.concurrent("refuses metadata as well as content, in a scratch tree and in an unnamed domain copy", async () => {
    mkdirSync(BUILT_COMMAND_SCRATCH_ROOT, { recursive: true, mode: 0o700 });
    const sibling = mkdtempSync(join(BUILT_COMMAND_SCRATCH_ROOT, "run-"));
    writeFileSync(join(sibling, "answer.py"), "print('another case draft')\n");
    const peer = mkdtempSync(join(tmpdir(), "ana-peer-stat-"));
    const model = join(peer, "domains", "shared-slug", "correctness-model");
    mkdirSync(model, { recursive: true });
    try {
      const { wired } = port({});
      const size = await run(
        wired,
        `stat -f '%z bytes' ${sibling}/answer.py || stat -c '%s bytes' ${sibling}/answer.py`,
      );
      expect(size.text).not.toContain("28 bytes");
      expect(size.text).toMatch(REFUSED);
      const walked = await run(wired, `stat ${model}`);
      expect(walked.threw).toBe(true);
      expect(walked.text).toMatch(/Operation not permitted|stat: cannot stat|No such file or directory/);
    } finally {
      rmSync(sibling, { recursive: true, force: true });
      rmSync(peer, { recursive: true, force: true });
    }
  });

  // The scratch tree is writable, so the command can create a link out of it. Seatbelt matches the
  // resolved path, so the linked file remains protected. Exercise both a directory link and a
  // direct file link because either could bypass a rule matching only the input path.
  it.concurrent("refuses a protected path reached through a symlink the command planted itself", async () => {
    const result = await run(
      port({}).wired,
      `ln -s ${repoRoot} escape && cat escape/hidden-tasks.json; ln -s ${repoRoot}/hidden-tasks.json direct && cat direct`,
    );
    expect(result.text).not.toContain("leaked");
    expect(result.text).toMatch(REFUSED);
  });

  // The write allow opens the whole per-user temporary directory. The verifier stages its own
  // workdir there (`verify/host.ts`, mkdtempSync(join(tmpdir(), "ana-cell-"))), so a command that
  // could read or write one would reach a verification running beside it. The path is only known at
  // run time, so the rule names the prefix rather than the directory.
  it.skipIf(!onDarwin)("cannot reach a concurrent verification's staged workdir", async () => {
    const staged = mkdtempSync(join(tmpdir(), "ana-cell-"));
    writeFileSync(join(staged, "expected.json"), '{"answer":"leaked"}\n');
    try {
      const result = await run(
        port({}).wired,
        `cat ${staged}/expected.json; echo x > ${staged}/planted.txt`,
        undefined,
        false,
      );
      expect(result.text).not.toContain("leaked");
      expect(result.text).toMatch(REFUSED);
      expect(existsSync(join(staged, "planted.txt"))).toBe(false);
    } finally {
      rmSync(staged, { recursive: true, force: true });
    }
  });

  // The negative control for the run-data name rules: an ordinary library path holding a `domains`
  // directory is the agent's to read.
  it.skipIf(!onDarwin)("reads an ordinary library domains directory", async () => {
    const library = mkdtempSync(join(tmpdir(), "ana-library-"));
    const ordinary = join(library, "sympy", "polys", "domains");
    mkdirSync(ordinary, { recursive: true });
    writeFileSync(join(ordinary, "canary.txt"), "ordinary library domains\n");
    try {
      const result = await run(port({}).wired, `cat ${join(ordinary, "canary.txt")}`);
      expect(result.threw).toBe(false);
      expect(result.text).toContain("ordinary library domains");
    } finally {
      rmSync(library, { recursive: true, force: true });
    }
  });

  // The shared temporary directory is writable, because Darwin's clang resolves its scratch
  // directory through `confstr` and ignores `TMPDIR`; without it `cc` cannot make a temporary file
  // and the Built Harness has a compiler it is told about and cannot run. That is the whole
  // exception. The operator's home is the case that must stay refused.
  it.concurrent("cannot write to the host outside its own directory and the shared temporary one", async () => {
    const target = join(Bun.env.HOME ?? tmpdir(), "ana-bash-escape-probe.txt");
    rmSync(target, { force: true });
    const result = await run(port({}).wired, `echo escaped > ${target}`, undefined, false);
    // Seatbelt refuses the write outright; bubblewrap lets it land in the throwaway namespace
    // tmpfs. Either way the write never reaches the host file — the property the isolation owns.
    if (onDarwin) {
      expect(result.threw).toBe(true);
      expect(result.text).toMatch(REFUSED);
    }
    expect(existsSync(target)).toBe(false);
  });

  // Serial on purpose: the case writes a fake credential into the process environment to prove the
  // cell inherits nothing, and asserts the child's COMPLETE set of variable names. Both the write
  // and that exact-set assertion are process-global facts a concurrent sibling can move.
  it("receives no provider credential, because it inherits no environment at all", async () => {
    Bun.env.ANA_BASH_TEST_TOKEN = "sk-must-not-leak";
    try {
      const result = await run(port({}).wired, "env");
      for (const secret of ["sk-must-not-leak", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"]) {
        expect(result.text).not.toContain(secret);
      }
      // The whole environment is the set the isolation authors: four fixed names, plus the ones
      // that point a toolchain at its own installation. Nothing is inherited.
      const names = result.text
        .split("\n")
        .flatMap((line) => (line.includes("=") ? line.split("=").slice(0, 1) : []))
        .filter((name) => name !== "_" && name !== "PWD" && name !== "SHLVL")
        .sort();
      expect(names).toStrictEqual(
        ["HOME", "LANG", "PATH", "TMPDIR", ...Object.keys(hostToolchainEnv())].sort(),
      );
    } finally {
      Bun.env.ANA_BASH_TEST_TOKEN = undefined;
    }
  });

  // Outbound network is open (operator decision 2026-08-15, reaffirmed 2026-09-06). The wall never
  // refuses the connection; a host without a route still fails, but not with the sandbox's own
  // refusal, and a reachable host returns the page.
  it.concurrent("is not refused the network", async () => {
    const result = await run(port({}).wired, "curl -sS -m 5 https://example.com", 20);
    expect(result.text).not.toMatch(/Operation not permitted/);
    if (!result.threw) expect(result.text).toContain("Example Domain");
  }, 180_000);

  it.concurrent("stops a command that would otherwise run forever", async () => {
    // A passed timeout raises the harness's wall and no longer lowers it, so the wall is proved by
    // bounding the harness rather than by asking two seconds of a three-hundred-second default.
    const tool = createBuiltBashTool({
      policy: session,
      port: port({}).wired,
      home: sessionHome,
      timeouts: { ...DEFAULT_HARNESS_SETTINGS, shellDefaultSeconds: 2, shellMaxSeconds: 2 },
    });
    const text = await tool.execute("call-1", double({ command: "sleep 60" }), undefined, undefined).then(
      () => "",
      (error: unknown) => errorMessage(error),
    );
    expect(text).toContain("timed out");
  }, 180_000);
});

describe("what a command leaves running", () => {
  const alive = (pid: number): boolean => {
    try {
      runtimeProcess.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const startedPid = (text: string): number => Number(String(text.split("started ")[1]).split("\n")[0]);

  const escapes: Array<[string, string, string]> = [
    // truss-opus-20260915T160303030Z-298967: `nohup python3 r3.py > log 2>&1 & sleep 100` returned
    // normally and the search ran on under launchd at 99 % CPU after its shell died; pi kills the
    // process group only on timeout.
    ["a plain background job", "sleep 300 >/dev/null 2>&1 & echo started $!; exit 0", ""],
    // A command's `exec` once replaced the shell that owned the cleanup trap, so the trap never ran
    // and the sleep outlived the command. The exit code of the replacing process still reports.
    [
      "a shell that replaced itself",
      "sleep 300 >/dev/null 2>&1 & echo started $!; exec /bin/sh -c 'exit 4'",
      "exited with code 4",
    ],
    // The group kill alone misses `setsid`: python's start_new_session puts the sleep in its own
    // group and session, and only the walk from the shell through the live parent reaches it.
    [
      "a child that left the process group",
      'python3 -c \'import subprocess,time; p=subprocess.Popen(["sleep","300"],start_new_session=True); print("started",p.pid,flush=True); time.sleep(300)\' & sleep 1; exit 0',
      "",
    ],
  ];
  for (const [name, command, failure] of escapes) {
    it.concurrent(`ends what ${name} left behind`, async () => {
      const result = await run(port({}).wired, command);
      const pid = startedPid(result.text);
      try {
        expect(pid).toBeGreaterThan(1);
        expect(result.threw).toBe(failure !== "");
        if (failure !== "") expect(result.text).toContain(failure);
        for (let waited = 0; waited < 40 && alive(pid); waited += 1) await Bun.sleep(50);
        expect(alive(pid)).toBe(false);
      } finally {
        if (pid > 1 && alive(pid)) runtimeProcess.kill(pid, "SIGKILL");
      }
    });
  }
});

describe("what the draft carries back", () => {
  it.concurrent("leaves behind what it cannot carry and keeps everything else", async () => {
    const oversize = port({ "keep.txt": "keep\n" });
    const big = await run(oversize.wired, "python3 -c \"open('big.txt','w').write('x'*300000)\"");
    expect(big.text).toContain("1 other entry could not be carried");
    expect(oversize.state.files).toStrictEqual({ "keep.txt": "keep\n" });

    // Octal escapes, not \xNN: POSIX printf (Linux /bin/sh is dash) guarantees \NNN but not hex.
    const binary = port({});
    const mixed = await run(binary.wired, String.raw`printf '\200\201' > binary.bin && echo text > kept.txt`);
    expect(Object.keys(binary.state.files)).toStrictEqual(["kept.txt"]);
    expect(mixed.text).toContain("could not be carried");
  }, 180_000);

  // The bounds decide what a command's own leftovers cost. They must never decide whether the agent
  // still has the answer it arrived with: `applyFiles` replaces the whole map, so a path omitted
  // here is a path deleted, and the omission cannot tell a deliberate deletion from a file the
  // transport stopped being able to carry.
  it.concurrent("keeps the previous content when an existing answer file becomes uncarryable", async () => {
    for (const [why, command] of [
      ["binary", String.raw`printf '\200\201' > answer.txt`],
      ["oversize", "python3 -c \"open('answer.txt','w').write('x'*300000)\""],
      ["symlink", "rm answer.txt && ln -s /etc/hosts answer.txt"],
    ] as const) {
      const { state, wired } = port({ "answer.txt": "the answer\n", "other.txt": "other\n" });
      const result = await run(wired, command);
      expect(state.files["answer.txt"], why).toBe("the answer\n");
      expect(state.files["other.txt"], why).toBe("other\n");
      expect(result.text, why).toContain("answer.txt");
      expect(result.text, why).toContain("previous content was kept");
    }
  });

  it.concurrent("keeps previous text for grown files the apply frame cannot carry together", async () => {
    const names = Array.from({ length: 9 }, (_, index) => `part-${String(index)}.txt`);
    const { state, wired } = port(Object.fromEntries(names.map((name) => [name, "small\n"])));
    const result = await run(
      wired,
      `python3 -c "[open(f'part-{i}.txt','w').write('x'*262144) for i in range(9)]"`,
    );
    expect(result.threw).toBe(false);
    expect(() =>
      serializeGeneratedToolParentFrame({ type: "apply_files", requestId: "r", files: state.files }),
    ).not.toThrow();
    // Three JSON-escaped 256 KiB files fit the 1 MiB answer bound; the other six keep their text.
    expect(
      Object.values(state.files)
        .map((text) => text.length)
        .toSorted((a, b) => b - a),
    ).toStrictEqual([262144, 262144, 262144, 6, 6, 6, 6, 6, 6]);
    expect(result.text).toContain("previous content was kept");
  });

  it.concurrent("still deletes a file the command actually removed", async () => {
    const { state, wired } = port({ "answer.txt": "the answer\n", "other.txt": "other\n" });
    await run(wired, "rm answer.txt");
    expect(Object.keys(state.files)).toStrictEqual(["other.txt"]);
  });

  // A 2026-08-19 simulation walked the path the open network invites: install a toolchain, then
  // compile with it. Both commands failed, and the first one took the agent's own edit with it.
  it.concurrent("keeps an install across commands, where the draft never has to carry it", async () => {
    const { state, wired } = port({ "sketch.ino": "void setup(){}\n" });
    const first = await run(
      wired,
      String.raw`mkdir -p "$HOME/toolchain" && cd "$HOME/toolchain" && printf 'echo compiled\n' > cc && chmod +x cc`,
    );
    expect(first.threw).toBe(false);
    const second = await run(wired, "$HOME/toolchain/cc");
    expect(second.threw).toBe(false);
    expect(second.text).toContain("compiled");
    // The toolchain is the session's, not the answer's: it never becomes a draft file.
    expect(Object.keys(state.files)).toStrictEqual(["sketch.ino"]);
  });

  // The bound is a bound on what the draft carries, not a reason to discard the answer. A command
  // that fills its home, or overruns the bound in the work tree, keeps the agent's own files.
  it.concurrent("keeps the agent's own edit when a command floods the home or the work tree", async () => {
    const home = port({ "sketch.ino": "void setup(){}\n" });
    const filled = await run(
      home.wired,
      String.raw`printf 'void setup(){ edited(); }\n' > sketch.ino; cd "$HOME" && seq 1 600 | xargs touch; echo installed`,
    );
    expect(filled.threw).toBe(false);
    expect(home.state.files["sketch.ino"]).toContain("edited");

    const work = port({ "sketch.ino": "void setup(){}\n" });
    const overrun = await run(
      work.wired,
      // One touch over 600 names, not 600 spawns: the same overrun, without a test that fails
      // whenever the host is busy.
      String.raw`printf 'void setup(){ edited(); }\n' > sketch.ino; seq 1 600 | sed 's/$/.txt/' | xargs touch; echo done`,
    );
    expect(overrun.threw).toBe(false);
    expect(overrun.text).toContain("could not be carried");
    expect(work.state.files["sketch.ino"]).toContain("edited");
    expect(Object.keys(work.state.files).length).toBe(512);
  });

  it.concurrent.each([0, 7])(
    "preserves native checkpoint progress and draft writes when the shell exits %i",
    async (exitCode) => {
      const { state, wired } = port({ "sketch.ino": "before" });
      const updates: string[] = [];
      const tool = createBuiltBashTool({ policy: session, port: wired, home: sessionHome });
      const result = tool.execute(
        "checkpoint",
        double({
          command: `sleep 2.1; printf after > sketch.ino; echo checkpoint-output; exit ${String(exitCode)}`,
        }),
        undefined,
        (update) =>
          updates.push(
            update.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
          ),
      );
      if (exitCode === 0) {
        expect((await result).content).toContainEqual({
          type: "text",
          text: expect.stringContaining("checkpoint-output"),
        });
      } else await expect(result).rejects.toThrow("exited with code 7");
      expect(state.files["sketch.ino"]).toBe("after");
      expect(updates.join("\n")).toContain("checkpoint-output");
    },
  );
});

/** Operator decision 2026-09-06: the Built shell runs behind the same destructive-command guard as
 *  the Builder's pi shell. A guard that answers refuses before the command starts; a guard that
 *  answers nothing has decided nothing, so the command runs, as the fail-open policy intends, and
 *  the run whose shell asked keeps the only durable trace of it. */
describe("the destructive-command guard", () => {
  const guardBin = (body: string[]): string => {
    const bin = mkdtempSync(join(tmpdir(), "ana-built-guard-"));
    writeFileSync(join(bin, "dcg"), [...body, ""].join("\n"), { mode: 0o700 });
    chmodSync(join(bin, "dcg"), 0o700);
    return bin;
  };

  it.concurrent("refuses a blocked command before it runs, and runs it with no guard on the path", async () => {
    const bin = guardBin([
      "#!/bin/sh",
      'if [ "${1:-}" = "--version" ]; then printf "%s\\n" 9.9.9; exit 0; fi',
      "command=$(/bin/cat)",
      'case "$command" in',
      `  *"rm -rf"*) printf "%s" '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED by dcg\\nRule: core.filesystem:rm-rf-general"}}' ;;`,
      "esac",
      "exit 0",
    ]);
    const guardEnv = { PATH: bin, HOME: mkdtempSync(join(tmpdir(), "ana-built-guard-home-")) };
    const { state, wired } = port({ "keep.txt": "kept\n" });
    const guarded = createBuiltBashTool({ policy: session, port: wired, home: sessionHome, guardEnv });
    await expect(
      guarded.execute("call-1", double({ command: "rm -rf ../keep.txt" }), undefined, undefined),
    ).rejects.toThrow("BLOCKED by dcg");
    // The refusal quotes the Built list's accepted spelling, with its own trash location.
    await expect(
      guarded.execute("call-1", double({ command: "rm -rf ../keep.txt" }), undefined, undefined),
    ).rejects.toThrow(
      "Accepted: Delete a tree with rm -rf <relative path> or ~/<path>, also after cd ~; /tmp is shared with other solves, so keep your trees in $HOME.",
    );
    expect(state.files["keep.txt"]).toBe("kept\n");

    // The 2026-08-20 behaviour the decision replaced: with no guard installed the command runs.
    const open = createBuiltBashTool({
      policy: session,
      port: wired,
      home: sessionHome,
      guardEnv: { PATH: mkdtempSync(join(tmpdir(), "ana-no-guard-")) },
    });
    await open.execute("call-2", double({ command: "rm -rf keep.txt" }), undefined, undefined);
    expect(state.files["keep.txt"]).toBeUndefined();
    rmSync(bin, { recursive: true, force: true });
  });

  // Safeguard 32 through the caller production uses. The row has to reach the asking run's own log,
  // because a concurrent run's shell asking an answering guard must stay silent.
  it.concurrent("writes the unanswered-guard line under the run whose shell asked", async () => {
    // dcg's terminal layout on stdout instead of its hook JSON: a complete process, no decision.
    const broken = guardBin([
      "#!/bin/sh",
      "/bin/cat >/dev/null",
      "printf '%s' 'dcg: internal error'",
      "exit 0",
    ]);
    const answering = guardBin(["#!/bin/sh", "/bin/cat >/dev/null", "exit 0"]);
    const home = mkdtempSync(join(tmpdir(), "ana-built-guard-home-"));
    const asking = mkdtempSync(join(tmpdir(), "ana-safeguards-"));
    const other = mkdtempSync(join(tmpdir(), "ana-safeguards-"));
    const mine = port({ "keep.txt": "kept\n" });
    const theirs = port({ "keep.txt": "kept\n" });

    const unguarded = createBuiltBashTool({
      policy: session,
      port: mine.wired,
      home: sessionHome,
      guardEnv: { PATH: broken, HOME: home },
      safeguardContext: createSafeguardContext(asking),
    });
    await unguarded.execute("call-1", double({ command: "rm -rf keep.txt" }), undefined, undefined);
    expect(mine.state.files["keep.txt"]).toBeUndefined();
    const rows = readFileSync(join(asking, SAFEGUARDS_LOG_FILE), "utf8").trim().split("\n");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(
      `| 32-command-guard-unanswered | 1 installed guard(s) answered nothing about a "rm" command, which then ran unguarded: ${join(broken, "dcg")}`,
    );

    const guarded = createBuiltBashTool({
      policy: session,
      port: theirs.wired,
      home: sessionHome,
      guardEnv: { PATH: answering, HOME: home },
      safeguardContext: createSafeguardContext(other),
    });
    await guarded.execute("call-1", double({ command: "rm -rf keep.txt" }), undefined, undefined);
    expect(theirs.state.files["keep.txt"]).toBeUndefined();
    expect(existsSync(join(other, SAFEGUARDS_LOG_FILE))).toBe(false);
    expect(readFileSync(join(asking, SAFEGUARDS_LOG_FILE), "utf8").trim().split("\n")).toHaveLength(1);
    rmSync(broken, { recursive: true, force: true });
    rmSync(answering, { recursive: true, force: true });
  });
});

// The shell's own text advises "a driver you write once and re-run there, reading its inputs from a
// file". Before the home was seeded, creating that file meant retyping the public input into a
// heredoc first — paying output tokens for data already in the first turn.
describe("the public inputs a command finds on disk", () => {
  it("writes the task and its resources into the session home, and names them once", async () => {
    const home = mkdtempSync(join(tmpdir(), "ana-bash-seed-"));
    try {
      const written = seedSessionHome(
        home,
        { taskId: "t1", family: "beams", publicInput: { spanMm: 4200 } },
        [
          { name: "design rules", content: { deflectionLimit: 250 }, digest: "d1" },
          // Sanitises onto the name above: both files are kept rather than one overwriting the other.
          { name: "design/rules", content: { deflectionLimit: 125 }, digest: "d2" },
        ],
      );
      expect(written).toBe(2);
      expect(readdirSync(join(home, "public", "resources")).sort()).toStrictEqual([
        "design-rules-2.json",
        "design-rules.json",
      ]);

      const tool = createBuiltBashTool({ policy: session, port: null, home, publicResourceFiles: written });
      expect(tool.description).toContain("public/task.json");
      expect(tool.description).toContain("public/resources/ (2 files)");

      const result = await tool.execute(
        "call-1",
        double({ command: 'cat "$HOME/public/task.json"; cat "$HOME/public/resources/design-rules.json"' }),
        undefined,
        undefined,
      );
      const text = result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
      expect(text).toContain('"spanMm": 4200');
      expect(text).toContain('"deflectionLimit": 250');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("says nothing about a resources folder a domain has not filled", () => {
    const home = mkdtempSync(join(tmpdir(), "ana-bash-seed-empty-"));
    try {
      expect(seedSessionHome(home, { taskId: "t2", family: "beams", publicInput: {} }, [])).toBe(0);
      const tool = createBuiltBashTool({ policy: session, port: null, home, publicResourceFiles: 0 });
      expect(tool.description).toContain("public/task.json");
      expect(tool.description).not.toContain("public/resources/");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("a command its own wall cut", () => {
  /** The shell under a deliberately tiny budget, so a real wall fires in test time. */
  const bounded = (shellDefaultSeconds: number, shellMaxSeconds: number) =>
    createBuiltBashTool({
      policy: session,
      port: null,
      home: sessionHome,
      timeouts: { ...DEFAULT_HARNESS_SETTINGS, shellDefaultSeconds, shellMaxSeconds },
    });
  const failing = async (tool: ReturnType<typeof bounded>, command: string, timeout?: number) => {
    try {
      const result = await tool.execute(
        "call-1",
        double(timeout === undefined ? { command } : { command, timeout }),
        undefined,
        undefined,
      );
      return result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
    } catch (error) {
      return errorMessage(error);
    }
  };

  // Three states, and a command must land in exactly one. c1d2a7 passed timeout: 120 on 42 of the
  // 74 calls its traces record and was cut 21 times in 18 solves, under a bundle granting 300 s by
  // default and 900 s on request: "Command timed out after 120 seconds" names the number it chose
  // and never the number it had.
  it("offers the seconds still available when the ask was below the maximum", async () => {
    const text = await failing(bounded(1, 4), "sleep 30", 1);
    expect(text).toContain(
      "This harness allows 4 s for one command, and 1 s when you pass none, so there is more time to ask for.",
    );
    // The file holding those numbers is the Builder's lever, not the solver's; naming it would
    // point the solver at something it cannot reach mid-battery.
    expect(text).not.toContain("config.yaml");
  });

  it("says an ask above the maximum was cut, instead of silently running a shorter one", async () => {
    // The clamp was a bare Math.min: c1d2a7 asked once for 1500 s, got 900 and was told neither.
    const text = await failing(bounded(1, 2), "sleep 30", 1500);
    expect(text).toContain(
      "Your 1500 s is above the 2 s this harness allows one command, so it ran as 2 s — the most there is, and the move left is cheaper work rather than longer.",
    );
    expect(text).not.toContain("more time to ask for");
  });

  it("names the maximum once when the ask already was the maximum", async () => {
    // Not a clamp: an exact ask is not an error to report back, and the seconds must be stated once
    // rather than in both an "above the maximum" sentence and a "the whole maximum" one.
    const text = await failing(bounded(1, 2), "sleep 30", 2);
    expect(text).toContain(
      "That is the whole 2 s this harness allows one command, so the move left is cheaper work rather than longer.",
    );
    expect(text).not.toContain("is above the");
    // Counted inside the clause alone: the runner's own "after 2 seconds" contains "2 s" as well.
    const clause = text.slice(text.indexOf("That is the whole"));
    expect(clause.match(/\b2 s\b/g)).toHaveLength(1);
  });

  // Run de8b40 asked for 120 s beside an inner `timeout 880`, on a harness granting 900, and lost 13
  // commands to its own number across a six-case battery; both failing families were diagnosed as
  // search budget spent on sweeps the solver had cut short itself. The clause above had already said
  // so in the result of each one. A passed timeout is the lever for raising the wall, so below the
  // default it only takes back work the harness had already granted.
  it("runs a command at the default when the ask was below it", async () => {
    const text = await failing(bounded(4, 8), "sleep 2 && echo survived", 1);
    expect(text).toContain("survived");
    expect(text).not.toContain("timed out");
  });

  it("stays silent when the command failed on its own rather than on the wall", async () => {
    // The runner separates its own "timeout" code from a non-zero exit, which carries no cause at
    // all, and from "aborted", which is the session wall and not this one. Reading that code is why
    // this holds without an argument about when the runner kills what.
    const text = await failing(bounded(1, 4), "exit 3");
    expect(text).toContain("exited with code 3");
    expect(text).not.toContain("This harness allows");
    expect(text).not.toContain("the move left is cheaper work");
  });
});

describe("a command whose output the shell cut", () => {
  // Pi stores a cut command's whole output and names the file, which is the right shape; what
  // matters is where. Left to itself it writes under the host's temporary directory, which the open
  // read default lets every later solve on this host read and nothing ever removes. The session home
  // is the one place the solver's next command can read and no other session's can.
  it("keeps the whole output in the session home, where the next command reads it and another session cannot", async () => {
    mkdirSync(BUILT_COMMAND_SCRATCH_ROOT, { recursive: true, mode: 0o700 });
    const own = mkdtempSync(join(BUILT_COMMAND_SCRATCH_ROOT, "home-"));
    const other = mkdtempSync(join(BUILT_COMMAND_SCRATCH_ROOT, "home-"));
    const say = async (home: string, command: string): Promise<string> => {
      const tool = createBuiltBashTool({ policy: session, port: null, home });
      try {
        const result = await tool.execute("call-1", double({ command }), undefined, undefined);
        return result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
      } catch (error) {
        return errorMessage(error);
      }
    };
    try {
      expect(await say(own, "echo small")).not.toContain("Full output");
      const long = await say(own, "seq 1 5000");
      const stored =
        /\[Showing lines 3001-5000 of 5000\. Full output: (\S+) — read it with this shell\.\]/.exec(
          long,
        )?.[1];
      if (stored === undefined) throw new Error(`cut output named no stored file: ${long.slice(-300)}`);
      expect(stored.startsWith(`${own}/.shell-output/`)).toBe(true);
      expect((await say(own, `head -n 1 ${stored}`)).trim()).toBe("1");
      const refused = await say(other, `head -n 1 ${stored}`);
      expect(refused).toMatch(REFUSED);
      expect(refused).not.toMatch(/^1$/m);
    } finally {
      rmSync(own, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });
});
