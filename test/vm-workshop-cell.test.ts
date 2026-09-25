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
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { openPathRecord, readPathRecordRows } from "../src/builder/candidate-isolation-runtime.ts";
import { deriveCandidateIsolation } from "../src/builder/candidate-isolation.ts";
import {
  type VmWorkshopCell,
  createVmWorkshopRunner,
  scopeVmWorkshopCell,
  vmWorkshopCellFromEnv,
} from "../src/builder/vm-workshop-cell.ts";
const VERIFIER_WORKSHOP = "verifier_workshop";

const temps: string[] = [];
setDefaultTimeout(60_000);

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A guest double: virsh answers the exact queries the runner makes, ssh records its argv and
 *  stdin and prints a fixed stdout, so every assertion reads what actually crossed the interface. */
function cellFixture(
  options: {
    network?: string;
    interfaceType?: string;
    sshExit?: number;
    scoped?: boolean;
    malformedInterface?: boolean;
    forwardNetwork?: boolean;
    bwrapExit?: number;
  } = {},
) {
  const vmDir = temp("ana-vmdir-");
  const name = "cellvm";
  const instanceDir = join(vmDir, name);
  const share = join(instanceDir, "share");
  mkdirSync(share, { recursive: true });
  const keyPath = join(instanceDir, "id_ed25519");
  writeFileSync(keyPath, "test-key\n", { mode: 0o600 });
  const bin = temp("ana-vmbin-");
  const capture = temp("ana-vmcap-");
  const network = options.network ?? "ana-isolated";
  const interfaceType = options.interfaceType ?? "network";
  const virsh = join(bin, "virsh");
  writeFileSync(
    virsh,
    `#!/bin/sh
case "$*" in
  *net-dumpxml*)
    printf '%s\n' '<network><name>ana-isolated</name>${options.forwardNetwork === true ? '<forward mode="nat"/>' : ""}</network>'
    ;;
  *domiflist*)
    printf '%s\n' ' Interface  Type     Source  Model   MAC'
    printf '%s\n' '-------------------------------------------------------'
    printf '%s\n' ' vnet9      ${interfaceType}  ${network}  virtio  52:54:00:00:00:09'
${options.malformedInterface === true ? `    printf '%s\\n' 'malformed row'` : ""}
    ;;
  *domstate*) echo running ;;
  *domifaddr*) printf '%s\n' ' vnet9   52:54:00:00:00:09   ipv4   192.168.222.101/24' ;;
esac
exit 0
`,
    { mode: 0o700 },
  );
  chmodSync(virsh, 0o700);
  const ssh = join(bin, "ssh");
  writeFileSync(
    ssh,
    `#!/bin/sh
last=""
for arg in "$@"; do last="$arg"; done
if [ "$last" = "true" ]; then
  printf '%s\n' probe >> ${join(capture, "probe-log")}
  exit 0
fi
if [ "$last" = "/bin/true" ]; then exit ${options.bwrapExit ?? 0}; fi
printf '%s\n' "$@" > ${join(capture, "argv")}
printf '%s\n' '--- call ---' "$@" >> ${join(capture, "argv-log")}
/bin/cat > ${join(capture, "stdin")}
printf 'guest-stdout'
exit ${options.sshExit ?? 0}
`,
    { mode: 0o700 },
  );
  chmodSync(ssh, 0o700);
  const repoRoot = temp("ana-vmrepo-");
  const epochDir = join(repoRoot, "campaigns", "c1");
  const iterationDir = join(epochDir, "workspace");
  const hostShareRoot = options.scoped === true ? join(share, "t-c1") : share;
  mkdirSync(hostShareRoot, { recursive: true });
  const ossRoot = options.scoped === true ? join(hostShareRoot, ".oss") : join(share, "t-c1.oss");
  mkdirSync(iterationDir, { recursive: true });
  mkdirSync(ossRoot, { recursive: true });
  const binding = { repoRoot, epochDir, iterationDir, ossRoot, sharedCellRoot: hostShareRoot };
  const cell: VmWorkshopCell = { name, user: name, keyPath, hostShareRoot };
  if (options.scoped === true) cell.guestShareRoot = "/srv/share/t-c1";
  return {
    cell,
    transport: { virsh, ssh },
    policy: deriveCandidateIsolation(binding, "workshop"),
    record: openPathRecord(epochDir, "vm-test"),
    ossRoot,
    repoRoot,
    capture,
  };
}

describe("the workshop microvm opt-in", () => {
  it("is absent without the variable and names the provisioned layout with it", () => {
    expect(vmWorkshopCellFromEnv({})).toBeNull();
    expect(vmWorkshopCellFromEnv({ ANA_WORKSHOP_VM: "" })).toBeNull();
    const cell = vmWorkshopCellFromEnv({ ANA_WORKSHOP_VM: "cellvm", ANA_VM_DIR: "/opt/vm" });
    expect(cell).toEqual({
      name: "cellvm",
      user: "cellvm",
      keyPath: "/opt/vm/cellvm/id_ed25519",
      hostShareRoot: "/opt/vm/cellvm/share",
    });
    expect(() => vmWorkshopCellFromEnv({ ANA_WORKSHOP_VM: "Bad Name" })).toThrow(/lowercase/);
  });

  it("gives the same epoch in two worktrees different resumable share children", () => {
    const configured = cellFixture().cell;
    const left = temp("ana-vm-left-");
    const right = temp("ana-vm-right-");
    const leftCampaign = join(left, "campaigns", "same-epoch");
    const rightCampaign = join(right, "campaigns", "same-epoch");
    const leftCell = scopeVmWorkshopCell(configured, left, "t", leftCampaign);
    const rightCell = scopeVmWorkshopCell(configured, right, "t", rightCampaign);
    expect(leftCell.hostShareRoot).not.toBe(rightCell.hostShareRoot);
    expect(scopeVmWorkshopCell(configured, left, "t", leftCampaign)).toEqual(leftCell);
  });
});

describe("the workshop microvm runner", () => {
  it("sends an allowed request to the guest double with translated paths and a guest PATH", async () => {
    const f = cellFixture();
    const runner = createVmWorkshopRunner(f.cell, f.transport);
    const outcome = await runner(f.policy, f.record, {
      capability: VERIFIER_WORKSHOP,
      mode: "exec",
      command: "/bin/sh",
      args: ["-c", "echo hi"],
      cwd: f.ossRoot,
      paths: [f.ossRoot],
      env: { PATH: "/host/toolchain/bin", HOME: join(f.ossRoot, ".home"), CELL: "yes" },
      stdin: "stdin-bytes",
      osRefusalIsOutcome: true,
    });
    expect(outcome.stdout).toBe("guest-stdout");
    expect(outcome.status).toBe(0);
    const argv = readFileSync(join(f.capture, "argv"), "utf8").split("\n").filter(Boolean);
    expect(argv).toContain("cellvm@192.168.222.101");
    expect(argv).toContain(f.cell.keyPath);
    const script = argv.at(-1) ?? "";
    expect(script).toContain("cd '/srv/share/t-c1.oss'");
    expect(script).toContain("'--setenv' 'HOME' '/srv/share/t-c1.oss/.home'");
    expect(script).toContain("'--setenv' 'CELL' 'yes'");
    expect(script).toContain("'--setenv' 'PATH' '/usr/local/sbin:");
    expect(script).toContain("'--new-session'");
    expect(script).toContain("'--unshare-user'");
    expect(script).toContain("'--cap-drop' 'ALL'");
    expect(script).toContain("'--disable-userns'");
    expect(script).toContain("'--unshare-net'");
    expect(script).toContain("'--tmpfs' '/var/tmp'");
    expect(script).not.toContain("/host/toolchain/bin");
    expect(readFileSync(join(f.capture, "stdin"), "utf8")).toBe("stdin-bytes");
    const rows = readPathRecordRows(f.record.path);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ decision: "allow", enforcement: "os-allowed", bytes: 12 });
    expect(rows[0]?.profileDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("writes the guard's typed refusal and never reaches ssh for a path outside the cell", async () => {
    const f = cellFixture();
    const runner = createVmWorkshopRunner(f.cell, f.transport);
    const outside = join(f.repoRoot, "AGENTS.md");
    writeFileSync(outside, "WORKING-CONTRACT\n");
    await expect(
      runner(f.policy, f.record, {
        capability: VERIFIER_WORKSHOP,
        mode: "read",
        command: "/bin/cat",
        args: [outside],
        cwd: f.ossRoot,
        paths: [outside],
      }),
    ).rejects.toThrow("is outside the candidate workspace access rules");
    expect(existsSync(join(f.capture, "argv"))).toBe(false);
    const rows = readPathRecordRows(f.record.path);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ decision: "deny", enforcement: "guard-denied" });
  });

  it("refuses a guest whose virsh response names a network outside the allowed set", async () => {
    const f = cellFixture({ network: "default" });
    const runner = createVmWorkshopRunner(f.cell, f.transport);
    await expect(
      runner(f.policy, f.record, {
        capability: VERIFIER_WORKSHOP,
        mode: "exec",
        command: "/bin/sh",
        args: ["-c", "true"],
        cwd: f.ossRoot,
        paths: [f.ossRoot],
      }),
    ).rejects.toThrow(/egress route/);
    expect(existsSync(join(f.capture, "argv"))).toBe(false);
  });

  it("refuses a reused isolated-network name whose definition still forwards traffic", async () => {
    const f = cellFixture({ forwardNetwork: true });
    const runner = createVmWorkshopRunner(f.cell, f.transport);
    await expect(
      runner(f.policy, f.record, {
        capability: VERIFIER_WORKSHOP,
        mode: "exec",
        command: "/bin/sh",
        args: ["-c", "true"],
        cwd: f.ossRoot,
        paths: [f.ossRoot],
      }),
    ).rejects.toThrow(/forward route/);
    expect(existsSync(join(f.capture, "probe-log"))).toBe(false);
  });

  it("refuses a malformed interface row instead of filtering it out", async () => {
    const f = cellFixture({ malformedInterface: true });
    const runner = createVmWorkshopRunner(f.cell, f.transport);
    await expect(
      runner(f.policy, f.record, {
        capability: VERIFIER_WORKSHOP,
        mode: "exec",
        command: "/bin/sh",
        args: ["-c", "true"],
        cwd: f.ossRoot,
        paths: [f.ossRoot],
      }),
    ).rejects.toThrow(/malformed interface row/);
  });

  it.each([
    ["bridge", "virbr0"],
    ["direct", "eno1"],
    ["ethernet", "-"],
  ])("refuses a %s attachment instead of filtering it out", async (interfaceType: string, source: string) => {
    const f = cellFixture({ interfaceType, network: source });
    const runner = createVmWorkshopRunner(f.cell, f.transport);
    await expect(
      runner(f.policy, f.record, {
        capability: VERIFIER_WORKSHOP,
        mode: "exec",
        command: "/bin/sh",
        args: ["-c", "true"],
        cwd: f.ossRoot,
        paths: [f.ossRoot],
      }),
    ).rejects.toThrow(/unexpected interface/);
    expect(existsSync(join(f.capture, "argv"))).toBe(false);
  });

  it("writes the bind arguments that restrict the guest share to the current scope", async () => {
    const f = cellFixture({ scoped: true });
    const runner = createVmWorkshopRunner(f.cell, f.transport);
    await runner(f.policy, f.record, {
      capability: VERIFIER_WORKSHOP,
      mode: "exec",
      command: "/bin/sh",
      args: ["-c", "cat /srv/share/sibling/.oss/secret /srv/share/.controller-stage/secret"],
      cwd: f.ossRoot,
      paths: [f.ossRoot],
    });
    const script = readFileSync(join(f.capture, "argv"), "utf8");
    expect(script).toContain("'--bind' '/srv/share/t-c1' '/mnt/ana-share-source'");
    expect(script).toContain("'--bind' '/mnt/ana-share-source' '/srv/share'");
    expect(script.indexOf("'--tmpfs' '/mnt'")).toBeLessThan(
      script.indexOf("'--bind' '/srv/share/t-c1' '/mnt/ana-share-source'"),
    );
    expect(script).toContain("cat /srv/share/sibling/.oss/secret");
    expect(script).toContain("/srv/share/.controller-stage/secret");
  });

  it("stages public controller inputs in a fresh campaign-private directory and removes it", async () => {
    const f = cellFixture();
    const staged = join(f.repoRoot, "controller-input.txt");
    writeFileSync(staged, "public controller bytes\n");
    const runner = createVmWorkshopRunner(f.cell, f.transport);
    await runner(f.policy, f.record, {
      capability: "public_source",
      mode: "write",
      command: "/bin/cp",
      args: [staged, join(f.ossRoot, "copied.txt")],
      cwd: f.ossRoot,
      paths: [join(f.ossRoot, "copied.txt")],
      controllerReadFiles: [staged],
    });
    const script = readFileSync(join(f.capture, "argv"), "utf8");
    expect(script).toMatch(/\/srv\/share\/\.controller-stage-[^/']+\/0-controller-input\.txt/);
    expect(readdirSync(f.cell.hostShareRoot).some((entry) => entry.startsWith(".controller-stage-"))).toBe(
      false,
    );
  });

  it("refuses before the workshop command when the guest bubblewrap canary fails", async () => {
    const f = cellFixture({ bwrapExit: 1 });
    const runner = createVmWorkshopRunner(f.cell, f.transport);
    await expect(
      runner(f.policy, f.record, {
        capability: VERIFIER_WORKSHOP,
        mode: "exec",
        command: "/bin/sh",
        args: ["-c", "true"],
        cwd: f.ossRoot,
        paths: [f.ossRoot],
      }),
    ).rejects.toThrow(/bubblewrap canary failed/);
    expect(existsSync(join(f.capture, "argv"))).toBe(false);
  });

  it("serves only the isolated-workshop profile", async () => {
    const f = cellFixture();
    const runner = createVmWorkshopRunner(f.cell, f.transport);
    const authoringPolicy = { ...f.policy, profile: "candidate" as const };
    await expect(
      runner(authoringPolicy, f.record, {
        capability: "bash",
        mode: "exec",
        command: "/bin/sh",
        args: ["-c", "true"],
        cwd: f.ossRoot,
        paths: [f.ossRoot],
      }),
    ).rejects.toThrow('serves only the isolated-workshop profile, not "candidate"');
  });

  it("refuses as unavailable when the provisioned key is missing, naming the provision script", async () => {
    const f = cellFixture();
    rmSync(f.cell.keyPath);
    const runner = createVmWorkshopRunner(f.cell, f.transport);
    await expect(
      runner(f.policy, f.record, {
        capability: VERIFIER_WORKSHOP,
        mode: "exec",
        command: "/bin/sh",
        args: ["-c", "true"],
        cwd: f.ossRoot,
        paths: [f.ossRoot],
      }),
    ).rejects.toThrow(/provision-workshop-cell\.sh/);
  });

  it("treats ssh's own 255 as mechanism unavailability, not a guest command exit", async () => {
    const f = cellFixture({ sshExit: 255 });
    const runner = createVmWorkshopRunner(f.cell, f.transport);
    const request = {
      capability: VERIFIER_WORKSHOP,
      mode: "exec" as const,
      command: "/bin/sh",
      args: ["-c", "true"],
      cwd: f.ossRoot,
      paths: [f.ossRoot],
    };
    await expect(runner(f.policy, f.record, request)).rejects.toThrow(/ssh transport failed/);
    await expect(runner(f.policy, f.record, request)).rejects.toThrow(/ssh transport failed/);
    expect(readFileSync(join(f.capture, "probe-log"), "utf8")).toBe("probe\nprobe\n");
  });
});
