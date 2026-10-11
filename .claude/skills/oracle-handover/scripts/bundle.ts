#!/usr/bin/env bun
/**
 * Close an Oracle bundle: scan it, zip it, test the zip, and say its size.
 *
 *   bun .claude/skills/oracle-handover/scripts/bundle.ts <bundle folder> [--max-mb 20]
 *
 * The folder must hold `REVIEW.md`, the task document, at its root. Every file in it that is not
 * itself a zip is put to the repository's secret rules (`tools/secrets/rules.ts`), and a hit
 * refuses the bundle: a note or a patch copied in by hand is where a credential would ride. The
 * runs zip inside was made by `bun run runs zip`, which leaves out a file named like a secret. The
 * zip lands beside the folder under its name, with no resource-fork sidecar.
 */
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from "#src/meta/filesystem.ts";
import { basename, dirname, join, relative, resolve } from "#src/meta/path.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { scanText } from "#tools/secrets/rules.ts";

const DEFAULT_MAX_MB = 20;
const MB = 1024 * 1024;

/** Every file under `dir`, links left where they are. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isDirectory()) return filesUnder(path);
    return stat.isFile() ? [path] : [];
  });
}

/** Zip bundle folder `dir` beside itself and return what was made. Refuses a folder with no task
 *  document, one that holds a credential-shaped line, and a zip over `maxBytes`. */
export function bundle(dir: string, maxBytes: number) {
  if (!existsSync(join(dir, "REVIEW.md"))) {
    throw new CommandFailure(`${dir} holds no REVIEW.md: the task document goes at the root`);
  }
  const files = filesUnder(dir);
  const hits = files
    .filter((file) => !file.endsWith(".zip"))
    .flatMap((file) => scanText(relative(dir, file), readFileSync(file, "utf8")));
  if (hits.length > 0) {
    const shown = hits.map((hit) => `  ${hit.path}:${String(hit.line)} ${hit.what}`);
    throw new CommandFailure(`a credential-shaped line, so nothing was zipped:\n${shown.join("\n")}`);
  }
  const out = `${dir}.zip`;
  // `zip` adds to an archive that is already there.
  rmSync(out, { force: true });
  runTextSyncOrThrow(["zip", "-qr", "-X", out, basename(dir)], { cwd: dirname(dir) });
  runTextSyncOrThrow(["unzip", "-tq", out]);
  const bytes = lstatSync(out).size;
  if (bytes > maxBytes) {
    rmSync(out);
    throw new CommandFailure(
      `${out} would be ${(bytes / MB).toFixed(1)} MB, over its ${(maxBytes / MB).toFixed(0)}: zip fewer runs or a lighter level`,
    );
  }
  return { out, bytes, files: files.length };
}

if (import.meta.main) {
  await runCommand(
    {
      name: "bundle",
      usage: "bundle.ts <bundle folder> [--max-mb 20]",
      options: { "max-mb": "int" },
      positionals: 1,
    },
    (args: CommandArgs) => {
      const made = bundle(resolve(args.positionals[0] ?? ""), (args.int("max-mb") ?? DEFAULT_MAX_MB) * MB);
      console.log(`${made.out}  ${(made.bytes / MB).toFixed(1)} MB  ${String(made.files)} files`);
    },
  );
}
