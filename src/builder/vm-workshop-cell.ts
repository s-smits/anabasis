/**
 * An optional machine boundary for the Builder's correctness-model workshop cell.
 *
 * The workshop runs third-party package lifecycle code —
 * `bun install` and its relatives, the route every measured install session found unaided. Under
 * Seatbelt or Bubblewrap that code still shares the host kernel, so one kernel defect ends the
 * isolation. This runner substitutes a libvirt/QEMU guest for that one cell: the allowed request
 * executes over ssh inside a provisioned VM whose only network interface sits on a host-only
 * libvirt network. The runner checks that configuration and disables networking in guest
 * Bubblewrap. The design follows an earlier VM service by the same operator (2026-08-19):
 * cloud-image guest on a qcow2 backing file, per-VM ssh key and virtiofs share. The provisioner
 * creates a clean snapshot; reverting it remains an operator step.
 *
 * The cell root is a per-campaign child of the guest's virtiofs share, so the workshop's host-side
 * reads and writes keep working unchanged while bwrap presents only those bytes under `/srv/share`.
 * The model-facing guard and its typed path-record rows stay exactly as under the OS mechanisms;
 * what changes is only the spawn. A guest-side denial is a command outcome.
 *
 * Opt-in and provisional: `ANA_WORKSHOP_VM=<name>` names a provisioned guest and is read once at
 * campaign mount; unset means the default OS isolation. A CLI flag should replace the variable
 * before this leaves experiment status. The runner refuses as `CandidateIsolationUnavailable`
 * (a typed non-result upstream) whenever the guest, its key, its isolated network or its transport
 * is not exactly as provisioned — nothing runs degraded.
 */
import { copyFileSync, existsSync, mkdtempSync, realpathSync, rmSync, statSync } from "../meta/filesystem.ts";
import { basename, isAbsolute, join, relative, sep } from "../meta/path.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";
import { bwrapEnvironmentArgs, bwrapIsolationArgs, bwrapWholeRootArgs } from "../verify/linux-bwrap.ts";
import {
  CandidateIsolationUnavailable,
  type IsolatedOutcome,
  type IsolatedRequest,
  type PathRecord,
  decideGuardedPaths,
  recordAllowedPaths,
  spawnCollected,
} from "./candidate-isolation-runtime.ts";
import type { CandidateAccessPolicy } from "./candidate-isolation.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import { errorMessage } from "../meta/runtime-values.ts";

const VM_NAME_ENV = "ANA_WORKSHOP_VM";
const VM_DIR_ENV = "ANA_VM_DIR";
const DEFAULT_VM_DIR = "/var/lib/libvirt/images/ana";
const ISOLATED_NETWORK = "ana-isolated";
const MECHANISM_ID = "microvm-libvirt/v1";
const GUEST_SHARE = "/srv/share";
const GUEST_SANDBOX = "/usr/bin/bwrap";
const GUEST_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const OPEN_ATTEMPTS = 24;
const OPEN_RETRY_MS = 5_000;
const VIRSH_TIMEOUT_MS = 30_000;
/* The guest key survives snapshot reverts (the disk reverts with it), but reprovisioning creates a
 * new one; pinning known_hosts would turn every reprovision into a manual cleanup on a network
 * only the host can reach. */
const SSH_OPTIONS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  "UserKnownHostsFile=/dev/null",
  "-o",
  "LogLevel=ERROR",
  "-o",
  "ConnectTimeout=10",
];

export interface VmWorkshopCell {
  name: string;
  user: string;
  keyPath: string;
  hostShareRoot: string;
  /** The directory below the virtiofs mount bound as the guest's whole share. */
  guestShareRoot?: string;
}

interface VmWorkshopTransport {
  virsh?: string;
  ssh?: string;
}

const guestIsolationArgs = () => [
  ...bwrapIsolationArgs({ network: false }),
  ...bwrapWholeRootArgs("--ro-bind"),
];
/** Keep resumable campaign bytes apart across repositories and worktrees sharing one guest. */
export function scopeVmWorkshopCell(
  cell: VmWorkshopCell,
  repoRoot: string,
  slug: string,
  campaignDir: string,
): VmWorkshopCell {
  const scope = `${slug}-${hashJsonBytes({ repoRoot: realpathSync.native(repoRoot), epoch: basename(campaignDir) }).slice(0, 16)}`;
  return {
    ...cell,
    hostShareRoot: join(cell.hostShareRoot, scope),
    guestShareRoot: `${GUEST_SHARE}/${scope}`,
  };
}

export function vmWorkshopCellFromEnv(env: OptionalEnvValues = Bun.env): VmWorkshopCell | null {
  const name = env[VM_NAME_ENV];
  if (name === undefined || name === "") return null;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(`${VM_NAME_ENV} must be lowercase alphanumeric with dashes, got "${name}"`);
  }
  const vmDir = env[VM_DIR_ENV] ?? DEFAULT_VM_DIR;
  if (!isAbsolute(vmDir)) throw new Error(`${VM_DIR_ENV} must be an absolute path`);
  return {
    name,
    user: name,
    keyPath: join(vmDir, name, "id_ed25519"),
    hostShareRoot: join(vmDir, name, "share"),
  };
}

function virsh(virshPath: string, args: string[]) {
  let run: Bun.SyncSubprocess<"pipe", "pipe">;
  try {
    run = Bun.spawnSync({
      cmd: [virshPath, "-c", "qemu:///system", ...args],
      timeout: VIRSH_TIMEOUT_MS,
      env: { PATH: Bun.env.PATH ?? "", HOME: Bun.env.HOME ?? "" },
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    throw new CandidateIsolationUnavailable(
      `virsh is unavailable for the workshop cell: ${errorMessage(error)}`,
    );
  }
  return { status: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

function assertIsolatedNetwork(cell: VmWorkshopCell, virshPath: string): void {
  const definition = virsh(virshPath, ["net-dumpxml", ISOLATED_NETWORK]);
  if (definition.status !== 0) {
    throw unavailable(
      cell,
      `network ${ISOLATED_NETWORK} is not defined (${definition.stderr.trim().slice(-200)})`,
    );
  }
  if (
    !/<network(?:\s|>)/.test(definition.stdout) ||
    !/<name>\s*ana-isolated\s*<\/name>/.test(definition.stdout)
  ) {
    throw unavailable(cell, `network ${ISOLATED_NETWORK} has a malformed definition`);
  }
  if (/<forward(?:\s|>)/.test(definition.stdout)) {
    throw unavailable(
      cell,
      `network ${ISOLATED_NETWORK} has a forward route; the workshop requires host-only transport`,
    );
  }
}

function unavailable(cell: VmWorkshopCell, detail: string): CandidateIsolationUnavailable {
  return new CandidateIsolationUnavailable(
    `workshop microvm "${cell.name}" is unavailable: ${detail}; provision with tools/vm/provision-workshop-cell.sh ${cell.name}`,
  );
}

/** Every non-loopback attachment must be an interface on the host-only network. */
function assertIsolatedInterfaces(cell: VmWorkshopCell, virshPath: string): void {
  assertIsolatedNetwork(cell, virshPath);
  const list = virsh(virshPath, ["domiflist", cell.name]);
  if (list.status !== 0) throw unavailable(cell, `domain not defined (${list.stderr.trim().slice(-200)})`);
  const lines = list.stdout.split("\n").map((line) => line.trim());
  const divider = lines.findIndex((line) => /^-+$/.test(line));
  if (divider < 0) throw unavailable(cell, "malformed interface table (missing divider)");
  const rows = lines
    .slice(divider + 1)
    .filter(Boolean)
    .map((line) => {
      const columns = line.split(/\s+/);
      if (columns.length !== 5) throw unavailable(cell, `malformed interface row (${line.slice(0, 120)})`);
      return columns;
    })
    .filter((cols) => cols[0] !== "lo" && cols[1] !== "loopback");
  if (rows.length === 0) throw unavailable(cell, "no network interface, so ssh cannot reach it");
  const foreign = rows
    .filter((cols) => cols[1] !== "network" || cols[2] !== ISOLATED_NETWORK)
    .map((cols) => `${cols[1] ?? "?"}/${cols[2] ?? "?"}`);
  if (foreign.length > 0) {
    throw unavailable(
      cell,
      `unexpected interface ${foreign[0]} instead of network/${ISOLATED_NETWORK} — an offline cell may not hold an egress route`,
    );
  }
}

async function openCell(
  cell: VmWorkshopCell,
  transport: VmWorkshopTransport,
): Promise<{ ip: string; sshPath: string }> {
  const virshPath = transport.virsh ?? "virsh";
  const sshPath = transport.ssh ?? "/usr/bin/ssh";
  if (!existsSync(cell.keyPath)) throw unavailable(cell, `access key ${cell.keyPath} is missing`);
  if (!existsSync(cell.hostShareRoot) || !statSync(cell.hostShareRoot).isDirectory()) {
    throw unavailable(cell, `share directory ${cell.hostShareRoot} is missing`);
  }
  if (transport.ssh === undefined && !existsSync(sshPath)) throw unavailable(cell, `${sshPath} is missing`);
  assertIsolatedInterfaces(cell, virshPath);
  const state = virsh(virshPath, ["domstate", cell.name]);
  if (!state.stdout.includes("running")) {
    const started = virsh(virshPath, ["start", cell.name]);
    if (started.status !== 0) {
      throw unavailable(cell, `could not start the guest (${started.stderr.trim().slice(-200)})`);
    }
  }
  for (let attempt = 0; attempt < OPEN_ATTEMPTS; attempt += 1) {
    const address = virsh(virshPath, ["domifaddr", cell.name]);
    const ip = /ipv4\s+(\S+)\//.exec(address.stdout)?.[1];
    if (ip !== undefined) {
      const probe = await spawnCollected(
        sshPath,
        [...SSH_OPTIONS, "-i", cell.keyPath, `${cell.user}@${ip}`, "--", "true"],
        cell.hostShareRoot,
        { PATH: Bun.env.PATH ?? "" },
      );
      if (probe.status === 0) {
        const canary = await spawnCollected(
          sshPath,
          [
            ...SSH_OPTIONS,
            "-i",
            cell.keyPath,
            `${cell.user}@${ip}`,
            "--",
            GUEST_SANDBOX,
            ...guestIsolationArgs(),
            "--",
            "/bin/true",
          ],
          cell.hostShareRoot,
          { PATH: Bun.env.PATH ?? "" },
        );
        if (canary.status === 255) {
          throw unavailable(cell, "ssh transport failed during the guest sandbox canary");
        }
        if (canary.status !== 0) {
          throw unavailable(cell, `guest bubblewrap canary failed (${canary.stderr.trim().slice(-200)})`);
        }
        return { ip, sshPath };
      }
    }
    await Bun.sleep(OPEN_RETRY_MS);
  }
  throw unavailable(cell, "the guest reported no reachable address");
}

function guestPath(cell: VmWorkshopCell, path: string): string | null {
  if (path === cell.hostShareRoot) return GUEST_SHARE;
  const rel = relative(cell.hostShareRoot, path);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return `${GUEST_SHARE}/${rel.split(sep).join("/")}`;
}

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

function guestSourceRoot(cell: VmWorkshopCell): string {
  const root = cell.guestShareRoot ?? GUEST_SHARE;
  if (root !== GUEST_SHARE && !root.startsWith(`${GUEST_SHARE}/`)) {
    throw unavailable(cell, `guest share ${root} is outside ${GUEST_SHARE}`);
  }
  return root;
}

function guestScript(
  cell: VmWorkshopCell,
  request: IsolatedRequest,
  stagedByOriginal: ReadonlyMap<string, string>,
): string {
  const cwd = guestPath(cell, request.cwd);
  if (cwd === null) {
    throw unavailable(cell, `workshop cwd ${request.cwd} is outside the cell share ${cell.hostShareRoot}`);
  }
  const sourceRoot = guestSourceRoot(cell);
  const sourceCwd = sourceRoot === GUEST_SHARE ? cwd : `${sourceRoot}${cwd.slice(GUEST_SHARE.length)}`;
  const mapArg = (arg: string) => stagedByOriginal.get(arg) ?? guestPath(cell, arg) ?? arg;
  const pairs = Object.entries(request.env ?? {}).flatMap(
    ([key, value]): Array<[string, string]> =>
      key === "PATH" || value === undefined ? [] : [[key, guestPath(cell, value) ?? value]],
  );
  const environment = Object.fromEntries([["PATH", GUEST_PATH], ...pairs]);
  const argv = [request.command, ...request.args].map(mapArg);
  const shareMount =
    sourceRoot === GUEST_SHARE
      ? []
      : [
          "--tmpfs",
          "/mnt",
          "--dir",
          "/mnt/ana-share-source",
          "--bind",
          sourceRoot,
          "/mnt/ana-share-source",
          "--tmpfs",
          GUEST_SHARE,
          "--bind",
          "/mnt/ana-share-source",
          GUEST_SHARE,
        ];
  const sandbox = [
    GUEST_SANDBOX,
    ...guestIsolationArgs(),
    ...shareMount,
    "--tmpfs",
    "/tmp",
    "--tmpfs",
    "/var/tmp",
    "--chdir",
    cwd,
    ...bwrapEnvironmentArgs(environment),
    "--",
    ...argv,
  ];
  return `cd ${quote(sourceCwd)} && exec ${sandbox.map(quote).join(" ")}`;
}

function stageControllerFiles(cell: VmWorkshopCell, files: readonly string[]) {
  const stagedByOriginal = new Map<string, string>();
  if (files.length === 0) return { stagedByOriginal, cleanup: () => {} };
  const stageRoot = mkdtempSync(join(cell.hostShareRoot, ".controller-stage-"));
  try {
    for (const [index, file] of files.entries()) {
      if (!statSync(file).isFile()) {
        throw new CandidateIsolationUnavailable("a controller-staged workshop input is unavailable");
      }
      const leaf = `${index}-${basename(file).replaceAll(/[^A-Za-z0-9._-]/g, "_")}`;
      const staged = join(stageRoot, leaf);
      copyFileSync(file, staged);
      stagedByOriginal.set(
        file,
        /* SAFETY: stageRoot is inside the cell share. */ guestPath(cell, staged) as string,
      );
    }
    return { stagedByOriginal, cleanup: () => rmSync(stageRoot, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(stageRoot, { recursive: true, force: true });
    throw error;
  }
}

export function createVmWorkshopRunner(
  cell: VmWorkshopCell,
  transport: VmWorkshopTransport = {},
): (policy: CandidateAccessPolicy, record: PathRecord, request: IsolatedRequest) => Promise<IsolatedOutcome> {
  let opened: Promise<{ ip: string; sshPath: string }> | null = null;
  return async (policy, record, request) => {
    if (policy.profile !== "isolated-workshop") {
      throw new CandidateIsolationUnavailable(
        `the microvm runner serves only the isolated-workshop profile, not "${policy.profile}"`,
      );
    }
    const decisions = decideGuardedPaths(policy, record, request);
    opened ??= openCell(cell, transport).catch((error: Error) => {
      opened = null; // A later call may find a repaired guest; a cached refusal never would.
      throw error;
    });
    const open = await opened;
    let outcome: IsolatedOutcome;
    const staged = stageControllerFiles(cell, request.controllerReadFiles ?? []);
    try {
      outcome = await spawnCollected(
        open.sshPath,
        [
          ...SSH_OPTIONS,
          "-i",
          cell.keyPath,
          `${cell.user}@${open.ip}`,
          "--",
          guestScript(cell, request, staged.stagedByOriginal),
        ],
        cell.hostShareRoot,
        { PATH: Bun.env.PATH ?? "" },
        { stdin: request.stdin },
      );
    } catch (error) {
      opened = null;
      throw error;
    } finally {
      staged.cleanup();
    }
    // 255 is ssh's own transport failure, distinct from any guest command exit.
    if (outcome.status === 255) {
      opened = null;
      throw unavailable(cell, `ssh transport failed (${outcome.stderr.trim().slice(-300)})`);
    }
    const identity = {
      schema: `${policy.schema}/microvm-libvirt`,
      mechanismId: MECHANISM_ID,
      vm: cell.name,
      network: ISOLATED_NETWORK,
      guestShare: guestSourceRoot(cell),
      sandboxPlanDigest: hashJsonBytes(guestIsolationArgs()),
      policyDigest: policy.digest,
      mode: request.mode,
    };
    const profileDigest = hashJsonBytes(identity);
    // The VM is the boundary; a guest-side denial is a command outcome, the same posture Linux
    // Bubblewrap has, so no os-refused derivation check exists here.
    recordAllowedPaths(policy, record, request, decisions, {
      profileDigest,
      enforcement: "os-allowed",
      stdout: outcome.stdout,
    });
    return outcome;
  };
}
