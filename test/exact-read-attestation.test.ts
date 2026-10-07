import { describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../src/meta/digest.ts";
import {
  ExactReadAttestationError,
  type ExactReadSnapshot,
  EXACT_READ_MAX_PATHS,
  snapshotExactReads,
  exactReadDrift,
  exactReadSnapshotsMatch,
} from "../src/verify/exact-read-attestation.ts";
import { READ_ROOT_MAX_BYTES } from "../src/verify/read-root-attestation.ts";

describe("exact-read attestation", () => {
  it("accepts equivalent hardlink realpaths and binds a symlink's lexical bytes", () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), "ana-exact-read-positive-")));
    const target = join(root, "target.txt");
    const link = join(root, "current.txt");
    fs.writeFileSync(target, "same bytes");
    fs.symlinkSync("target.txt", link);
    const alias = join(root, "alias.txt");
    fs.linkSync(target, alias);
    const realpath = spyOn(fs.realpathSync, "native").mockReturnValue(target);
    try {
      realpath.mockReturnValueOnce(target).mockReturnValueOnce(target).mockReturnValueOnce(alias);
      const snapshots = snapshotExactReads([link]);
      const targetSnapshot = snapshots.find((entry) => entry.path === target);
      const linkSnapshot = snapshots.find((entry) => entry.path === link);
      expect(targetSnapshot?.digest).toBe(sha256("same bytes"));
      expect(linkSnapshot?.kind).toBe("symlink");
      expect(linkSnapshot?.target).toBe("file");
      expect(exactReadSnapshotsMatch(snapshots)).toBe(true);
      fs.unlinkSync(alias);
      fs.writeFileSync(alias, "same bytes");
      realpath.mockReturnValueOnce(target).mockReturnValueOnce(target).mockReturnValueOnce(alias);
      expect(() => snapshotExactReads([link])).toThrow("exact sandbox read changed while attesting");
      realpath.mockReturnValueOnce(target).mockReturnValueOnce(alias);
      expect(() => snapshotExactReads([link])).toThrow("exact sandbox read changed while attesting");
    } finally {
      realpath.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a sparse file above the per-file byte boundary before reading it", () => {
    const root = fs.mkdtempSync(join(tmpdir(), "ana-exact-read-sparse-"));
    const target = join(root, "sparse.bin");
    const handle = fs.openSync(target, "w");
    try {
      fs.ftruncateSync(handle, Number(READ_ROOT_MAX_BYTES + 1n));
      let refusal: ExactReadAttestationError | null = null;
      try {
        snapshotExactReads([target]);
      } catch (caught) {
        if (!(caught instanceof ExactReadAttestationError)) throw caught;
        refusal = caught;
      }
      expect(refusal).not.toBeNull();
      expect(refusal?.kind).toBe("limit");
    } finally {
      fs.closeSync(handle);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a regular-file replacement with different bytes", () => {
    const root = fs.mkdtempSync(join(tmpdir(), "ana-exact-read-replace-"));
    const target = join(root, "runtime.bin");
    fs.writeFileSync(target, "unchanged bytes");
    try {
      const snapshots = snapshotExactReads([target]);
      fs.renameSync(target, `${target}.old`);
      fs.writeFileSync(target, "replacement bytes");
      expect(exactReadSnapshotsMatch(snapshots)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlink retarget even when both files have identical bytes", () => {
    const root = fs.mkdtempSync(join(tmpdir(), "ana-exact-read-retarget-"));
    const first = join(root, "first.txt");
    const second = join(root, "second.txt");
    const link = join(root, "current.txt");
    fs.writeFileSync(first, "identical bytes");
    fs.writeFileSync(second, "identical bytes");
    fs.symlinkSync("first.txt", link);
    try {
      const snapshots = snapshotExactReads([link]);
      fs.unlinkSync(link);
      fs.symlinkSync("second.txt", link);
      expect(exactReadSnapshotsMatch(snapshots)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("names a replaced byte as changed and an unreadable path as unavailable", () => {
    // The Opus rehearsal variant on 2026-09-04 refused /usr/bin/cc as "identity changed" on a recorded
    // read-only volume: the boolean match had swallowed a failed re-read. The two kinds must stay
    // apart, because only the first is the wall's refusal and only the second may be retried.
    const root = fs.mkdtempSync(join(tmpdir(), "ana-exact-read-kind-"));
    const target = join(root, "tool.bin");
    fs.writeFileSync(target, "first bytes");
    try {
      const snapshots = snapshotExactReads([target]);
      expect(exactReadDrift(snapshots)).toBeNull();
      fs.writeFileSync(target, "other bytes");
      expect(exactReadDrift(snapshots)).toEqual({
        kind: "changed",
        detail: expect.stringMatching(/^digest differs from its snapshot: .*\/tool\.bin$/),
      });
      fs.unlinkSync(target);
      const gone = exactReadDrift(snapshots);
      expect(gone?.kind).toBe("unavailable");
      expect(gone?.detail).toMatch(/^unavailable: exact sandbox read unavailable at .*ENOENT/);
      expect(exactReadSnapshotsMatch(snapshots)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an unbounded expected snapshot list before filesystem work", () => {
    expect(
      exactReadSnapshotsMatch(
        Array.from({ length: EXACT_READ_MAX_PATHS + 1 }, () => ({
          path: "/not-read",
          kind: "file" as const,
          target: "file" as const,
          digest: "",
          linkDigest: null,
        })),
      ),
    ).toBe(false);
    const oversized = Array.from(
      { length: EXACT_READ_MAX_PATHS + 1 },
      (): ExactReadSnapshot => ({
        path: "/not-read",
        kind: "file",
        target: "file",
        digest: "",
        linkDigest: null,
      }),
    );
    expect(exactReadDrift(oversized)?.kind).toBe("unavailable");
  });
});
