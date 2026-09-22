/** The Builder toolkit's staged writes. The host stages bytes in scratch; the candidate
 *  access policy still governs both directory creation and copying. */
import { mkdtempSync, rmSync, writeFileSync } from "../meta/filesystem.ts";
import { tmpdir } from "../meta/os.ts";
import { basename, dirname, join, relative } from "../meta/path.ts";
import { runIsolated } from "./candidate-isolation-runtime.ts";
import type { BuilderIsolation } from "./tools.ts";

export async function stageAndCopy(
  isolation: BuilderIsolation,
  capability: string,
  target: string,
  content: string,
): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), "ana-isolation-write-"));
  const staged = join(scratch, basename(target));
  try {
    writeFileSync(staged, content);
    const parent = dirname(target);
    // A relative path: with an absolute one, mkdir -p meets EPERM on an ancestor outside the
    // allowed tree before EEXIST. A parent outside workDir is denied by the guard first.
    const mkdir = await runIsolated(isolation.policy, isolation.record, {
      capability,
      mode: "write",
      command: "/bin/mkdir",
      args: ["-p", relative(isolation.workDir, parent) || "."],
      cwd: isolation.workDir,
      paths: [parent],
    });
    if (mkdir.status !== 0) throw new Error(mkdir.stderr.trim() || `mkdir exited ${mkdir.status}`);
    // Named as a controller read: the Linux cell lays a fresh tmpfs over the host scratch root.
    const copy = await runIsolated(isolation.policy, isolation.record, {
      capability,
      mode: "write",
      command: "/bin/cp",
      args: [staged, target],
      cwd: isolation.workDir,
      paths: [target],
      controllerReadFiles: [staged],
    });
    if (copy.status !== 0) throw new Error(copy.stderr.trim() || `write exited ${copy.status}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Where a truncated command's whole output is kept. Dot-prefixed so the listing tools pass over
 *  it, and never fingerprinted, so it cannot reach a candidate snapshot. */
const WHOLE_OUTPUT_DIR = ".bash-output";
let wholeOutputSeq = 0;

/** Keeps the bytes a truncated result dropped, where the read tool can page them, since a
 *  command's output cannot be read again. Nothing prunes these; the workspace is disposable. */
export async function spillWholeOutput(isolation: BuilderIsolation, content: string): Promise<string> {
  wholeOutputSeq += 1;
  const name = `bash-${Date.now().toString(36)}-${wholeOutputSeq.toString(36)}.txt`;
  await stageAndCopy(isolation, "bash", join(isolation.workDir, WHOLE_OUTPUT_DIR, name), content);
  return join(WHOLE_OUTPUT_DIR, name);
}
