// A value given by `from_file` from a writing session's home to `try_answer`: what it reads, and the
// paths and texts it refuses.
import { afterAll, describe, expect, it } from "bun:test";
import { validateToolArguments } from "@earendil-works/pi-ai/utils/validation";
import { writing } from "../src/examiner/write.ts";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { instance, seat, sweep, toolOf } from "./helpers/examiner-seat.ts";

const ANSWER = { answer: "49", unit: "N" };

afterAll(sweep);

const spelled = (base: number) => {
  const { family, public_input, hidden } = instance(base);
  return { family, public_input, hidden };
};

describe("a value given from a file in the Examiner's home", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "ana-from-file-")));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "ana-from-file-out-")));
  afterAll(() => {
    for (const dir of [home, outside]) rmSync(dir, { recursive: true, force: true });
  });
  // An instance of about 50 KB, the size a jobstat Examiner wrote with a program of its own.
  const large = {
    ...spelled(7),
    public_input: { base: 7, rows: Array.from({ length: 10_000 }, (_, n) => n * 1.5) },
  };
  writeFileSync(join(home, "task.json"), JSON.stringify(large));
  writeFileSync(join(home, "input.json"), JSON.stringify(large.public_input));
  writeFileSync(join(home, "answer.json"), JSON.stringify(ANSWER));
  writeFileSync(join(outside, "task.json"), JSON.stringify(large));
  symlinkSync(join(outside, "task.json"), join(home, "linked.json"));

  const trying = (at: string | null = home) => {
    const s = seat("write", []);
    const request = { ...s.request, verify: async () => ({ kind: "pass" as const }) };
    return toolOf(writing(request, undefined, { home: at ?? undefined }), "try_answer");
  };
  const prepared = (args: JsonObject, at: string | null = home) => trying(at).prepareArguments?.(args);

  it("reads a whole list from a file before the schema is checked, and refuses one of the wrong shape without echoing it", () => {
    const files = [{ path: "out/report.md", text: "x".repeat(60_000) }];
    writeFileSync(join(home, "files.json"), JSON.stringify(files));
    writeFileSync(
      join(home, "misshapen.json"),
      JSON.stringify([{ name: "out/report.md", body: "y".repeat(60_000) }]),
    );
    // pi checks a call's arguments against the tool's schema once they are prepared, so the file is
    // read before that check, which would otherwise refuse it in place of the list.
    const byFile = { ...large, answer: ANSWER, files: { from_file: "files.json" } };
    const tool = trying();
    const check = (args: JsonObject) => {
      validateToolArguments(tool, { type: "toolCall", id: "", name: tool.name, arguments: args });
    };
    expect(() => check(byFile)).toThrow("files");
    const filled = prepared(byFile);
    expect(filled).toMatchObject({ files });
    // SAFETY: the prepared arguments of a call whose arguments are a JSON object.
    expect(() => check(filled as JsonObject)).not.toThrow();

    const rawBin = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    writeFileSync(join(home, "chart.png"), rawBin);
    const withBase64 = prepared({
      ...large,
      answer: ANSWER,
      files: [{ path: "chart.png", base64: { from_file: "chart.png" } }],
    });
    expect(withBase64).toMatchObject({
      files: [{ path: "chart.png", base64: rawBin.toString("base64") }],
    });
    expect(prepared({ ...large, answer: { from_file: "task.json", extra: 1 } })).toMatchObject({
      answer: { from_file: "task.json", extra: 1 },
    });
    let refusal = "";
    try {
      prepared({ ...large, answer: ANSWER, files: { from_file: "misshapen.json" } });
    } catch (error) {
      refusal = String(error);
    }
    expect(refusal).toContain("files.0.path");
    expect(refusal).not.toContain("yyyy");
    expect(refusal.length).toBeLessThan(2000);
  });

  it("refuses a path outside the home, a link out of it, a missing file, a folder, a file too large and text that is not JSON", () => {
    writeFileSync(join(home, "broken.json"), "{ not json");
    mkdirSync(join(home, "folder.json"));
    writeFileSync(join(home, "large.json"), `"${"x".repeat(4_000_000)}"`);
    writeFileSync(join(home, "dataset.json"), `"${"x".repeat(2_000_000)}"`);
    expect(() => prepared({ ...large, answer: { from_file: "dataset.json" } })).not.toThrow();
    for (const [path, refusal] of [
      ["../outside.json", "outside your home"],
      [join(outside, "task.json"), "outside your home"],
      ["linked.json", "links outside your home"],
      ["absent.json", "no such file"],
      ["folder.json", "not a regular file"],
      ["large.json", "over the 4000000-byte limit"],
      ["broken.json", "not valid JSON"],
    ] as const) {
      expect(() => prepared({ ...large, answer: { from_file: path } })).toThrow(refusal);
    }
    expect(() => prepared({ ...large, answer: { from_file: "task.json" } }, null)).toThrow("no home");
    expect(trying().description).toContain("from_file");
    expect(trying(null).description).not.toContain("from_file");
  });
});
