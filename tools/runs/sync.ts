/**
 * One machine's `.env.runs` holds the settings; this carries them to every host `ANA_HOSTS` lists.
 *
 *   bun run runs sync [--yes | --check] [--force] [--host <name>]...
 *
 * With no flag it prints what differs on each machine and changes nothing. `--yes` applies that, and
 * `--check` prints the same and exits 1 on any difference, or a host that did not answer, for a timer
 * to read. `--force` passes the two refusals that protect something still running. `--host` narrows it
 * to the machines it names, `here` among them. With no host and no pinned Python there is nothing to
 * do: it says so and exits 0 with no ssh, no bundle and no file, so a machine that never set any of
 * this runs as the one host it is.
 *
 * Until 5 November each machine kept its own. The central file named no `ANA_RUN_CAP` though a cap of
 * 3 was meant, its entries named no `checks` though both peers took checks, and neither peer's tree
 * held a `.env.runs`, so a verb or keeper there saw no `ANA_LOGINS` or `ANA_LOGIN_RUNS`, and every
 * login was allowed and uncapped. A second registry of hosts was removed on 25 October because nothing
 * kept it in step (`tools/runtime/router/hosts.ts`), so this extends `ANA_HOSTS`, the one list:
 *
 * - **Settings.** A host's `<tree>/.env.runs` is generated from this machine's values of `CARRIED`,
 *   its `capacity` as `ANA_RUN_CAP`, and its entry's `settings` over those, an empty one writing none.
 *   It says it is generated, and a file that does not is refused by name. The write is a temporary
 *   file and a rename. A process reads its environment as it starts, so nothing running changes.
 *   `checks`, `packs` and `capacity` are read from `ANA_HOSTS` here and need no copy, and `ANA_HOSTS`
 *   itself stays here: a peer that held it would gather every listed host's records at its 05:00
 *   `retire`, and it names no entry for this machine.
 * - **Python.** `ANA_PYTHON` pins one version on every machine, in one folder, whatever package
 *   manager the host has: `uv` installs it under `~/.local/share/ana-python`, with
 *   `ANA_PYTHON_PACKAGES` in it where that is set, and a rename makes it the wall's first `python3`
 *   (`pinnedPythonDir`). Nothing is uninstalled, and a package nobody asked for is reported and
 *   stays. `hostPython` reads the result, so it is verified by what a solve finds. A move under a
 *   live campaign, or where the live count cannot be read, is refused unless `--force`, since a solve
 *   started after it would find another Python than the solves before it.
 * - **Runner.** An installed runner that differs from this tree's is reinstalled. Here that is refused
 *   unless `--force` while hosts are listed and none sets `checks`: the runner from 28 October sends
 *   a host checks only where its entry says so, so the install would move every check onto this
 *   machine without a word. A peer with no runner needs none (`run.sh` ships what a host runs).
 *
 * A credential never travels: `checked` refuses a key outside `CARRIED`, a key that looks like one and
 * a value that looks like one, naming the key and never the value. No `--env-file` of a host is opened
 * on any machine. Carrying a login stays the operator's. `uv.toml` in a home is reported where it
 * differs and not carried, since neither this nor a seat's `uv` reads it: a seat's home is its own.
 */
import { readFileSync } from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { dirname, join } from "#src/meta/path.ts";
import { capturedExecPath, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { pinnedPythonDir } from "#src/wall/policy.ts";
import { bundled, payload } from "../runtime/router/payload.ts";
import { scanText } from "../secrets/rules.ts";
import { quoted, shellPath, sshScript, treeBun } from "./host-command.ts";
import {
  capacityOn,
  configuredRuntime,
  type Host,
  hostNamed,
  hostsOf,
  ownName,
  unloadedHosts,
} from "./host-config.ts";
import {
  CARRIED,
  GENERATED,
  type HostFacts,
  hostFacts,
  ROUTER,
  runnerDigest,
  SETTINGS_FILE,
} from "./host-facts.ts";
import { scriptOn } from "./hosts.ts";
import { liveEverywhere } from "./logins.ts";
import { HERE } from "./registry.ts";

/** The runner files a tree makes, by digest. */
type Runner = Readonly<Record<string, string>>;
/** A machine to keep in step; `host` is undefined for this one. */
interface Machine {
  readonly name: string;
  readonly host: Host | undefined;
}
interface Pin {
  readonly version: string;
  readonly packages: readonly string[];
}
/** One thing that differs on one machine. */
interface Finding {
  readonly part: "settings" | "python" | "runner";
  readonly lines: readonly string[];
  /** Why `--yes` leaves it, or null. */
  readonly refused: string | null;
  /** The change: a non-zero exit is a failure, and the second read says what it left. */
  readonly apply: () => Promise<number>;
}
interface Plan {
  readonly machine: Machine;
  readonly facts: HostFacts | null;
  readonly findings: readonly Finding[];
  readonly notes: readonly string[];
}
interface Options {
  readonly pin: Pin | null;
  readonly force: boolean;
  readonly hosts: readonly Host[];
}

/** What sync carries to a host from this machine's environment; `ANA_RUN_CAP` is each host's own. */
const SHARED = CARRIED.filter((key) => key !== "ANA_RUN_CAP");
const CREDENTIAL = /TOKEN|KEY|SECRET|PASS|OAUTH|AUTH|CREDENTIAL|COOKIE|SESSION|PRIVATE/iu;
/** A read runs `uv` and a Python there; a pin downloads one. */
const READ_MS = 120_000;
const PIN_MS = 900_000;
const ROUTER_SCRIPT = "tools/runtime/router/install.ts";
const INSTALL = join(import.meta.dir, "..", "runtime", "router", "install.ts");
/** How many package names a line shows before it counts the rest. */
const SHOWN = 6;

/** Refuses a setting that may not travel, naming its key and never its value. */
function checked(where: string, key: string, value: string): void {
  if (CREDENTIAL.test(key)) throw new Error(`${where}: ${key} looks like a credential; sync carries none`);
  if (!CARRIED.includes(key)) throw new Error(`${where}: sync carries ${CARRIED.join(", ")}, and not ${key}`);
  if (scanText(key, value).length > 0) {
    throw new Error(`${where}: the value of ${key} looks like a credential; sync carries none`);
  }
  if (/['\\\r\n]/u.test(value)) {
    throw new Error(
      `${where}: the value of ${key} holds a quote, a backslash or a line break, which ${SETTINGS_FILE} takes none of`,
    );
  }
}

/** What `host`'s `.env.runs` should hold, by key: shared, then its capacity, then its own values. */
function settingsFor(host: Host): Readonly<Record<string, string>> {
  const shared = SHARED.flatMap((key) => {
    const value = runtimeProcess.env[key];
    return value === undefined || value === "" ? [] : [[key, value] as const];
  });
  const capacity = host.capacity === undefined ? [] : [["ANA_RUN_CAP", String(host.capacity)] as const];
  const merged = Object.fromEntries([...shared, ...capacity, ...Object.entries(host.settings ?? {})]);
  for (const [key, value] of Object.entries(merged)) checked(host.name, key, value);
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== ""));
}

const generatedHeader = () =>
  `${GENERATED} from the ${SETTINGS_FILE} of ${ownName()} and this host's ANA_HOSTS entry. Change it there; an edit here goes at the next sync.`;

/** The temporary file and the rename, refusing again there a file sync did not generate. */
const writeScript = (host: Host, text: string) =>
  `set -e
cd ${shellPath(host.tree)}
f=${quoted(SETTINGS_FILE)}
if [ -e "$f" ] && ! head -n 1 "$f" | grep -qF ${quoted(GENERATED)}; then
  echo "$f was not generated by sync; it stays" >&2
  exit 3
fi
t="$f.sync.$$"
trap 'rm -f "$t"' EXIT
printf '%s' ${quoted(text)} > "$t"
mv -f "$t" "$f"`;

function settingsFinding(host: Host, facts: HostFacts): Finding | null {
  const wanted = settingsFor(host);
  const file = facts.settings;
  const path = `${host.tree}/${SETTINGS_FILE}`;
  // Quoted whole, so a `#` ends no value, with each `$` escaped, since Bun expands one even in quotes.
  const held = Object.entries(wanted).map(
    ([key, value]) => `${key}='${value.replaceAll("$", String.raw`\$`)}'`,
  );
  const text = `${[generatedHeader(), ...held].join("\n")}\n`;
  const apply = async () => runOn({ name: host.name, host }, writeScript(host, text), READ_MS);
  if (file !== null && !file.generated) {
    return {
      part: "settings",
      lines: [`${path} was not generated by sync, and holds ${file.others.join(", ") || "no setting"}`],
      refused: "take its settings out of it first: sync overwrites only a file it generated",
      apply,
    };
  }
  const had = file?.values ?? {};
  const changes = [...new Set([...Object.keys(had), ...Object.keys(wanted)])]
    .toSorted()
    .filter((key) => had[key] !== wanted[key])
    .map((key) => `${key}: ${had[key] ?? "(unset)"} -> ${wanted[key] ?? "(removed)"}`);
  const gone = (file?.others ?? []).map((key) => `${key}: not one sync carries -> (removed)`);
  const source =
    file !== null && file.header !== generatedHeader() ? ["its header names another source"] : [];
  if (changes.length + gone.length + source.length === 0 && file !== null) return null;
  return {
    part: "settings",
    lines: [`${file === null ? "would create" : "would rewrite"} ${path}`, ...changes, ...gone, ...source],
    refused: null,
    apply,
  };
}

/** What a pin asks that `facts` lack: a version, and each package named. `pip` comes with any set. */
function pythonLacks(facts: HostFacts, pin: Pin): string | null {
  const { version, packages } = pin;
  if (facts.python?.version !== version) {
    return `wants ${packages.length === 0 ? version : `${version} with pip, ${packages.join(", ")}`}`;
  }
  // As Python's packaging compares names: `typing_extensions` is `typing-extensions`.
  const normal = (one: string) => one.toLowerCase().replaceAll(/[-_.]+/gu, "-");
  const held = new Set(facts.python.packages.map(normal));
  const names = new Set([...held].map((one) => one.split("==")[0]));
  const wanted = packages.length === 0 ? [] : [...packages, "pip"];
  const lacking = wanted.filter((one) =>
    one.includes("==") ? !held.has(normal(one)) : !names.has(normal(one)),
  );
  return lacking.length === 0 ? null : `lacks ${lacking.join(", ")}`;
}

const found = ({ python, pythonPath }: HostFacts) =>
  python === null
    ? `finds no python3 that answers${pythonPath === null ? "" : ` at ${pythonPath}`}`
    : `finds ${python.version} at ${pythonPath ?? "?"} with ${String(python.packages.length)} packages`;

/** The installed folder's shell script: never uninstalls, and swaps the link in one rename. */
function pinScript(pin: Pin, uv: string): string {
  const packages = pin.packages.map(quoted).join(" ");
  return [
    "set -e",
    `uv=${shellPath(uv)}`,
    `root="${dirname(pinnedPythonDir("$HOME"))}"`,
    'mkdir -p "$root"',
    'export UV_PYTHON_INSTALL_DIR="$root/versions"',
    `"$uv" --no-config python install --no-bin ${quoted(pin.version)}`,
    `py="$("$uv" --no-config python find --managed-python ${quoted(pin.version)})"`,
    ...(packages === ""
      ? []
      : [`"$uv" --no-config pip install --python "$py" --system --break-system-packages ${packages}`]),
    'new="$root/bin.new.$$"',
    'ln -sfn "versions/$(basename "$(dirname "$(dirname "$py")")")/bin" "$new"',
    `"$py" -I -c 'import os,sys; os.replace(sys.argv[1], sys.argv[2])' "$new" "$root/bin"`,
  ].join("\n");
}

/** Why a pin stays out of `machine`: the first two no flag passes, and `held` is what a flag did not. */
function pythonRefusal(machine: Machine, facts: HostFacts, pin: Pin, held: string | null): string | null {
  const { uv, offered } = facts;
  if (uv === null) {
    return `no uv here: ${machine.host === undefined ? "set ANA_UV" : "set `uv` in its ANA_HOSTS entry"}`;
  }
  if (offered === false) return `uv ${uv.version} offers no Python ${pin.version}`;
  if (held === null) return null;
  return `${held}; a solve started after this would find another Python than the solves before it, and --force passes this`;
}

function pythonFinding(
  machine: Machine,
  facts: HostFacts,
  options: Options,
  live: Awaited<ReturnType<typeof liveEverywhere>> | null,
): Finding | null {
  const { pin, force } = options;
  if (pin === null) return null;
  const lacks = pythonLacks(facts, pin);
  if (lacks === null) return null;
  const uv = facts.uv;
  const running = live?.live.filter((run) => run.host === machine.name) ?? [];
  const uncounted = live === null || live.unasked.includes(machine.name);
  const count = `${String(running.length)} live: ${running.map(({ name }) => name).join(", ")}`;
  const counted = running.length > 0 ? count : null;
  const whyLive = uncounted ? "its live campaigns could not be counted" : counted;
  const refused = pythonRefusal(machine, facts, pin, force ? null : whyLive);
  return {
    part: "python",
    lines: [
      `${found(facts)}; ${lacks}`,
      ...(uv === null
        ? []
        : [`through uv ${uv.version} at ${uv.path}, into ${dirname(pinnedPythonDir("~"))}`]),
      ...(whyLive !== null && force ? [`--force, under ${whyLive}`] : []),
    ],
    refused,
    apply: async () => runOn(machine, pinScript(pin, uv?.path ?? "uv"), PIN_MS),
  };
}

function runnerFinding(machine: Machine, facts: HostFacts, want: Runner, options: Options): Finding | null {
  const { hosts, force } = options;
  const installed = facts.runner;
  if (installed === null) return null;
  const stale = Object.keys(want).filter((name) => installed.files[name] !== want[name]);
  if (stale.length === 0) return null;
  const silent =
    machine.host === undefined && hosts.length > 0 && !hosts.some((host) => host.checks !== undefined);
  return {
    part: "runner",
    lines: [
      `differs from this tree in ${stale.join(", ")}, installed from ${installed.commit ?? "an unknown commit"}`,
    ],
    refused:
      silent && !force
        ? "no host in ANA_HOSTS sets `checks`, so this install would run every check on this machine: set them first, or --force"
        : null,
    apply: async () => {
      if (machine.host !== undefined) return await scriptOn(machine.host, ROUTER_SCRIPT, []);
      const { exitCode, stdout, stderr } = runSync([capturedExecPath, INSTALL], { timeout: READ_MS });
      console.log(decodeOutput(stdout).trimEnd());
      if (exitCode !== 0) console.error(decodeOutput(stderr).trimEnd());
      return exitCode ?? 1;
    },
  };
}

/** The runner files this tree makes, by digest. */
async function runnerWanted(): Promise<Runner> {
  const files = await payload();
  files.set(ROUTER, readFileSync(join(dirname(INSTALL), ROUTER), "utf8"));
  return Object.fromEntries([...files].map(([name, text]) => [name, runnerDigest(name, text)]));
}

/** The facts of `machine`, or null where it did not answer, which is said on stderr. */
function readFacts(machine: Machine, bundle: string, pin: Pin | null): HostFacts | null {
  const { host } = machine;
  if (host === undefined) return hostFacts(runtimeProcess.env.ANA_UV ?? "uv", pin?.version);
  const words = ["--uv", host.uv ?? "uv", ...(pin === null ? [] : ["--python", pin.version])];
  const script = `cd ${shellPath(host.tree)}\n${treeBun(configuredRuntime(host).bun)} --no-env-file run - ${words.map(quoted).join(" ")}`;
  const { exitCode, stdout, stderr } = runSync(sshScript(host, script), { input: bundle, timeout: READ_MS });
  try {
    if (exitCode === 0) return parseJsonAs<HostFacts>(decodeOutput(stdout));
  } catch {
    // Anything else on its stdout is no answer, as a failed command is.
  }
  console.error(
    `${host.name} did not answer sync (exit ${String(exitCode)}): ${decodeOutput(stderr).trim().split("\n").at(-1) ?? ""}`,
  );
  return null;
}

/** The exit of `script` on `machine`, its output said here. */
function runOn(machine: Machine, script: string, timeout: number): number {
  const { host } = machine;
  const command = host === undefined ? ["/bin/sh", "-c", script] : sshScript(host, script);
  const { exitCode, stdout, stderr } = runSync(command, { timeout });
  const said = `${decodeOutput(stdout)}${decodeOutput(stderr)}`.trimEnd();
  if (said !== "") console.log(said.replaceAll(/^/gmu, "    "));
  return exitCode ?? 1;
}

/** What differs without being anything to apply: what this machine or a host's entry leaves out. */
function notesFor(
  machine: Machine,
  facts: HostFacts,
  everyone: readonly (HostFacts | null)[],
  pin: Pin | null,
): string[] {
  const { host } = machine;
  const held = facts.python?.packages ?? [];
  const common = everyone.flatMap((one) => (one === null ? [] : [new Set(one.python?.packages)]));
  const own = held.filter((one) => !common.every((set) => set.has(one)));
  const more = own.length > SHOWN ? ` and ${String(own.length - SHOWN)} more` : "";
  const configs = new Set(everyone.flatMap((one) => (one === null ? [] : [one.uvConfig.join(", ")])));
  return [
    ...(pin === null ? [found(facts)] : []),
    ...(own.length === 0
      ? []
      : [`packages not on every machine, which stay: ${own.slice(0, SHOWN).join(", ")}${more}`]),
    ...(facts.uv === null ? [] : [`uv ${facts.uv.version} at ${facts.uv.path}`]),
    ...(configs.size > 1
      ? [`uv.toml reads ${facts.uvConfig.join(", ") || "nothing"}; no seat and no sync reads it`]
      : []),
    ...(host === undefined && runtimeProcess.env.ANA_RUN_CAP === undefined
      ? [`this machine's ANA_RUN_CAP is unset, so it carries ${String(capacityOn(undefined))}`]
      : []),
    ...(host !== undefined && host.capacity === undefined
      ? [`no \`capacity\` in its entry, so it carries ${String(capacityOn(host))}`]
      : []),
    ...(host !== undefined && host.checks === undefined
      ? ["no `checks` in its entry, so the runner sends it none"]
      : []),
  ];
}

async function planned(machines: readonly Machine[], options: Options): Promise<Plan[]> {
  const { pin, hosts } = options;
  const peers = machines.some(({ host }) => host !== undefined);
  const bundle = peers ? await bundled(join(import.meta.dir, "host-facts.ts")) : "";
  const read = machines.map((machine) => ({ machine, facts: readFacts(machine, bundle, pin) }));
  const everyone = read.map(({ facts }) => facts);
  const moves = pin !== null && everyone.some((facts) => facts !== null && pythonLacks(facts, pin) !== null);
  const live = moves ? await liveEverywhere("configured") : null;
  const want = hosts.length > 0 ? await runnerWanted() : null;
  return read.map(({ machine, facts }) => {
    if (facts === null) return { machine, facts, findings: [], notes: [] };
    const settings = machine.host === undefined ? null : settingsFinding(machine.host, facts);
    const python = pythonFinding(machine, facts, options, live);
    const runner = want === null ? null : runnerFinding(machine, facts, want, options);
    return {
      machine,
      facts,
      findings: [settings, python, runner].filter((one) => one !== null),
      notes: notesFor(machine, facts, everyone, pin),
    };
  });
}

function printPlan({ machine, facts, findings, notes }: Plan): void {
  const { name, host } = machine;
  console.log(host === undefined ? `${name} (${ownName()})` : `${name} (${host.ssh}, ${host.tree})`);
  if (facts === null) console.log("  no answer");
  for (const { part, lines, refused } of findings) {
    const [first, ...rest] = lines;
    console.log(`  ${part.padEnd(8)}  ${first ?? ""}`);
    for (const line of rest) console.log(`            ${line}`);
    if (refused !== null) console.log(`            refused: ${refused}`);
  }
  if (facts !== null && findings.length === 0) console.log("  in step");
  for (const note of notes) console.log(`  note      ${note}`);
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
      host: { type: "string", multiple: true },
    },
  });
  if (values.yes && values.check) throw new Error("--check changes nothing, and --yes applies");
  const hosts = hostsOf();
  const unread = hosts.length === 0 ? unloadedHosts(runtimeProcess.cwd()) : null;
  if (unread !== null) throw new Error(unread);
  // A verb another host sent here reaches no further, and leaves this machine's Python to its own sync.
  const pin = runtimeProcess.env.ANA_HOP === "1" ? null : pinOf(runtimeProcess.env);
  if (hosts.length === 0 && pin === null) {
    console.log(
      "nothing to do: ANA_HOSTS lists no host and ANA_PYTHON pins no Python, so this machine is one host",
    );
    return;
  }
  const everyMachine: Machine[] = [
    { name: HERE, host: undefined },
    ...hosts.map((host) => ({ name: host.name, host })),
  ];
  for (const name of values.host ?? []) if (name !== HERE) hostNamed(name);
  const machines = everyMachine.filter(({ name }) => values.host === undefined || values.host.includes(name));
  const options = { pin, force: values.force, hosts };
  const plans = await planned(machines, options);
  for (const plan of plans) printPlan(plan);
  const open = plans.flatMap(({ findings }) => findings).length;
  const silent = plans.filter(({ facts }) => facts === null).length;
  if (values.yes) {
    await applied(plans);
    const after = await planned(machines, options);
    const left = after.flatMap(({ findings }) => findings).length;
    const lost = after.filter(({ facts }) => facts === null).length;
    console.log(
      left + lost === 0 ? "every machine is in step" : `${String(left + lost)} left after applying:`,
    );
    if (left + lost > 0) {
      for (const plan of after) printPlan(plan);
      runtimeProcess.exitCode = 1;
    }
    return;
  }
  const saying = `${String(open)} to change, ${String(silent)} did not answer`;
  console.log(values.check ? saying : `${saying}; nothing changed, and --yes applies`);
  if (values.check && open + silent > 0) runtimeProcess.exitCode = 1;
}

/** Each finding that nothing refused, in order: settings, then Python, then the runner. */
async function applied(plans: readonly Plan[]): Promise<void> {
  for (const { machine, findings } of plans) {
    for (const { part, refused, apply } of findings) {
      if (refused !== null) continue;
      console.log(`applying ${part} on ${machine.name}`);
      const code = await apply();
      if (code !== 0) console.error(`${part} on ${machine.name} failed (exit ${String(code)})`);
    }
  }
}
