/**
 * What a landing does around its proofs, kept out of `gate.ts`, whose digest with every file it
 * imports keys each pass: an edit here would otherwise prove every commit of the stack again.
 * Nothing here runs inside a pass.
 */
import { join } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { hold, holderOf, release } from "#src/meta/holder.ts";
import { errorMessage } from "../../src/meta/runtime-values.ts";
import { benchesForRoot, checkPlaces, namedPlaces, type Place } from "../runs/host-config.ts";
import { git, lines, type Proof, short } from "./gate.ts";
import { beneath, chainAbove, openPulls, type Pull, stackStart } from "./pulls.ts";

/** What a holder says of itself in the lock, after its record, and whether a newer one may end it. */
interface Claim {
  readonly note: string;
  readonly over: (held: string) => boolean;
}
/** How often a landing reads the open pull requests, while it proves commits and while it follows. */
const WATCH_MS = Number(runtimeProcess.env.ANA_LAND_WATCH_MS) || 60_000;
/** The kinds of landing, by how much each writes; a landing that merges is never ended by another. */
const KINDS = ["proving", "sanitizing", "merging"];

/** Holds this clone's `who` alone until the returned release, waiting while another live one holds
 *  it, so two landings never post over one commit's verdict from two runners. Where `claim.over`
 *  reads the holder's note as work the newer one covers, it ends the holder (SIGTERM) rather than
 *  waiting it out. */
export async function holdAlone(
  root: string,
  say: (line: string) => void,
  pauseMs = 15_000,
  claim: Claim | null = null,
): Promise<() => void> {
  const [common = ""] = lines(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const lock = join(common, "ana-land.lock");
  let ended = 0;
  for (let looks = 0; ; looks += 1) {
    // The run CLI's lock (`holder.ts`): a dead holder's lock is taken over under a `flock` of the
    // folder, so of two landings that find it dead one takes it and the other waits.
    if (hold(lock, claim?.note)) return () => release(lock);
    const found = holderOf(lock);
    if (found === null) continue;
    const { pid: holder, note: held } = found;
    if (ended !== holder && held !== "" && claim?.over(held) === true) {
      ended = holder;
      say(
        `another land (pid ${String(holder)}, ${held}) covers less than this one; ending it, its passes kept`,
      );
      runtimeProcess.kill(holder, "SIGTERM");
      await Bun.sleep(Math.min(pauseMs, 1000));
      continue;
    }
    if (looks % 20 === 0) {
      say(`another land (pid ${String(holder)}) is running in this clone; waiting for it to end`);
    }
    await Bun.sleep(pauseMs);
  }
}

/** `say`, with each line that names a commit of `proofs` also naming its pull request. Proofs run
 *  bottom to top, so a commit belongs to the lowest pull request not yet ended. */
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

/** The lock's note for a landing of `target` (`#<pull request> <kind>`, `+` after the number where
 *  `--auto` may land above it), and which held landings it ends: one that does not merge or follow
 *  the top, writes no more than it, and lands part of what it proves (from `--from`, or from
 *  `stackStart`). The chain is read only once a holder is found. */
export function claimOf(
  root: string,
  target: number,
  mode: { readonly auto: boolean; readonly kind: string; readonly from: number | null },
): Claim {
  const kind = KINDS.indexOf(mode.kind);
  let chain: string[] | null = null;
  return {
    note: `#${String(target)}${mode.auto ? "+" : ""} ${mode.kind}`,
    over: (held) => {
      const [number = "", what = ""] = held.split(" ");
      const theirs = KINDS.indexOf(what);
      if (theirs === -1 || theirs === 2 || theirs > kind || number.endsWith("+")) return false;
      if (chain === null) {
        const open = openPulls(root);
        const named = open.find((pull) => pull.number === target);
        const top = named !== undefined && mode.auto ? (chainAbove(open, named).at(-1) ?? named) : named;
        const pulls = top === undefined ? [] : [...beneath(open, top), top];
        const from = pulls.findIndex((pull) => pull.number === mode.from);
        const proved = pulls.slice(mode.from === null ? stackStart(root, pulls) : Math.max(from, 0));
        chain = proved.map((pull) => `#${String(pull.number)}`);
      }
      return chain.includes(number);
    },
  };
}

/**
 * A stop for a landing's proofs: `moved` is called every `WATCH_MS` and its error ends them, as
 * SIGINT or SIGTERM does with an `Interrupted` error. Each proof runs in its own process group, so
 * it ends whole, and the landing restarts with every pass kept.
 */
export function watching(Interrupted: new (message: string) => Error, moved: () => Error | null) {
  const stop = new AbortController();
  const watch = setInterval(() => {
    try {
      const reason = moved();
      if (reason !== null) stop.abort(reason);
    } catch {
      // A reading that failed says nothing; the next proof's start reads the chain again.
    }
  }, WATCH_MS);
  const halt = (): void =>
    stop.abort(
      new Interrupted(
        "interrupted by a signal, which a landing that covers more of the stack also sends (the lock in the Git folder names it, and its passes are this one's); every pass so far is recorded, so landing again starts from there.",
      ),
    );
  runtimeProcess.on("SIGINT", halt).on("SIGTERM", halt);
  const end = (): void => {
    clearInterval(watch);
    runtimeProcess.off("SIGINT", halt).off("SIGTERM", halt);
  };
  return { signal: stop.signal, end };
}

const LAND_ALL_CONCURRENCY = 4;

/** Where a landing in `root` proves its commits (`checkPlaces`); a host list that cannot be read
 *  is refused, null. With remote non-benchmark hosts listed and `ANA_CHECK_HOST` unset, commits
 *  lead locally under `all` (capped by `LAND_ALL_CONCURRENCY` and non-benchmark fleet capacity) so
 *  test chunks spread breadth-first over every cool host without pinning any commit to one machine. */
export function whereToProve(
  root: string,
  jobs: number | undefined,
  say: (line: string) => void,
): readonly Place[] | null {
  try {
    const places = checkPlaces(root, jobs);
    if (places[0]?.remote !== undefined) {
      const benched = new Set(
        benchesForRoot(root).flatMap((bench) => (bench.host === undefined ? [] : [bench.host.name])),
      );
      const total = places.reduce(
        (sum, { remote, slots }) => sum + (remote !== undefined && benched.has(remote) ? 0 : slots),
        0,
      );
      if (total > 0) {
        const pooled: readonly Place[] = [
          { remote: "all", slots: Math.min(jobs ?? LAND_ALL_CONCURRENCY, total) },
        ];
        say(`proving on ${namedPlaces(pooled)} at once; ANA_CHECK_HOST=<one> proves at that one.`);
        return pooled;
      }
    }
    return places;
  } catch (error) {
    console.error(
      `land: ${errorMessage(error)}; ANA_CHECK_HOST=here proves on this machine. Nothing was merged.`,
    );
    return null;
  }
}

/** The open pull requests by number, base and head, which say whether any of them moved. */
export const placesOf = (pulls: readonly Pull[]): string =>
  pulls
    .map((pull) => `${String(pull.number)} ${pull.baseRefName} ${pull.headRefOid}`)
    .toSorted()
    .join("\n");

/** The open pull requests, or null where GitHub did not answer. */
function openOrNull(root: string): Pull[] | null {
  try {
    return openPulls(root);
  } catch {
    return null;
  }
}

/**
 * Under `--watch`, lands with `round`, then again each time an open pull request moves, opens or
 * closes, read every `WATCH_MS`, until `target` closes or SIGINT or SIGTERM ends it. Without it,
 * and always under `--merge`, a landing lands once. A round costs only what moved, since every pass
 * is remembered by tree.
 */
export async function follow(
  root: string,
  target: number | null,
  say: (line: string) => void,
  round: () => Promise<number>,
): Promise<number> {
  let ended = false;
  let waiting = false;
  const end = (): void => {
    ended = true;
    if (waiting) runtimeProcess.exit(130);
  };
  runtimeProcess.on("SIGINT", end).on("SIGTERM", end);
  for (;;) {
    // Read before the round, so a move while it lands brings another round.
    const before = placesOf(openOrNull(root) ?? []);
    const code = await round();
    if (ended) return code;
    say("following: landing again once a pull request moves; Ctrl-C ends.");
    waiting = true;
    let open: Pull[] | null = null;
    while (open === null || placesOf(open) === before) {
      await Bun.sleep(WATCH_MS);
      open = openOrNull(root);
    }
    waiting = false;
    if (target !== null && !open.some((pull) => pull.number === target)) {
      say(`#${String(target)} is no longer open; following ends.`);
      return code;
    }
  }
}
