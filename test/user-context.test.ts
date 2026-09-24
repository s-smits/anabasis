import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { heapStats } from "bun:jsc";
import { afterEach, describe, expect, it } from "bun:test";
import {
  jsonListPage,
  LIST_WINDOW_ROWS,
  READ_WINDOW_LINES,
  readWindow,
  windowNote,
  windowRange,
  visibleError,
} from "../src/builder/read-window.ts";
import {
  contextManifest,
  type PreparedUserContext,
  prepareUserContext,
} from "../src/builder/user-context.ts";
import { createContextTool, RehearsalTraces } from "../src/builder/context-tool.ts";
import { TOOL_TEXT_LIMITS } from "../src/solve/define-tool.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-context-"));
  scratch.push(dir);
  return dir;
}

/** The context tool scoped to the user source, over a workspace that holds nothing. */
function userTool(context: PreparedUserContext) {
  const tool = createContextTool({
    round: "",
    workspace: "/nonexistent-context-workspace",
    rehearsals: new RehearsalTraces(),
    user: context,
  });
  return async (args: {
    depth: "overview" | "cited" | "page";
    question?: string;
    id?: string;
    offset?: number;
    limit?: number;
    characterOffset?: number;
  }): Promise<string> => {
    const result = await tool.execute("context", {
      question: "user context",
      decides: "the test",
      source: "user",
      ...args,
    });
    const block = result.content[0];
    return block?.type === "text" ? block.text : "";
  };
}

describe("direct user context", () => {
  it("admits shared and explicit text as one immutable, hash-bound corpus", () => {
    const repo = root();
    mkdirSync(join(repo, "context"), { recursive: true });
    mkdirSync(join(repo, "notes"), { recursive: true });
    writeFileSync(join(repo, "context", "standard.md"), "public standard\nrevision 7\n");
    // No closing newline, so this is one line by the convention `readWindow`, `eachFileLine` and
    // `scanTextFile` share: a trailing newline opens an empty last line rather than ending the file.
    // It is also the shape a one-line operator note actually arrives in, and the only fixture here
    // that reaches the singular — the card read "(1 lines, sha256:…)" until 2026-09-18.
    writeFileSync(join(repo, "notes", "constraints.txt"), "budget: 20 EUR");
    const context = prepareUserContext(repo, ["notes"]);
    expect(context.files.map((file) => file.label)).toEqual(["context/standard.md", "notes/constraints.txt"]);
    expect(context.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(contextManifest(context)).toContain("ctx-1: context/standard.md (3 lines, sha256:");
    expect(contextManifest(context)).toContain("ctx-2: notes/constraints.txt (1 line, sha256:");
    writeFileSync(join(repo, "notes", "constraints.txt"), "budget: 30 EUR");
    expect(prepareUserContext(repo, ["notes"]).digest).not.toBe(context.digest);
  });

  it("returns the admitted bytes after the source is changed, replaced or symlink-swapped", async () => {
    const repo = root();
    writeFileSync(join(repo, "real.md"), "admitted line\n");
    symlinkSync(join(repo, "real.md"), join(repo, "link.md"));
    const context = prepareUserContext(repo, ["link.md"]);
    const ask = userTool(context);
    writeFileSync(join(repo, "real.md"), "changed line\n");
    writeFileSync(join(repo, "other.md"), "other line\n");
    rmSync(join(repo, "link.md"));
    symlinkSync(join(repo, "other.md"), join(repo, "link.md"));
    rmSync(join(repo, "real.md"));
    writeFileSync(join(repo, "real.md"), "replaced line\n");
    const read = await ask({ depth: "page", id: "ctx-1" });
    expect(read).toContain("admitted line");
    expect(read).not.toMatch(/changed|other|replaced/);
    expect(read).toContain(`sha256:${context.files[0]?.sha256}`);
    const hits = await ask({ depth: "cited", question: "line" });
    expect(hits.split("\n").slice(1)).toEqual(["[ctx-1:L1] admitted line"]);
  });

  it("lists, reads, and searches without exposing a general filesystem reader", async () => {
    const repo = root();
    writeFileSync(join(repo, "brief.md"), "Use the RP2040.\nKeep power below 1 W.\n");
    const context = prepareUserContext(repo, ["brief.md"]);
    const ask = userTool(context);
    expect(await ask({ depth: "overview" })).toBe(
      `documents 1-1 of 1:\n- ctx-1 (user): brief.md sha256:${context.files[0]?.sha256}`,
    );
    const read = await ask({ depth: "page", id: "ctx-1" });
    expect(read).toContain("RP2040");
    expect(read).toContain(`sha256:${context.files[0]?.sha256}`);
    expect(await ask({ depth: "cited", question: "power" })).toBe(
      "Citations 1-1 of 1 over 1 document(s), best match first. Page an id for the surrounding lines.\n[ctx-1:L2] Keep power below 1 W.",
    );
    await expect(ask({ depth: "page", id: "../secret" })).rejects.toThrow(/unknown context id/);
  });

  // A listing is one JSON body, and the record count alone does not bound it. Paged by count only,
  // 200 rows of admitted paths crossed the 64 KB tool ceiling and were cut mid-structure: the
  // Builder read "to":200,"more":false above a fragment that will not parse, and the offset that
  // reply named skipped every row the cut had removed.
  it("pages a large listing without promising records the body does not carry", async () => {
    const repo = root();
    const dir = join(repo, "ctx");
    mkdirSync(dir);
    for (let index = 1; index <= 200; index += 1) {
      writeFileSync(join(dir, `${String(index).padStart(3, "0")}-${"n".repeat(200)}.md`), "one line\n");
    }
    const ask = userTool(prepareUserContext(repo, ["ctx"]));
    const first = await ask({ depth: "overview", limit: 1_000 });
    const range = /documents 1-(\d+) of 200; call again with offset (\d+)/.exec(first);
    const to = Number(range?.[1]);
    expect(Number(range?.[2])).toBe(to + 1);
    expect(first.split("\n").slice(1)).toHaveLength(to);
    const next = await ask({ depth: "overview", offset: to + 1 });
    expect(next.split("\n")[1]).toStartWith(`- ctx-${to + 1} (user)`);
  });

  // The earlier context limit was 512 KiB, already larger than evidenceResult's 64 KiB limit.
  // A file between the two was admitted and listed with its line count, then failed when read.
  // Larger admission limits still need bounded read windows for the same reason.
  it("reads a file larger than the evidence ceiling in stated windows", async () => {
    const repo = root();
    const lines = Array.from({ length: 6_000 }, (_, index) => `line ${index + 1}: ${"detail ".repeat(10)}`);
    writeFileSync(join(repo, "big.md"), lines.join("\n"));
    const ask = userTool(prepareUserContext(repo, ["big.md"]));
    const first = await ask({ depth: "page", id: "ctx-1" });
    expect(first).toContain("lines 1-400 of 6000; call again with offset 401");
    expect(first).toContain("line 1:");
    expect(first).not.toContain("line 401:");
    const later = await ask({ depth: "page", id: "ctx-1", offset: 5_900 });
    expect(later).toContain("lines 5900-6000 of 6000");
    expect(later).not.toContain("call again");
    expect(later).toContain("line 6000:");
  });

  it("pages an oversized single line to its exact end instead of making the tail unreachable", async () => {
    const repo = root();
    const value = `start-${"x".repeat(80_000)}-end`;
    writeFileSync(join(repo, "minified.json"), value);
    const ask = userTool(prepareUserContext(repo, ["minified.json"]));
    const parts: string[] = [];
    let characterOffset: number | undefined;
    for (;;) {
      const page = await ask({
        depth: "page",
        id: "ctx-1",
        ...keyIfDefined("characterOffset", characterOffset),
      });
      const range = /characters (\d+)-(\d+) of (\d+)/.exec(page);
      expect(range).not.toBeNull();
      parts.push(page.slice(page.indexOf("\n\n") + 2));
      const to = Number(range?.[2]);
      const total = Number(range?.[3]);
      if (to >= total) break;
      characterOffset = to + 1;
    }
    expect(parts.join("")).toBe(value);
  });

  // A search that stopped counting at its page size reported "40 matches" for a corpus holding
  // hundreds, and the model had no way to tell a complete answer from a truncated one.
  it("states the whole match count even when it returns one page of them", async () => {
    const repo = root();
    writeFileSync(join(repo, "hits.md"), Array.from({ length: 120 }, () => "power rail").join("\n"));
    const ask = userTool(prepareUserContext(repo, ["hits.md"]));
    const page = await ask({ depth: "cited", question: "power" });
    expect(page).toStartWith(
      "Citations 1-30 of 120 over 1 document(s), best match first; continue with offset 31.",
    );
    expect(page.split("\n").slice(1)).toHaveLength(30);
    const later = await ask({ depth: "cited", question: "power", offset: 101 });
    expect(later).toStartWith("Citations 101-120 of 120 over 1 document(s), best match first. Page");
  });

  it("skips symlinks and hidden descendants, and refuses missing or binary inputs", () => {
    const repo = root();
    const corpus = join(repo, "corpus");
    mkdirSync(join(corpus, ".private"), { recursive: true });
    writeFileSync(join(corpus, ".private", "token"), "secret");
    writeFileSync(join(corpus, "public.txt"), "public");
    writeFileSync(join(repo, "outside.txt"), "outside");
    symlinkSync(join(repo, "outside.txt"), join(corpus, "linked.txt"));
    expect(prepareUserContext(repo, ["corpus"]).files.map((file) => file.label)).toEqual([
      "corpus/public.txt",
    ]);
    expect(() => prepareUserContext(repo, ["absent"])).toThrow(/does not exist/);
    writeFileSync(join(repo, "binary.dat"), Uint8Array.from([0, 1, 2]));
    expect(() => prepareUserContext(repo, ["binary.dat"])).toThrow(/text files only/);
  });

  it("names what it refused, and refuses binaries a zero-byte scan would have admitted", () => {
    const cases: Array<[string, Uint8Array, string]> = [
      ["paper.pdf", Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]), "application/pdf"],
      ["shot.png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
      ["bundle.zip", Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]), "application/zip"],
      // Valid UTF-8 byte-wise, no zero byte, but nine tenths control characters.
      [
        "telemetry.bin",
        Uint8Array.from(Array.from({ length: 64 }, (_, i) => (i % 10 === 0 ? 0x41 : 0x01))),
        "application/octet-stream",
      ],
      // A lone 0xff never appears in UTF-8, so the strict decoder refuses it.
      ["latin.txt", Uint8Array.from([0x41, 0xff, 0x42, 0x43]), "application/octet-stream"],
    ];
    for (const [name, bytes, expected] of cases) {
      const repo = root();
      writeFileSync(join(repo, name), bytes);
      expect(() => prepareUserContext(repo, [name])).toThrow(
        new RegExp(`text files only \\(${expected.replace("/", String.raw`\/`)}\\)`),
      );
    }
  });

  it("admits text whose multi-byte characters straddle the first chunk boundary", () => {
    const repo = root();
    // 256 KiB is the sniff window; put a three-byte character across its last boundary.
    writeFileSync(join(repo, "wide.md"), `${"a".repeat(256 * 1024 - 1)}\u20ac tail\n`);
    const context = prepareUserContext(repo, ["wide.md"]);
    expect(context.files[0]?.label).toBe("wide.md");
  });

  it("refuses an oversized file from its size alone, without loading it", () => {
    const repo = root();
    const huge = join(repo, "huge.txt");
    // Sparse: one byte written far out, so the entry reports 4 GiB while the disk holds almost
    // nothing. Reading before measuring would fail on the runtime's own buffer ceiling instead of
    // this contract, which is exactly the confusion the size gate removes.
    const handle = openSync(huge, "w");
    try {
      writeSync(handle, Uint8Array.of(65), 0, 1, 4 * 1024 * 1024 * 1024 - 1);
    } finally {
      closeSync(handle);
    }
    expect(Bun.file(huge).size).toBe(4 * 1024 * 1024 * 1024);
    expect(() => prepareUserContext(repo, ["huge.txt"])).toThrow(/context file exceeds 26214400 bytes/);
  });

  it("admits a file well above the previous 512 KiB ceiling", () => {
    const repo = root();
    const line = `${"context ".repeat(127)}\n`;
    writeFileSync(join(repo, "large.md"), line.repeat(2_000));
    const context = prepareUserContext(repo, ["large.md"]);
    expect(context.files[0]?.bytes).toBeGreaterThan(512 * 1024);
    expect(context.files[0]?.lines).toBe(2_001);
  });

  // The ceiling is 25 MiB per file and 200 MiB across the corpus. Admission retains snapshot paths
  // and recorded totals, and each read opens the saved snapshot. The corpus text therefore need
  // not remain in memory for the whole run. This test allows for metadata and temporary buffers
  // while checking that reading a large corpus does not retain all its text.
  it("admits a large corpus, then reads and searches it, without holding its text", async () => {
    const repo = root();
    const line = `${"context material ".repeat(60)}\n`;
    // One rare line per file, so the search returns three matches. A query matching every line
    // would hold every matching line, which is the match set doing its job and not this claim.
    for (const name of ["a.md", "b.md", "c.md"]) {
      writeFileSync(join(repo, name), `${line.repeat(8_000)}the unmistakable marker\n`);
    }
    // Collect first, and again before the second sample: heapSize counts garbage that has not been
    // collected yet, and one pass over 24 MB decodes 24 MB of short-lived chunk strings. Without
    // this the test reads that garbage as retention and fails whenever the suite is busy enough to
    // delay a collection.
    Bun.gc(true);
    const before = heapStats().heapSize;
    const context = prepareUserContext(repo, ["a.md", "b.md", "c.md"]);
    const ask = userTool(context);
    await ask({ depth: "page", id: "ctx-3", offset: 7_900 });
    const found = await ask({ depth: "cited", question: "unmistakable" });
    Bun.gc(true);
    const grew = heapStats().heapSize - before;
    expect(context.files.reduce((total, file) => total + file.bytes, 0)).toBeGreaterThan(24_000_000);
    expect(found).toStartWith("Citations 1-3 of 3 over 3 document(s)");
    expect(grew).toBeLessThan(8 * 1024 * 1024);
  });

  it("serves a read from a controller-owned snapshot rather than from held text or the source", async () => {
    const repo = root();
    writeFileSync(join(repo, "spec.md"), "first line\nsecond line\n");
    const context = prepareUserContext(repo, ["spec.md"]);
    const file = context.files[0];
    expect(file?.path).not.toBe(realpathSync(join(repo, "spec.md")));
    expect(file?.path.startsWith(tmpdir())).toBe(true);
    // Nothing in the record carries the file's text: the snapshot is a file, so a 200 MB corpus
    // is not held in memory from launch to terminal.
    expect(JSON.stringify(file)).not.toContain("second line");
    expect(await userTool(context)({ depth: "page", id: "ctx-1" })).toContain("second line");
  });

  it("an empty context creates no staging directory and can be disposed", () => {
    const repo = root();
    const context = prepareUserContext(repo, []);
    expect(context.files).toEqual([]);
    expect(context.root).toBeNull();
    expect(() => context.dispose()).not.toThrow();
  });

  it("owns its staging root and removes it once on dispose", () => {
    const repo = root();
    writeFileSync(join(repo, "spec.md"), "owned\n");
    const context = prepareUserContext(repo, ["spec.md"]);
    // SAFETY: this fixture admits one file, which requires a staging root. The existence check
    // below verifies that directory before disposal; the cast states its expected type.
    const stagedRoot = context.root as string;
    expect(existsSync(stagedRoot)).toBe(true);
    context.dispose();
    expect(existsSync(stagedRoot)).toBe(false);
    expect(() => context.dispose()).not.toThrow();
  });

  it("a refused corpus leaves no staging directory behind", () => {
    const repo = root();
    writeFileSync(join(repo, "good.md"), "fine\n");
    writeFileSync(join(repo, "bad.dat"), Uint8Array.from([0, 1, 2]));
    // The staging directory goes under `tmpdir()`, which is the whole machine's: counting names
    // there made this assertion depend on whichever other test file was staging a corpus at the
    // same moment. TMPDIR is this process's own for the length of the call, so the count is this
    // call's alone.
    const staging = root();
    const previous = Bun.env.TMPDIR;
    Bun.env.TMPDIR = staging;
    try {
      expect(() => prepareUserContext(repo, ["good.md", "bad.dat"])).toThrow(/text files only/);
      expect(readdirSync(staging).filter((entry) => entry.startsWith("ana-user-context-"))).toEqual([]);
    } finally {
      Bun.env.TMPDIR = previous;
    }
  });
});

/**
 * Tests for the read window (src/builder/read-window.ts), which provides the context tool's
 * paging behaviour.
 *
 * The window exists because `evidenceResult` throws above TOOL_TEXT_LIMITS.evidence while the
 * admission ceilings above it are larger, so the first test states that ceiling relationship
 * directly: if a returned window exceeds the evidence limit, this test fails before a live
 * Builder encounters that failure while reading a large context file.
 */
describe("the read window", () => {
  it("keeps every window under the evidence ceiling that made it necessary", () => {
    const line = "x".repeat(200);
    const window = readWindow(Array.from({ length: 20_000 }, () => line).join("\n"), 1, 20_000);
    expect(new TextEncoder().encode(window.text).byteLength).toBeLessThan(TOOL_TEXT_LIMITS.evidence);
    // The line count asked for 20,000; the byte guard is what actually cut it, and `more` is how
    // the caller learns that. A window that cut silently would read as a complete file.
    expect(window.more).toBe(true);
    expect(window.total).toBe(20_000);
    expect(window.to).toBeLessThan(20_000);
  });

  it("walks a file to its end, then reports an empty window instead of failing", () => {
    const source = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n");
    const first = readWindow(source, 1, 4);
    expect([first.from, first.to, first.more]).toEqual([1, 4, true]);
    expect(first.text).toBe("line 1\nline 2\nline 3\nline 4");
    const last = readWindow(source, 9, 4);
    expect([last.from, last.to, last.more]).toEqual([9, 10, false]);
    const past = readWindow(source, 40, 4);
    expect([past.from, past.to, past.more, past.text]).toEqual([40, 39, false, ""]);
  });

  it("shows the beginning of a single line too long to fit rather than refusing it", () => {
    // Minified public data arrives as one line. Refusing it would leave the Builder unable to see
    // the shape of a file the controller admitted.
    const window = readWindow("y".repeat(400_000));
    expect(window.total).toBe(1);
    expect(window.text.length).toBeGreaterThan(1_000);
    expect(new TextEncoder().encode(window.text).byteLength).toBeLessThan(TOOL_TEXT_LIMITS.evidence);
    // `more` is false because no LINE follows, and that is exactly why `cut` has to exist: the
    // range alone reads as a complete read of a one-line file, and no offset reaches the tail.
    expect(window.more).toBe(false);
    expect(window.cut).toBe(true);
    expect(windowNote(window, "lines")).toContain("was cut at the byte guard");
  });

  it("treats a nonsense offset or limit as the nearest sensible window", () => {
    const source = "a\nb\nc";
    expect(readWindow(source, 0, 2).from).toBe(1);
    expect(readWindow(source, -5, 2).from).toBe(1);
    expect(readWindow(source, 1, 0).to).toBe(1);
    expect(readWindow(source, 1.7, 1.2).from).toBe(1);
  });

  it("states the range and the next offset in one sentence", () => {
    expect(windowNote({ from: 1, to: 400, total: 1200, more: true }, "lines")).toBe(
      "lines 1-400 of 1200; call again with offset 401 for the rest",
    );
    expect(windowNote({ from: 1, to: 12, total: 12, more: false }, "lines")).toBe("lines 1-12 of 12");
    expect(windowNote({ from: 3, to: 3, total: 3, more: false, cut: true }, "lines")).toBe(
      "lines 3-3 of 3; line 3 was cut at the byte guard and its remaining bytes are not reachable by offset",
    );
  });

  it("pages listings by the same arithmetic as text", () => {
    expect(windowRange(500, 1, LIST_WINDOW_ROWS)).toEqual({ from: 1, to: 200, more: true });
    expect(windowRange(500, 401, LIST_WINDOW_ROWS)).toEqual({ from: 401, to: 500, more: false });
    expect(windowRange(10)).toEqual({ from: 1, to: 10, more: false });
    expect(READ_WINDOW_LINES).toBeGreaterThan(LIST_WINDOW_ROWS);
  });

  it("stops a JSON listing at the byte guard and names the records it carries", () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({ id: index + 1, label: "x".repeat(400) }));
    const page = jsonListPage(rows, "files", 1, LIST_WINDOW_ROWS);
    expect(page.count).toBeLessThan(rows.length);
    expect(page).toMatchObject({ from: 1, to: page.count, total: 200, more: true });
    const body = JSON.parse(page.text);
    expect(body.files).toHaveLength(page.count);
    expect(new TextEncoder().encode(page.text).byteLength).toBeLessThan(TOOL_TEXT_LIMITS.evidence);
    // The offset the page names is the next unread record, not the one a count-only window promised.
    expect(JSON.parse(jsonListPage(rows, "files", page.to + 1, LIST_WINDOW_ROWS).text).files[0].id).toBe(
      page.to + 1,
    );
  });

  it("returns a listing that fits whole, and advances on a record that does not", () => {
    expect(jsonListPage([{ id: 1 }, { id: 2 }], "files", 1, LIST_WINDOW_ROWS)).toMatchObject({
      from: 1,
      to: 2,
      more: false,
      total: 2,
      count: 2,
    });
    // One record is always taken, as readWindow always returns a first line: a page that returned
    // nothing would leave the caller asking for the same offset forever.
    expect(jsonListPage([{ text: "x".repeat(60_000) }, { text: "y" }], "matches", 1, 40)).toMatchObject({
      from: 1,
      to: 1,
      more: true,
      count: 1,
    });
  });

  // One sentence with one owner. harness_trial and correctness_check each held a byte-identical
  // copy over a page size both had independently chosen as 3,000, and both said "1 characters
  // omitted" on the cause that is exactly one character too long.
  it("pages a thrown cause and counts what did not fit", () => {
    expect(visibleError(new Error("short"))).toBe("short");
    expect(visibleError("a plain string cause")).toBe("a plain string cause");
    expect(visibleError(new Error("x".repeat(3_001)))).toEndWith("… (1 character omitted)");
    expect(visibleError(new Error("x".repeat(3_002)))).toEndWith("… (2 characters omitted)");
    expect(visibleError(new Error("xyz"), 2)).toBe("xy… (1 character omitted)");
  });
});
