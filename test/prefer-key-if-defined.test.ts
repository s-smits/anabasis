/**
 * The rule that folds `if (x !== undefined) o.k = x;` back into the literal that built `o`.
 *
 * The positive half is the run: several guards below one literal, a `const` between the literal
 * and the guard that reads it, a `!== null` that picks the other helper, and a cast kept on the
 * value. The negative half is every neighbour that looks the same from a distance: a target that
 * came from a call rather than a literal, a `this.x`, a guard reading the object it would be
 * folded into, a value that is a call, a `const` a later line still reads, a guard whose block
 * carries a comment, and a guard that is not the statement directly below.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, fixedSource, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const RULE = "prefer-key-if-defined";
const GUARDS = `import { existing } from "./elsewhere.ts";

interface Options {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly stdin?: string;
}
interface Spawn {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  code?: string;
  state?: string;
  files?: Record<string, string>;
}
declare const options: Options;
declare const url: URL;
declare function build(): Spawn;
declare function read(): string | undefined;
declare let later: string;

export function run(): Spawn {
  const spawn: Spawn = { cwd: "." }; // REPORT three guards directly below the literal
  if (options.cwd !== undefined) spawn.cwd = options.cwd;
  if (options.env !== undefined) spawn.env = options.env;
  if (options.stdin !== undefined) {
    spawn.stdin = options.stdin;
  }
  return spawn;
}

export function parse(): Spawn {
  const parsed: Spawn = {}; // REPORT the const between is read by its guard alone, and null picks keyIfNotNull
  const code = url.searchParams.get("code");
  if (code !== null) parsed.code = code;
  const state = url.searchParams.get("state");
  if (state !== null) parsed.state = state;
  return parsed;
}

export function cast(): Spawn {
  const request: Spawn = { cwd: "." }; // REPORT the cast on the value travels into the spread
  if (options.env !== undefined) request.env = options.env as Record<string, string>;
  return request;
}

export function built(): Spawn {
  const spawn = build(); // ADMITTED the object came from a call, not a literal
  if (options.cwd !== undefined) spawn.cwd = options.cwd;
  return spawn;
}

export class Holder {
  cwd?: string;
  set(): void {
    if (options.cwd !== undefined) this.cwd = options.cwd; // ADMITTED no literal to fold into
  }
}

export function selfRead(): Spawn {
  const spawn: Spawn = { cwd: "." }; // ADMITTED the guard reads the object it would be folded into
  if (spawn.cwd !== undefined) spawn.stdin = spawn.cwd;
  return spawn;
}

export function called(): Spawn {
  const spawn: Spawn = { cwd: "." }; // ADMITTED a call is evaluated twice here and once in the fold
  if (read() !== undefined) spawn.stdin = read();
  return spawn;
}

export function readAgain(): Spawn {
  const parsed: Spawn = {}; // ADMITTED the const is read again after the guard
  const code = url.searchParams.get("code");
  if (code !== null) parsed.code = code;
  later = code ?? "";
  return parsed;
}

export function commented(): Spawn {
  const spawn: Spawn = { cwd: "." }; // ADMITTED the comment inside the block has nowhere to go
  if (options.env !== undefined) {
    // SAFETY: checked above
    spawn.files = options.env as Record<string, string>;
  }
  return spawn;
}

export function apart(): Spawn {
  const spawn: Spawn = { cwd: "." }; // ADMITTED a statement between the literal and the guard
  existing(spawn);
  if (options.cwd !== undefined) spawn.cwd = options.cwd;
  return spawn;
}
`;

describe("ana/prefer-key-if-defined", () => {
  it("reads a run of guards below a literal and refuses its seven neighbours", () => {
    const expected = expectedLines(GUARDS);
    expect(expected).toHaveLength(3);
    expect(reportedLines("ana", RULE, GUARDS)).toStrictEqual(expected);
  });

  it("folds each guard into the literal as the owner's spread, removes the lines and imports once", () => {
    const fixed = fixedSource("ana", RULE, GUARDS);
    expect(fixed).toContain(
      'const spawn: Spawn = { cwd: ".", ...keyIfDefined("cwd", options.cwd), ...keyIfDefined("env", options.env), ...keyIfDefined("stdin", options.stdin) }; // REPORT',
    );
    expect(fixed).toContain(
      'const parsed: Spawn = { ...keyIfNotNull("code", url.searchParams.get("code")), ...keyIfNotNull("state", url.searchParams.get("state")) }; // REPORT',
    );
    expect(fixed).toContain(
      'const request: Spawn = { cwd: ".", ...keyIfDefined("env", options.env as Record<string, string>) }; // REPORT',
    );
    expect(fixed).toMatch(
      /^import \{ keyIfDefined, keyIfNotNull \} from "[./]+src\/meta\/optional-key\.ts";\nimport \{ existing \}/u,
    );
    // Every folded line is gone, and every admitted one is still there.
    expect(fixed.split("if (options.cwd !== undefined) spawn.cwd = options.cwd;")).toHaveLength(3);
    expect(fixed.split('const code = url.searchParams.get("code");\n  if (code !== null)')).toHaveLength(2);
    expect(fixed).toContain('later = code ?? "";');
  });
});
