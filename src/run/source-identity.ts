/**
 * Bind campaign evidence to the executed source revision. It is captured once at module load, so a
 * process whose imported source changes underneath it — a commit made mid-run — keeps its original
 * identity instead of attributing later commits to itself. A null identity (not a git work tree,
 * git absent) is typed absence: disclosed, never guessed.
 *
 * The `sourceDigest` field exists because a dirty boolean is disclosure rather than binding. F2
 * census children resolve their module graph from disk at spawn, so two captures are attributably
 * the same source only when the executed bytes agree. The digest covers the executable and
 * model-visible product roots alone, which is why a README or BUILD-STATE edit does not change
 * that content identity.
 *
 * A digest over a diff against HEAD cannot stand alone: bytes matching a new HEAD hash the same as
 * bytes matching the old one, so `sourceStillFrozen` would have to compare `commit` as well, and
 * that conjunction makes every commit read as source drift. Committing a docs edit, or untracking
 * a controller-owned output, then refuses the F2 census as `owner: environment` without one
 * executed byte having changed. So the digest hashes the roots' full contents and is the only
 * thing compared: a new commit is not drift, and neither is a mode change on a root file. `commit`
 * stays on the evidence as attribution disclosure.
 */
import { readFileSync } from "../meta/filesystem.ts";
import { FROZEN_MANIFEST_PATH } from "../critic/manifest.ts";
import { hostTool } from "../meta/host-tool.ts";
import { join } from "../meta/path.ts";
import { CAPTURE_MAX_BYTES, runTextSyncOrThrow } from "../meta/subprocess.ts";

export type SourceIdentity = {
  commit: string;
  /** Uncommitted tracked changes at process start: attribution to the bare commit is unproven. */
  dirty: boolean;
  /** sha256 over the product roots' contents: every tracked and non-ignored untracked file
   *  under the roots, path and bytes, in sorted order. Independent of HEAD, so this field alone
   *  decides whether the executed source still matches the frozen process. */
  sourceDigest: string;
};

/** What product code executes or copies into a model-visible workspace; docs and outputs stay out. */
const EXECUTABLE_ROOTS = [
  "src",
  "starters",
  "tools",
  "vendor",
  "package.json",
  "bun.lock",
  ".bun-version",
  FROZEN_MANIFEST_PATH,
  "tsconfig.json",
] as const;

let indexRefreshed = false;

/** `git status` re-hashes every file whose stat information the index does not vouch for. A fresh
 *  checkout leaves every file in that state, and `--no-optional-locks` keeps every later status from
 *  writing the refreshed information back, so each capture re-read the whole tree: 204 ms against
 *  19 ms with a refreshed index. One refresh per process, best effort: a held lock or a read-only
 *  tree leaves the slow path and changes no result. */
function refreshIndexOnce(): void {
  if (indexRefreshed) return;
  indexRefreshed = true;
  Bun.spawnSync({
    cmd: [hostTool("git"), "update-index", "-q", "--refresh"],
    stdout: "ignore",
    stderr: "ignore",
  });
}

/** Untrimmed, because a file read through `git show` is hashed byte for byte. */
function gitRaw(args: string[], repo = "."): string {
  // `--no-optional-locks`: the read-only capture never needs to refresh the index, and taking
  // `.git/index.lock` for that made concurrent captures in one work tree wait on each other.
  // A working tree larger than the cap ends as a thrown capture failure, never as a short read
  // that would digest to a wrong source identity.
  return runTextSyncOrThrow([hostTool("git"), "--no-optional-locks", "-C", repo, ...args], {
    maxBuffer: CAPTURE_MAX_BYTES,
  });
}

function git(args: string[]): string {
  return gitRaw(args).trim();
}

/**
 * The `sourceDigest` of the checkout at `repo`, the working directory by default. A path named in
 * `committed` is hashed as HEAD holds it rather than as the disk does: a review checkout may carry
 * a local edit to its runtime pin so that it runs under the Bun at hand, and the identity it is
 * compared with hashed the pin the run was launched on.
 */
export function digestExecutableRoots(repo = ".", committed: readonly string[] = []): string {
  // Tracked plus non-ignored untracked, so a new uncommitted module under a root counts as the
  // executed source it is while build outputs stay out through --exclude-standard. Sorted, so the
  // digest depends on the bytes rather than on git's listing order.
  const listed = gitRaw(
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...EXECUTABLE_ROOTS],
    repo,
  );
  const paths = [...new Set(listed.split("\0").filter((entry) => entry.length > 0))].sort();
  const hash = new Bun.CryptoHasher("sha256");
  for (const path of paths) {
    hash.update(`\0${path}\0`);
    try {
      hash.update(
        committed.includes(path) ? gitRaw(["show", `HEAD:${path}`], repo) : readFileSync(join(repo, path)),
      );
    } catch {
      // Tracked but deleted from the working tree, or unreadable: absence marks the digest
      // instead of hashing as though the file were still there unchanged.
      hash.update("<absent>");
    }
  }
  return hash.digest("hex");
}

export function captureSourceIdentity(): SourceIdentity | null {
  try {
    refreshIndexOnce();
    return {
      commit: git(["rev-parse", "HEAD"]),
      dirty: git(["status", "--porcelain", "--untracked-files=no"]).length > 0,
      sourceDigest: digestExecutableRoots(),
    };
  } catch {
    return null;
  }
}

/** The disk's root content alone, for a drift check that records no identity: one file listing
 *  and the root bytes, without the status walk. */
export function captureSourceDigest(): Pick<SourceIdentity, "sourceDigest"> | null {
  try {
    return { sourceDigest: digestExecutableRoots() };
  } catch {
    return null;
  }
}

/** The source identity captured at process start and used by consumers for attribution. */
export const SOURCE_IDENTITY: SourceIdentity | null = captureSourceIdentity();

/**
 * Null when the disk's product roots still match the frozen identity, or when either
 * capture is typed absence; a claim naming the divergence otherwise. The frozen identity is
 * the baseline for every call. Consumers use this comparison instead of comparing two fresh
 * captures, so checks before and after an operation both refer to the process's initial source.
 *
 * The executed bytes are the whole test. A commit hash is attribution, not drift: moving HEAD over
 * identical root content is not a source change, and identical content under a different HEAD is
 * the same executed source.
 */
export function sourceStillFrozen(
  disk: (Partial<SourceIdentity> & Pick<SourceIdentity, "sourceDigest">) | null = captureSourceDigest(),
): string | null {
  if (SOURCE_IDENTITY === null || disk === null) return null;
  return disk.sourceDigest === SOURCE_IDENTITY.sourceDigest
    ? null
    : "the executable or model-visible source roots on disk differ from the process's frozen identity";
}
