/**
 * A run directory is evidence only while its own manifest still vouches for every byte in it.
 *
 * `EvidenceLog` writes the records and seals them; `verifyRunDir` re-reads the directory and names
 * what moved since; `recordedEvidence` is the single read that hands back bytes and digest from the
 * same pass, so no caller can parse a record the manifest does not attest. Each case damages one
 * recorded run in one way and reads the codes back, and the damage shapes are the ones the product
 * has met: a rewritten case result, a file nobody recorded, a symlink pointing out of the run, a
 * half-written atomic temp file, and a manifest edited to vouch for bytes the writer never produced.
 */
import { afterEach, describe, expect, it } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { EvidenceLog, RUN_MANIFEST_NAME, recordedEvidence, verifyRunDir } from "../src/claim/evidence-log.ts";
import { plainRecord } from "../src/meta/json-evidence.ts";
import { canonicalJson } from "../src/meta/stable-json.ts";
import { sha256 } from "../src/meta/digest.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
const BATTERY_JSON = "battery.json";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-evidence-"));
  dirs.push(dir);
  return dir;
}

/** One battery and one case, written and sealed exactly as the runner writes them. */
function recordedRun(): string {
  const dir = scratch();
  const evidence = new EvidenceLog(dir);
  evidence.write(BATTERY_JSON, { runId: "r1", cases: [{ taskId: "t1" }] });
  evidence.write("cases/t1/case-result.json", { taskId: "t1", pass: true });
  evidence.record();
  return dir;
}

const codesOf = (dir: string): string[] => verifyRunDir(dir).map((violation) => violation.code);

/** Rewrite the sealed manifest with `edit` applied — how a case forges the owner's own record. */
function editManifest(dir: string, edit: (manifest: Record<string, JsonValue>) => void): void {
  const path = join(dir, RUN_MANIFEST_NAME);
  const manifest = parseJsonAs<Record<string, JsonValue>>(readFileSync(path, "utf8"));
  edit(manifest);
  writeFileSync(path, JSON.stringify(manifest));
}

/** Declare `rel` as a historical append of exactly these bytes, as the live writer does. */
function vouchAppend(dir: string, rel: string, bytes: string): void {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), bytes);
  editManifest(dir, (manifest) => {
    manifest.appends = {
      [rel]: { sha256: sha256(bytes), bytes: new TextEncoder().encode(bytes).byteLength },
    };
  });
}

describe("a sealed run directory", () => {
  it("verifies with no violations, and states the schema it was sealed under", () => {
    const dir = recordedRun();
    expect(verifyRunDir(dir)).toEqual([]);
    expect(readFileSync(join(dir, RUN_MANIFEST_NAME), "utf8")).toContain("evidence-stage/v1");
  });

  it.each([
    [
      "a case result rewritten after the seal",
      (dir: string) =>
        writeFileSync(
          join(dir, "cases/t1/case-result.json"),
          JSON.stringify({ taskId: "t1", pass: true, falsified: true }),
        ),
      ["evidence-tampered"],
    ],
    [
      "a record the manifest names but disk no longer holds",
      (dir: string) => unlinkSync(join(dir, BATTERY_JSON)),
      ["evidence-missing"],
    ],
    [
      "a case the owner never wrote",
      (dir: string) => {
        mkdirSync(join(dir, "cases/t2"), { recursive: true });
        writeFileSync(join(dir, "cases/t2/case-result.json"), JSON.stringify({ taskId: "t2", pass: true }));
      },
      ["evidence-foreign"],
    ],
    [
      "a leftover atomic-write temp file",
      (dir: string) => writeFileSync(join(dir, "battery.json.tmp-12345"), "{ half-writ"),
      ["evidence-torn"],
    ],
    [
      // A manifest entry cannot authorise an append outside live/, however well its digest matches.
      "a manifest appends entry pointing outside live/",
      (dir: string) => vouchAppend(dir, "cases/evil/falsified.ndjson", '{"seq":1,"pass":true}\n'),
      ["evidence-foreign"],
    ],
    [
      // The files map still matches every byte; only the declared schema is foreign, and that alone
      // stops the directory vouching for anything.
      "a manifest declaring a foreign schema version",
      (dir: string) => editManifest(dir, (manifest) => void (manifest.schemaVersion = "evidence-stage/v2")),
      ["run-unrecorded"],
    ],
    [
      // A value the reader cannot compare is not a digest. Until 2026-09-20 the parse asserted the
      // manifest into shape before the guard read it, so a number reached `sha256(bytes) !== expected`
      // and came back as one changed file rather than as a manifest nothing here can read.
      "a manifest whose files map holds a number where a digest belongs",
      (dir: string) => editManifest(dir, (manifest) => void (manifest.files = { [BATTERY_JSON]: 7 })),
      ["run-unrecorded"],
    ],
    [
      // The same for an append row: without its byte count there is nothing to compare a growing
      // file against, and half a record is not the record this reader understands.
      "a manifest whose append row is missing its byte count",
      (dir: string) =>
        editManifest(dir, (manifest) => void (manifest.appends = { "live/journal.ndjson": { sha256: "0" } })),
      ["run-unrecorded"],
    ],
  ])("reads %s as %j", (_injury, damage, codes) => {
    const dir = recordedRun();
    damage(dir);
    expect(codesOf(dir)).toEqual(codes);
  });

  it("never follows a symlink, and never verifies through one", () => {
    // The redirect-shaped attack: replace a sealed record with a link to identical bytes elsewhere.
    const dir = recordedRun();
    const outside = scratch();
    writeFileSync(join(outside, BATTERY_JSON), readFileSync(join(dir, BATTERY_JSON)));
    unlinkSync(join(dir, BATTERY_JSON));
    symlinkSync(join(outside, BATTERY_JSON), join(dir, BATTERY_JSON));
    const codes = codesOf(dir);
    expect(codes).toContain("evidence-irregular");
    // The linked bytes are not a verified regular file either, so they never read as present.
    expect(codes).not.toContain("evidence-tampered");
  });

  it("vouches for nothing at all when it was never sealed", () => {
    const bare = scratch();
    writeFileSync(join(bare, BATTERY_JSON), "{}");
    expect(codesOf(bare)).toEqual(["run-unrecorded"]);
  });
});

describe("a historical append, which grows after the seal", () => {
  it("verifies against its recorded digest and reports later drift", () => {
    const dir = recordedRun();
    vouchAppend(dir, "live/journal.ndjson", '{"seq":1}\n');
    expect(verifyRunDir(dir)).toEqual([]);
    appendFileSync(join(dir, "live/journal.ndjson"), "junk\n");
    expect(codesOf(dir)).toEqual(["evidence-append-diverged"]);
  });

  it("is missing, not merely unread, when the manifest names it and disk does not hold it", () => {
    const dir = recordedRun();
    vouchAppend(dir, "live/journal.ndjson", '{"seq":1}\n');
    unlinkSync(join(dir, "live/journal.ndjson"));
    expect(codesOf(dir)).toEqual(["evidence-missing"]);
  });
});

describe("recordedEvidence — the one verified read", () => {
  it("returns the digest together with the bytes it attests, from the same read", () => {
    const recorded = recordedEvidence(recordedRun(), BATTERY_JSON);
    if (!recorded.ok) throw new Error(recorded.refusal);
    expect(recorded.sha256).toBe(sha256(recorded.bytes));
    expect(parseJsonAs<{ runId: string }>(recorded.bytes).runId).toBe("r1");
  });

  it.each([
    [
      "a record rewritten after the seal",
      (dir: string) =>
        writeFileSync(join(dir, BATTERY_JSON), JSON.stringify({ runId: "r1", cases: [], falsified: true })),
      "[evidence-tampered] battery.json",
    ],
    [
      "a directory whose manifest vouches for nothing",
      (dir: string) => editManifest(dir, (manifest) => void (manifest.schemaVersion = "evidence-stage/v2")),
      "[run-unrecorded]",
    ],
  ])("refuses %s — the caller never sees those bytes", (_injury, damage, refusal) => {
    const dir = recordedRun();
    damage(dir);
    expect(recordedEvidence(dir, BATTERY_JSON)).toEqual({
      ok: false,
      refusal: expect.stringContaining(refusal),
    });
  });
});

// The primitive every record above is written in. A digest is evidence only while the bytes it
// covers are reproducible, so the canonical form is pinned to its exact output and hash.
describe("canonical JSON", () => {
  it("keeps stable bytes and their digest", () => {
    const canonical = canonicalJson({ z: [3, { b: true, a: null }], a: "first" });
    expect(canonical).toBe('{"a":"first","z":[3,{"a":null,"b":true}]}');
    expect(sha256(canonical)).toBe("bbad75bdb9d7c6ca6b3708b4f754ba72c937c657170afbb9fe2fd1b7e8b98e57");
  });

  it("sorts keys and keeps undefined distinct from null", () => {
    expect(canonicalJson({ ä: undefined, z: null, a: 1 })).toBe('{"a":1,"z":null,"ä":undefined}');
    expect(canonicalJson({ value: undefined })).not.toBe(canonicalJson({ value: null }));
  });

  it("recognises a plain record and nothing else", () => {
    expect(plainRecord({ ok: true })).toEqual({ ok: true });
    expect(plainRecord([])).toBeNull();
    expect(
      plainRecord(
        new (class Evidence {
          readonly kind = "evidence";
        })(),
      ),
    ).toBeNull();
  });
});
