/**
 * An optional machine boundary for the Builder's correctness-model workshop cell.
 *
 * The workshop is the one cell that runs third-party package lifecycle code: it installs the
 * domain's real open-source tools and smoke-tests them. Under Seatbelt or Bubblewrap that code
 * still shares the host kernel, so one kernel defect ends the isolation. This runner substitutes a
 * libvirt/QEMU guest for that one cell: the allowed request executes over ssh inside a provisioned
 * VM whose only network interface sits on a host-only libvirt network, and inside that guest it
 * runs under Bubblewrap with networking disabled. Both halves are checked rather than assumed —
 * `assertIsolatedInterfaces` refuses a domain carrying any interface but `ana-isolated`, and
 * refuses `ana-isolated` itself if it has grown a forward route. The design follows an earlier VM
 * provisioner by the same operator, which `tools/vm/provision-workshop-cell.sh` records: cloud
 * image on a qcow2 backing file, per-VM ssh key, virtiofs share. That script also
 * takes a clean snapshot; reverting to it stays an operator step, because nothing here calls
 * `snapshot-revert`.
 *
 * The cell root is a per-campaign child of the guest's virtiofs share, so the workshop's host-side
 * reads and writes keep working unchanged while bwrap presents only those bytes under
 * `/srv/share`. The model-facing guard and its typed path-record rows stay exactly as under the OS
 * mechanisms; what changes is only the spawn, and a guest-side denial remains a command outcome.
 *
 * Opt-in and provisional: `ANA_WORKSHOP_VM=<name>` names a provisioned guest and is read once,
 * where the campaign's Builder runtime is built; unset means the default OS isolation, and no CLI
 * flag offers it yet. Whenever the guest, its key, its isolated network or its transport is not
 * exactly as provisioned, the runner throws `CandidateIsolationUnavailable`, which the workshop
 * records as a `mechanism-unavailable` non-result. Nothing runs degraded.
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
/* The guest host key survives a snapshot revert, since the disk reverts with it, but reprovisioning
 * builds a fresh disk from the base image and so a fresh key. Pinning known_hosts would turn every
 * reprovision into a manual cleanup, and buy little on a network only this host can reach. */
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
/** One provisioned guest serves whatever campaigns the operator points at it, and two checkouts of
 *  this repository can run the same domain slug at once. The scope therefore hashes the real
 *  repository root together with the campaign directory's own name, so each campaign writes into
 *  its own child of the share and resumes from bytes no sibling could have touched. */
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
  // The campaign's own share lives under the guest's mount, so the bind that hides its siblings
  // would also remove its source: bwrap applies these operations in order, and a tmpfs over
  // `/srv/share` takes the original path away before anything can be bound from it. Parking the
  // campaign child at `/mnt/ana-share-source` first keeps a live handle on those bytes across
  // that tmpfs, and the second bind then presents them, and only them, as the whole share.
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
      // A failed open is not cached: the guest may be starting, or an operator may repair it, and
      // the next action should look again rather than inherit this answer for the session.
      opened = null;
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
    // 255 is ssh's own transport failure, distinct from any guest command exit, so it says nothing
    // about the request and must not be reported as one. The open is dropped and the action
    // becomes a non-result the next call can retry against a repaired guest.
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
    // The VM is the boundary, so a guest-side denial is a command outcome and the row says
    // "os-allowed". This is Linux Bubblewrap's posture: the disagreement check that derives
    // "os-refused" in candidate-isolation-runtime.ts is Darwin-only, because Linux shows a denied
    // path as an absent one and leaves nothing here to tell refusal from a missing file.
    recordAllowedPaths(policy, record, request, decisions, {
      profileDigest,
      enforcement: "os-allowed",
      stdout: outcome.stdout,
    });
    return outcome;
  };
}
