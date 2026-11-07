/**
 * What every machine `ANA_HOSTS` lists should hold, read at once and brought in step from this one.
 *
 *   bun run runs sync [--yes | --check] [--force]
 *
 * With no flag it prints what differs and changes nothing. `--yes` applies that and reads every machine
 * again; `--check` exits 1 on a difference or a silent host, for a timer. With no host, no `ANA_PYTHON`
 * and no `ANA_TOOLS` there is nothing to do: it says so and exits 0 with no ssh and no file.
 *
 * Settings need no step: every remote verb carries them (`carriedTo`, `hosts.ts`), so a dry run only
 * says what travels and no peer holds a copy to drift. Three things do live on a machine:
 * - **Tools.** `ANA_TOOLS` is one table of each tool's version (`.env.runs.example`). A row with no
 *   `install` leaves drift to report. Its `run` makes the tool do its job, and failing reads as drift
 *   at any version: on 5 November a guard copied to another host named the
 *   first host's home and exited 2 on every command, though its version read right. A host's `exclude`
 *   lists tools it keeps outside the table, reported and never changed. Until then each tool was by
 *   hand on each machine: git at three versions, and a guard installed on one of three.
 * - **Python.** `ANA_PYTHON` pins a version under `pinnedPythonDir` through `uv`, which refuses in its
 *   own words a version it lacks. Nothing is uninstalled, and a package nobody named stays and is said.
 * - **Runner.** An installed runner is stale where git says its source moved since the receipt's commit.
 *
 * A change a seat would find (a Python, and a table row unless it says `"seats":false`) is refused on
 * a host with a live or uncountable campaign unless `--force`: changing what a solver is given is the
 * operator's (AGENTS.md section 3). One probe runs here and over ssh, reading in the wall's order of
 * folders, since a login shell's PATH can miss what a machine holds or find another copy: on 5 November
 * one host's wall found node 26.10.0 and its login shell 24.22.1. A row no seat finds falls back on the
 * login shell's PATH as well.
 *
 * What it gives up: a verb a peer's own job starts sees no shared setting (`retire` reads none), and
 * a hand edit of an installed runner file reads as in step.
 */
import { gitMaybe } from "#src/meta/git.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isBoolean, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { capturedExecPath, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { decodeOutput, runCaptured, runSync } from "#src/meta/subprocess.ts";
import { pinnedPythonDir, TOOLCHAIN_HOME_ROOTS } from "#src/wall/policy.ts";
import { scanText } from "../secrets/rules.ts";
import { quoted, sshScript } from "./host-command.ts";
import { type Host, hostsOf, ownName } from "./host-config.ts";
import { carriedTo, scriptOn } from "./hosts.ts";
import { liveEverywhere } from "./logins.ts";
import { type HostPython, PYTHON_PROBE, pythonIn } from "./receipt.ts";
import { HERE } from "./registry.ts";

/** A machine to keep in step; `host` is undefined for this one. */
interface Machine {
  readonly name: string;
  readonly host: Host | undefined;
}
interface Pin {
  readonly version: string;
  readonly packages: readonly string[];
}
interface Tool {
  readonly name: string;
  readonly version: string;
  readonly read: string;
  readonly install: string | undefined;
  readonly seats: boolean;
}
interface Options {
  readonly pin: Pin | null;
  readonly tools: readonly Tool[];
  readonly force: boolean;
  readonly hosts: readonly Host[];
}
/** What one machine answered. */
interface Facts {
  readonly pythonPath: string;
  readonly python: HostPython | null;
  readonly uv: string;
  /** The commit its runner's receipt names, or null where it holds no runner. */
  readonly runner: string | null;
  /** What each `Tool`'s read printed, in order; empty where it holds none. */
  readonly tools: readonly string[];
}
/** One thing that differs on one machine. */
interface Finding {
  readonly line: string;
  /** Whether a solve would find this change, so that a live campaign holds it back. */
  readonly seats: boolean;
  /** Why `--yes` leaves it, which no flag passes, or null. */
  readonly blocked: string | null;
  readonly apply: () => Promise<number> | number;
}
type Held = Finding & { readonly under: string | null; readonly refused: string | null };
interface Plan {
  readonly machine: Machine;
  readonly facts: Facts | null;
  readonly findings: readonly Held[];
  readonly notes: readonly string[];
}

const MARK = "ana-sync-facts";
const USERS = ["/usr/local", "/opt/homebrew", "/opt/zerobrew"];
const BREWED = USERS.map((user) => `${user}/opt/python*/libexec/bin`).join(" ");
const DEVELOPER = "$(xcode-select -p 2>/dev/null || :)";
/** `toolchainPathDirs` as a shell word for any machine, each folder that is not there left to the
 *  shell; `test/runs-sync.test.ts` holds it to the real one. */
export const WALL_PATH = `"${pinnedPythonDir("$HOME")}:${USERS.map((user) => `${user}/bin`).join(":")}:$(sh -c 'ls -d ${BREWED}' 2>/dev/null | LC_ALL=C sort -r | tr '\\n' ':')${[
  ...TOOLCHAIN_HOME_ROOTS.flatMap((root) => [`$HOME/${root}/bin`, `$HOME/${root}/shims`]),
  "/usr/local/shims",
  `${DEVELOPER}/usr/bin`,
  `${DEVELOPER}/Toolchains/XcodeDefault.xctoolchain/usr/bin`,
  "/usr/bin:/bin:/usr/sbin:/sbin",
].join(":")}"`;
/** A host's own programs first, then the wall's and its login shell's: where `uv` and an install look,
 *  and a row no seat finds. */
const TOOL_PATH = `"$HOME/.local/bin:$HOME/.bun/bin:${WALL_PATH.slice(1, -1)}:$PATH"`;
const PYTHON_ROOT = join(pinnedPythonDir("$HOME"), "..");
const READ_MS = 60_000;
const APPLY_MS = 900_000;
const INSTALL = "tools/runtime/router/install.ts";
const TREE = join(import.meta.dir, "..", "..");
/** What the installed runner is made of, `hosts.js` bundling the last three among them. */
const RUNNER_SOURCE = [
  "tools/runtime/router",
  "tools/runs/host-config.ts",
  "tools/runs/host-command.ts",
  "src/meta/ssh.ts",
];
/** How many package names a line shows before it counts the rest. */
const SHOWN = 6;

/** `ANA_TOOLS`, refused whole before anything is asked, and never quoted back. */
function toolsOf(text: string): Tool[] {
  if (text.trim() === "") return [];
  if (scanText("ANA_TOOLS", text).length > 0) throw new Error("ANA_TOOLS holds what looks like a credential");
  let parsed: unknown;
  try {
    parsed = capturedJsonParse(text);
  } catch (error) {
    throw new Error("ANA_TOOLS is not JSON", { cause: error });
  }
  const table = Array.isArray(parsed) ? null : asRecord(parsed);
  if (table === null) throw new Error("ANA_TOOLS takes an object of tools");
  return Object.entries(table).map(([name, value]) => {
    if (!/^[A-Za-z0-9._-]+$/u.test(name)) throw new Error(`ANA_TOOLS: ${name} is not a tool's name`);
    const { version, read, run, install, seats } = asRecord(value) ?? {};
    const absentOrText = (one: unknown) => one === undefined || isString(one);
    const fair = [read, run, install].every(absentOrText) && (seats === undefined || isBoolean(seats));
    if (!isString(version) || !fair) {
      throw new Error(`ANA_TOOLS: ${name} takes a version, and may take read, run, install and seats`);
    }
    const shown = isString(read) ? read : `${name} --version`;
    return {
      name,
      version,
      read: isString(run) ? `(${run}) >/dev/null 2>&1 || { echo does-not-run; exit 0; }\n${shown}` : shown,
      install: isString(install) ? install : undefined,
      seats: seats !== false,
    };
  });
}

/** One command's output as one line, under `path`, and an empty line where it says nothing. */
const lineOf = (command: string, path: string) =>
  `(PATH="${path}"; export PATH; ${command}) 2>/dev/null </dev/null | tr '\\n' ' '; echo`;

const probeOf = (tools: readonly Tool[]) =>
  [
    `wall=${WALL_PATH}`,
    `tool=${TOOL_PATH}`,
    `echo ${MARK}`,
    lineOf("command -v python3", "$wall"),
    lineOf(`python3 -I -c ${quoted(PYTHON_PROBE)}`, "$wall"),
    lineOf("uv --version", "$tool"),
    lineOf('cat "$HOME/.local/share/ana-runner/INSTALLED"', "$tool"),
    ...tools.map(({ read, seats }) => lineOf(`sh -c ${quoted(read)}`, seats ? "$wall" : "$tool")),
  ].join("\n");

/** The facts in a probe's stdout, or null where it holds none: a login shell's chatter comes first. */
function factsIn(stdout: string, tools: readonly Tool[]): Facts | null {
  const lines = stdout.split("\n");
  const at = lines.lastIndexOf(MARK);
  if (at === -1) return null;
  const [pythonPath, python, uv, receipt, ...read] = lines.slice(at + 1).map((line) => line.trim());
  if (receipt === undefined || read.length < tools.length) return null;
  return {
    pythonPath: pythonPath ?? "",
    python: pythonIn(python ?? ""),
    uv: uv ?? "",
    runner: receipt === "" ? null : (/"commit":\s*"([^"]*)"/u.exec(receipt)?.[1] ?? "an unknown commit"),
    tools: read,
  };
}

async function factsOf(machine: Machine, tools: readonly Tool[]): Promise<Facts | null> {
  const probe = probeOf(tools);
  const command = machine.host === undefined ? ["/bin/sh", "-c", probe] : sshScript(machine.host, probe);
  const { exitCode, stdout } = await runCaptured(command, { timeout: READ_MS });
  return exitCode === 0 ? factsIn(stdout, tools) : null;
}

/** The exit of `script` on `machine`, its output said here. */
function runOn(machine: Machine, script: string): number {
  const { host } = machine;
  const command = host === undefined ? ["/bin/sh", "-c", script] : sshScript(host, script);
  const { exitCode, stdout, stderr } = runSync(command, { timeout: APPLY_MS });
  const said = `${decodeOutput(stdout)}${decodeOutput(stderr)}`.trimEnd();
  if (said !== "") console.log(said.replaceAll(/^/gmu, "    "));
  return exitCode ?? 1;
}

/** Each version a tool's line names: `v24.22.1` is 24.22.1, and 12.0.0 holds no 2.0.0. */
const versionsIn = (line: string): readonly string[] => line.match(/\d(?:[\w.+-]*\w)?/gu) ?? [];

const heldLine = (name: string, line: string) =>
  line === "" ? `${name} absent` : `${name} ${versionsIn(line)[0] ?? line.slice(0, 40)}`;

function toolFindings(machine: Machine, facts: Facts, tools: readonly Tool[]): Finding[] {
  return tools.flatMap((tool, index) => {
    const line = facts.tools[index] ?? "";
    if (machine.host?.exclude?.includes(tool.name) === true || versionsIn(line).includes(tool.version)) {
      return [];
    }
    const { install, seats } = tool;
    return [
      {
        line: `${heldLine(tool.name, line)}, wants ${tool.version}`,
        seats,
        blocked: install === undefined ? "the table gives no install" : null,
        apply: () => runOn(machine, `PATH=${TOOL_PATH}; export PATH\n${install ?? "exit 1"}`),
      },
    ];
  });
}

/** What a pin asks that `python` lacks, or null: a version, then pip and each package named. */
function pythonLacks(python: HostPython | null, { version, packages }: Pin): string | null {
  if (python?.version !== version) {
    return `wants ${packages.length === 0 ? version : `${version} with pip, ${packages.join(", ")}`}`;
  }
  // As Python's packaging compares names: `typing_extensions` is `typing-extensions`.
  const normal = (one: string) => one.toLowerCase().replaceAll(/[-_.]+/gu, "-");
  const have = new Set(python.packages.map(normal));
  const names = new Set([...have].map((one) => one.split("==")[0]));
  const lacking = ["pip", ...packages].filter((one) =>
    one.includes("==") ? !have.has(normal(one)) : !names.has(normal(one)),
  );
  return lacking.length === 0 ? null : `lacks ${lacking.join(", ")}`;
}

/** Never uninstalls, and swaps the link in one rename; `uv` says itself which versions it lacks. */
function pinScript({ version, packages }: Pin): string {
  const uv = "uv --no-config";
  return [
    "set -e",
    `PATH=${TOOL_PATH}; export PATH`,
    `root="${PYTHON_ROOT}"`,
    'mkdir -p "$root"',
    'export UV_PYTHON_INSTALL_DIR="$root/versions"',
    `${uv} python install --no-bin ${quoted(version)}`,
    `py="$(${uv} python find --managed-python ${quoted(version)})"`,
    ...(packages.length === 0
      ? []
      : [
          `${uv} pip install --python "$py" --system --break-system-packages ${packages.map(quoted).join(" ")}`,
        ]),
    'new="$root/bin.new.$$"',
    'ln -sfn "versions/$(basename "$(dirname "$(dirname "$py")")")/bin" "$new"',
    `"$py" -I -c 'import os,sys; os.replace(sys.argv[1], sys.argv[2])' "$new" "$root/bin"`,
  ].join("\n");
}

const pythonFound = ({ python, pythonPath }: Facts) =>
  python === null
    ? `finds no python3 that answers${pythonPath === "" ? "" : ` at ${pythonPath}`}`
    : `finds ${python.version} at ${pythonPath} with ${String(python.packages.length)} packages`;

function pythonFinding(machine: Machine, facts: Facts, pin: Pin | null): Finding | null {
  const lacks = pin === null ? null : pythonLacks(facts.python, pin);
  if (pin === null || lacks === null) return null;
  return {
    line: `python ${pythonFound(facts)}; ${lacks}`,
    seats: true,
    blocked: facts.uv === "" ? "no uv on this machine" : null,
    apply: () => runOn(machine, pinScript(pin)),
  };
}

/** Whether the runner a receipt's `commit` installed differs from `tree`'s; a commit git cannot
 *  read, a dirty one among them, does. */
export function runnerLags(tree: string, commit: string): boolean {
  const same = ["diff", "--quiet", "--end-of-options", commit, "HEAD", "--", ...RUNNER_SOURCE];
  return gitMaybe(tree, ...same) === null;
}

function runnerFinding(machine: Machine, facts: Facts, { hosts, force }: Options): Finding | null {
  const { host } = machine;
  if (hosts.length === 0 || facts.runner === null || !runnerLags(TREE, facts.runner)) return null;
  const everyCheckHere = host === undefined && !hosts.some(({ checks }) => checks !== undefined);
  return {
    line: `runner installed from ${facts.runner}, whose source this tree's has moved past`,
    seats: false,
    blocked:
      everyCheckHere && !force
        ? "no host in ANA_HOSTS sets `checks`, so this install would run every check on this machine: set them first, or --force"
        : null,
    apply: () => {
      if (host !== undefined) return scriptOn(host, INSTALL, []);
      return runOn(machine, `${quoted(capturedExecPath)} ${quoted(join(TREE, INSTALL))}`);
    },
  };
}

/** What differs without being anything to apply. */
function notesOf({ host }: Machine, facts: Facts, everyone: readonly Facts[], options: Options): string[] {
  const common = everyone.map(({ python }) => new Set(python?.packages));
  const own = (facts.python?.packages ?? []).filter((one) => !common.every((set) => set.has(one)));
  const more = own.length > SHOWN ? ` and ${String(own.length - SHOWN)} more` : "";
  const sent = host === undefined ? [] : Object.entries(carriedTo(host));
  return [
    ...(sent.length === 0 ? [] : [`carries ${sent.map(([key, value]) => `${key}=${value}`).join(" ")}`]),
    ...(options.pin === null ? [`python ${pythonFound(facts)}`] : []),
    ...(options.pin === null || facts.uv === "" ? [] : [facts.uv]),
    ...(own.length === 0
      ? []
      : [`packages not on every machine, which stay: ${own.slice(0, SHOWN).join(", ")}${more}`]),
    ...options.tools.flatMap(({ name, version }, index) =>
      host?.exclude?.includes(name) === true
        ? [`excluded ${heldLine(name, facts.tools[index] ?? "")}, where the table says ${version}`]
        : [],
    ),
  ];
}

/** `finding` under what `live` says of `machine`: only a change a seat would find waits for a run. */
function held(
  finding: Finding,
  machine: Machine,
  live: Awaited<ReturnType<typeof liveEverywhere>> | null,
  force: boolean,
): Held {
  const running = live?.live.filter((run) => run.host === machine.name) ?? [];
  const named = `${String(running.length)} live: ${running.map(({ name }) => name).join(", ")}`;
  const uncounted = live === null || live.unasked.includes(machine.name);
  const holding = uncounted ? "its live campaigns could not be counted" : named;
  const why = finding.seats && (uncounted || running.length > 0) ? holding : null;
  const waits = `${why ?? ""}; a solve started after this would find another program than the solves before it, and --force passes this`;
  return {
    ...finding,
    under: force ? why : null,
    refused: finding.blocked ?? (why === null || force ? null : waits),
  };
}

async function planned(machines: readonly Machine[], options: Options): Promise<Plan[]> {
  const read = await Promise.all(machines.map(async (machine) => await factsOf(machine, options.tools)));
  const everyone = read.filter((facts) => facts !== null);
  const found = machines.map((machine, index) => {
    const facts = read[index];
    if (facts === null || facts === undefined) return [];
    const python = pythonFinding(machine, facts, options.pin);
    const runner = runnerFinding(machine, facts, options);
    return [...toolFindings(machine, facts, options.tools), python, runner].filter((one) => one !== null);
  });
  const live = found.flat().some(({ seats }) => seats) ? await liveEverywhere("configured") : null;
  return machines.map((machine, index) => {
    const facts = read[index] ?? null;
    return {
      machine,
      facts,
      findings: (found[index] ?? []).map((one) => held(one, machine, live, options.force)),
      notes: facts === null ? [] : notesOf(machine, facts, everyone, options),
    };
  });
}

function printPlan({ machine: { name, host }, facts, findings, notes }: Plan): void {
  console.log(host === undefined ? `${name} (${ownName()})` : `${name} (${host.ssh}, ${host.tree})`);
  if (facts === null) console.log("  no answer");
  else if (findings.length === 0) console.log("  in step");
  for (const { line, under, refused } of findings) {
    console.log(`  ${line}`);
    if (under !== null) console.log(`    --force, under ${under}`);
    if (refused !== null) console.log(`    refused: ${refused}`);
  }
  for (const note of notes) console.log(`  note: ${note}`);
}

const pinOf = (env: Readonly<Record<string, string | undefined>>): Pin | null => {
  const version = env.ANA_PYTHON?.trim() ?? "";
  const packages = (env.ANA_PYTHON_PACKAGES ?? "").split(/[\s,]+/u).filter((one) => one !== "");
  if (version === "") {
    if (packages.length > 0) throw new Error("ANA_PYTHON_PACKAGES needs ANA_PYTHON");
    return null;
  }
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error("ANA_PYTHON takes a full version, such as 3.14.0");
  const faulty = packages.find((one) => !/^[A-Za-z0-9._-]+(==[A-Za-z0-9._+!-]+)?$/u.test(one));
  if (faulty !== undefined) throw new Error(`ANA_PYTHON_PACKAGES: ${faulty} is not a name or name==version`);
  return { version, packages };
};

/** `bun run runs sync`. */
export async function sync(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      yes: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
  });
  if (values.yes && values.check) throw new Error("--check changes nothing, and --yes applies");
  const hosts = hostsOf();
  // A verb another host sent here reaches no further, and leaves this machine to its own sync.
  const sent = runtimeProcess.env.ANA_HOP === "1";
  const pin = sent ? null : pinOf(runtimeProcess.env);
  const tools = sent ? [] : toolsOf(runtimeProcess.env.ANA_TOOLS ?? "");
  if (hosts.length === 0 && pin === null && tools.length === 0) {
    console.log(
      "nothing to do: in this environment ANA_HOSTS lists no host, ANA_PYTHON pins no Python and ANA_TOOLS names no tool, so this machine is one host",
    );
    return;
  }
  for (const host of hosts) carriedTo(host);
  const machines = [{ name: HERE, host: undefined }, ...hosts.map((host) => ({ name: host.name, host }))];
  const options = { pin, tools, force: values.force, hosts };
  const plans = await planned(machines, options);
  for (const plan of plans) printPlan(plan);
  const counts = (of: readonly Plan[]) => ({
    open: of.flatMap(({ findings }) => findings).length,
    silent: of.filter(({ facts }) => facts === null).length,
  });
  const { open, silent } = counts(plans);
  if (values.yes) {
    const owed = plans.flatMap(({ machine, findings }) =>
      findings.filter(({ refused }) => refused === null).map((one) => ({ ...one, name: machine.name })),
    );
    for (const { name, line, apply } of owed) {
      const code = await apply();
      if (code !== 0) console.log(`${name}: failed with exit ${String(code)}: ${line}`);
    }
    const after = await planned(machines, options);
    const left = counts(after);
    if (left.open + left.silent === 0) {
      console.log("every machine is in step");
      return;
    }
    console.log(`${String(left.open + left.silent)} left after applying:`);
    for (const plan of after) printPlan(plan);
    runtimeProcess.exitCode = 1;
    return;
  }
  if (values.check && open + silent > 0) runtimeProcess.exitCode = 1;
  console.log(
    `${String(open)} to change, ${String(silent)} did not answer; nothing changed, and --yes applies`,
  );
}
