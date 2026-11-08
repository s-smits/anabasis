/**
 * What a landing does around its proofs, kept out of `gate.ts`: a pass is remembered under a
 * digest of the CI gate and every file it imports, read from the landing's checkout, so any edit
 * there proves every commit of the stack again. On 6 November `holdAlone`, added to `gate.ts`,
 * made `bun run land -- 661 --sanitize` prove all 49 commits from the bottom although the CI gate
 * that the passes record had not changed. Nothing here runs inside a pass.
 */
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { git, lines, type Proof, short } from "./gate.ts";
import type { Pull } from "./pulls.ts";

/** Hold this clone's `who` alone until the returned release, waiting while another live one holds
 *  it. On 6 November two landings of one stack proved 795f3758c at once on two runners into one
 *  log, and the one whose flaky test failed posted red over a head the other had passed. The later
 *  landing now waits, then finds the earlier one's passes remembered. */
export async function holdAlone(
  root: string,
  who: string,
  say: (line: string) => void,
  pauseMs = 15_000,
): Promise<() => void> {
  const [common = ""] = lines(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const lock = join(common, `ana-${who}.lock`);
  const release = () => rmSync(lock, { recursive: true, force: true });
  for (let looks = 0; ; looks += 1) {
    try {
      // The lock is a link whose target is its holder's pid, made in one step. Until 9 November it
      // was a folder with the pid written into it after, so a lock read between the two named no
      // holder, and every landing waited five looks before it could tell a dead one from a live one.
      symlinkSync(String(runtimeProcess.pid), lock);
      return release;
    } catch (error) {
      if (lstatSync(lock, { throwIfNoEntry: false }) === undefined) throw error;
    }
    const left = join(lock, "pid");
    const holder =
      lstatSync(lock, { throwIfNoEntry: false })?.isSymbolicLink() === true
        ? Number(readlinkSync(lock))
        : existsSync(left)
          ? Number(readFileSync(left, "utf8"))
          : null;
    try {
      // Signal 0 reads whether the holder still runs, and throws where it does not; a folder an
      // older landing left without its pid names none.
      if (holder === null) throw new Error("a lock left without its pid");
      runtimeProcess.kill(holder, 0);
    } catch {
      release();
      continue;
    }
    if (looks % 20 === 0) {
      say(`another ${who} (pid ${String(holder)}) is running in this clone; waiting for it to end`);
    }
    await Bun.sleep(pauseMs);
  }
}

/** `say`, with each line that names a commit of `proofs` also naming its pull request, so a long
 *  landing shows which pull request it has reached. The line runs bottom to top and a pull
 *  request's commits end at its head, so a commit belongs to the lowest pull request not yet ended. */
export function sayingPulls(
  proofs: readonly Proof[],
  pulls: readonly Pick<Pull, "headRefOid" | "number">[],
  say: (line: string) => void,
): (line: string) => void {
  const pullOf = new Map<string, number>();
  let below = 0;
  for (const { commit } of proofs) {
    const pull = pulls[below];
    if (pull !== undefined) pullOf.set(short(commit), pull.number);
    while (pulls[below]?.headRefOid === commit) below += 1;
  }
  return (line) =>
    say(
      line.replace(/^((?:\d+ of \d+, )?)([0-9a-f]{9})\b/u, (named, at: string, sha: string) => {
        const number = pullOf.get(sha);
        return number === undefined ? named : `${at}pr${String(number)} ${sha}`;
      }),
    );
}
