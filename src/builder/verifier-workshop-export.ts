/** Transfer public workshop bytes into the candidate without granting the workshop workspace access. */
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../meta/filesystem.ts";
import { dirname, isAbsolute, join, relative, resolve } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { sha256 } from "../meta/digest.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";
import { errorCode } from "../meta/runtime-values.ts";
import { guardPath, type CandidateAccessPolicy } from "./candidate-isolation.ts";
import type { IsolatedRequest } from "./candidate-isolation-runtime.ts";
import { existingWorkshopPath, VerifierWorkshopRequestRefusal } from "./verifier-workshop-input.ts";
import { VERIFIER_WORKSHOP } from "./capability-modes.ts";

const MAX_EXPORT_BYTES = 64 * 1024 * 1024;

export type WorkshopExportBinding = ReturnType<typeof workshopExportBinding>;

export function workshopExportBinding(workspace: string, workshopPolicy: CandidateAccessPolicy) {
  const root = join(realpathSync.native(workspace), ".toolchain");
  const rule = { kind: "subpath" as const, path: root, id: "workshop-export" };
  const { digest: _digest, ...base } = workshopPolicy;
  const identity = {
    ...base,
    allow: { read: [rule], write: [rule], exec: [] },
    scratchWriteRoots: [],
    cellRuntimeRoots: [],
  };
  return { root, policy: { ...identity, digest: hashJsonBytes(identity) } };
}

function refuse(message: string): never {
  throw new VerifierWorkshopRequestRefusal(message);
}

function exportTarget(binding: WorkshopExportBinding, destination: string): string {
  const target = resolve(binding.root, destination);
  if (isAbsolute(destination) || !containsPath(target, binding.root) || target === binding.root) {
    refuse("export destination must be a relative file path under candidate .toolchain, such as bin/checker");
  }
  const decision = guardPath(binding.policy, VERIFIER_WORKSHOP, "write", target);
  if (decision.decision !== "allow") refuse(decision.message);
  // An existing file, directory or dangling symlink must never be overwritten by a transfer.
  try {
    lstatSync(target);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return target;
    throw error;
  }
  return refuse(
    "export destination already exists; choose a new path or manage the installed version with workspace tools",
  );
}

export async function exportWorkshopFile(
  root: string,
  binding: WorkshopExportBinding,
  path: string,
  destination: string,
  execute: (request: IsolatedRequest, policy: CandidateAccessPolicy) => Promise<void>,
) {
  const target = exportTarget(binding, destination);
  const source = existingWorkshopPath(root, path);
  const stat = lstatSync(source);
  if (!stat.isFile() || stat.size > MAX_EXPORT_BYTES) {
    refuse("export requires one regular file of at most 64 MiB; export package files separately when larger");
  }
  const executable = (stat.mode & 0o111) !== 0;
  // The workshop can write ambient temporary roots. Keep captured bytes under the controller's
  // closed epoch instead, and read untrusted paths only through the OS wall (parents may race).
  const scratch = realpathSync.native(mkdtempSync(join(binding.policy.epochDir, ".workshop-export-")));
  const staged = join(scratch, "source");
  try {
    writeFileSync(staged, "", { mode: 0o600 });
    chmodSync(scratch, 0o700);
    const { digest: _digest, ...base } = binding.policy;
    const capture = {
      ...base,
      allow: {
        read: [{ kind: "subpath" as const, path: root, id: "workshop-export-source" }],
        write: [{ kind: "literal" as const, path: staged, id: "workshop-export-stage" }],
        exec: [],
      },
    };
    await execute(
      {
        capability: VERIFIER_WORKSHOP,
        mode: "write",
        command: "/bin/sh",
        args: [
          "-c",
          '/usr/bin/head -c "$1" "$2" > "$3"',
          "workshop-capture",
          String(stat.size + 1),
          source,
          staged,
        ],
        cwd: root,
        paths: [staged],
        env: {},
        osRefusalIsOutcome: true,
      },
      { ...capture, digest: hashJsonBytes(capture) },
    );
    const bytes = readFileSync(staged);
    if (bytes.length !== stat.size) {
      refuse("export source size changed during the read; finish writing it and retry");
    }
    const digest = sha256(bytes);
    // The writable root must exist on the host before the copy: Bubblewrap binds only present
    // paths, and a copy into an unbound path lands on the namespace's private root and vanishes.
    mkdirSync(binding.root, { recursive: true, mode: 0o700 });
    // Only fixed copy commands run on the host, including in VM mode. The workshop process
    // never receives this policy. Noclobber closes a destination-created-after-check race.
    await execute(
      {
        capability: VERIFIER_WORKSHOP,
        mode: "write",
        command: "/bin/sh",
        args: [
          "-c",
          'umask 077; /bin/mkdir -p "$1" && (set -C; /bin/cat "$2" > "$3") && /bin/chmod "$4" "$3" && /usr/bin/cmp -s "$2" "$3"',
          "workshop-export",
          dirname(target),
          staged,
          target,
          executable ? "700" : "600",
        ],
        cwd: dirname(binding.root),
        paths: [target],
        controllerReadFiles: [staged],
        env: {},
        osRefusalIsOutcome: true,
      },
      binding.policy,
    );
    const decision = guardPath(binding.policy, VERIFIER_WORKSHOP, "read", target);
    if (decision.decision !== "allow") refuse(decision.message);
    // The confined copy compared its own view; the candidate is what this host reads back.
    let landed = false;
    try {
      landed = sha256(readFileSync(target)) === digest;
    } catch {
      /* absent: the copy never reached the host */
    }
    if (!landed) refuse("export did not reach the candidate; the confined copy wrote elsewhere");
    return {
      path: join(".toolchain", relative(binding.root, target)),
      bytes: bytes.length,
      sha256: digest,
      executable,
      nextAction:
        "The file is installed in the candidate. For an executable in bin/, add its filename to execution.requiredToolIds for authored computation or execution.evidence.requiredToolIds for external evidence and call runtime.tools.run from that named check. For a package, unpack it with workspace tools. Run correctness_check to exercise the candidate; export itself proves only the transferred bytes.",
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
