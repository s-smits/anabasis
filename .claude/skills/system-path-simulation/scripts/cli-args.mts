import { isAbsolute, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";

export interface CliOptionSpec {
  values?: readonly string[];
  repeatable?: readonly string[];
  flags?: readonly string[];
}

export interface ParsedCliArgs {
  single: ReadonlyMap<string, string>;
  repeated: ReadonlyMap<string, readonly string[]>;
  flags: ReadonlySet<string>;
}

/** The script's own name in front of its one-line diagnostic, then the exit code a caller reads.
 *
 * Twelve scripts spelled this out beside their callers, eleven of them byte-identical apart from
 * the prefix, and the twelfth — `show-prompt-surfaces` — had lost the prefix, so its refusals said
 * `--context must be an absolute path` with nothing to say which of the eleven had refused. The
 * prefix is the only thing that ever differed, so it is the only thing a caller supplies:
 *
 *     const die = exitWith("pick-run");
 *
 * The throw after `exit` is unreachable in a real process and is what makes the type `never`
 * without asserting it; a test that stubs `runtimeProcess.exit` reaches it and gets an error
 * rather than a function that quietly returned.
 *
 * `ExitWith` is exported because the annotation at each call site is load-bearing, not decoration.
 * TypeScript narrows control flow through a call that returns `never` only when the callee is a
 * function declaration or a const with an explicit type; an inferred const gets no narrowing, and
 * `const value = single.get("x") ?? die("--x is required")` goes back to `string | undefined`.
 * Dropping the annotation costs sixteen errors in two files and no compile error at the const.
 */
export type ExitWith = (message: string, code?: number) => never;

export class CliArgumentError extends Error {}

/** A small strict parser shared by the simulation helpers. A misspelled identity flag must refuse
 * before a model opens; silently ignoring it changes the measured condition. `--name=value`
 * remains available when a legitimate value begins with `--`. */
export function parseCliArgs(argv: readonly string[], spec: CliOptionSpec): ParsedCliArgs {
  const valueNames = new Set(spec.values ?? []);
  const repeatedNames = new Set(spec.repeatable ?? []);
  const flagNames = new Set(spec.flags ?? []);
  const known = new Set([...valueNames, ...repeatedNames, ...flagNames]);
  const single = new Map<string, string>();
  const repeated = new Map<string, string[]>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (!token.startsWith("--")) {
      throw new CliArgumentError(`unexpected positional argument ${JSON.stringify(token)}`);
    }
    const equalsAt = token.indexOf("=");
    const name = token.slice(2, equalsAt === -1 ? undefined : equalsAt);
    if (!known.has(name)) throw new CliArgumentError(`unknown option ${JSON.stringify(`--${name}`)}`);

    if (flagNames.has(name)) {
      if (equalsAt !== -1) {
        throw new CliArgumentError(`option ${JSON.stringify(`--${name}`)} does not take a value`);
      }
      if (flags.has(name)) {
        throw new CliArgumentError(`option ${JSON.stringify(`--${name}`)} may be passed only once`);
      }
      flags.add(name);
      continue;
    }

    let value: string;
    if (equalsAt === -1) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new CliArgumentError(`option ${JSON.stringify(`--${name}`)} needs a value`);
      }
      value = next;
      index += 1;
    } else {
      value = token.slice(equalsAt + 1);
    }

    if (repeatedNames.has(name)) {
      repeated.set(name, [...(repeated.get(name) ?? []), value]);
    } else {
      if (single.has(name)) {
        throw new CliArgumentError(`option ${JSON.stringify(`--${name}`)} may be passed only once`);
      }
      single.set(name, value);
    }
  }

  return { single, repeated, flags };
}

export function exitWith(script: string): ExitWith {
  return (message: string, code = 2): never => {
    console.error(`${script}: ${message}`);
    runtimeProcess.exit(code);
    throw new Error("process exit returned unexpectedly");
  };
}

/**
 * Parse this process's arguments, refusing through `die` when the parser says they are wrong.
 *
 * Fourteen scripts wrapped `parseCliArgs` themselves, and each one paid for a `let` with an
 * explicit `ReturnType<typeof parseCliArgs>` annotation, a `try`, a re-throw of anything that was
 * not a `CliArgumentError`, and an import of that class:
 *
 *     let parsed: ReturnType<typeof parseCliArgs>;
 *     try {
 *       parsed = parseCliArgs(Bun.argv.slice(2), { values: ["tree"], flags: ["json"] });
 *     } catch (error) {
 *       if (error instanceof CliArgumentError) die(error.message);
 *       throw error;
 *     }
 *
 *     const parsed = parseOrDie(die, { values: ["tree"], flags: ["json"] });
 *
 * The re-throw is the part worth keeping and the part a hand-written copy gets wrong: a parser
 * fault is a defect in this script and has to arrive with its stack, while a bad argument is the
 * caller's and gets one line. Two of the fourteen had collapsed the distinction into
 * `String(error)`, which turns an internal fault into a usage message.
 *
 * `die` is a parameter rather than a script name because every caller already holds one for its
 * own refusals, and two ways to spell the same exit is how the prefixes drifted last time.
 * `argv` defaults to this process's, which is what thirteen of the fourteen pass; `seed-campaign`
 * parses a list it was handed, so it stays a parameter.
 */
export function parseOrDie(
  die: ExitWith,
  spec: CliOptionSpec,
  argv: readonly string[] = Bun.argv.slice(2),
): ParsedCliArgs {
  try {
    return parseCliArgs(argv, spec);
  } catch (error) {
    if (error instanceof CliArgumentError) die(error.message);
    throw error;
  }
}

/**
 * The two refusals every script makes about its own options, bound to that script's `die`.
 *
 * Both are factories for the same reason `exitWith` is one: the refusal needs the script's prefix,
 * and the call sites — twenty for the path check, twenty-three for the presence check — read
 * better without it. `const absolute = absoluteOption(die);` then leaves every
 * `absolute("repo", value)` exactly as it was.
 *
 * Four scripts spelled the path check out and two already disagreed about what it says:
 * `pick-run` refused with `--tree must be an absolute path` while the other three added
 * `, got "…"`. That is the same drift the `die` prefix had, found the same way.
 *
 * `tree/copied-block` does not report these: stripped of the message they are two short
 * statements, under its 64-token floor. They were found by hand while answering the rows above it.
 */
export function absoluteOption(die: ExitWith): (option: string, value: string) => string {
  return (option, value) => {
    if (!isAbsolute(value)) die(`--${option} must be an absolute path, got ${JSON.stringify(value)}`);
    return resolve(value);
  };
}

export function requiredOption(
  die: ExitWith,
  single: ReadonlyMap<string, string>,
): (option: string) => string {
  return (option) => {
    const value = single.get(option);
    if (value === undefined || value === "") die(`--${option} is required`);
    return value;
  };
}
