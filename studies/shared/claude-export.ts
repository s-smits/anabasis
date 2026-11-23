/**
 * Exports an Anabasis Built Harness into a clean Claude Code tree (`CLAUDE.md`, `.claude/`,
 * `scripts/toolchain/`) for benchmark scoring under `claude -p`.
 *
 *   bun studies/shared/claude-export.ts --from <starter | campaign> [--harness <kept>] --into <tree>
 *
 * Transformations are strictly deterministic and benchmark-blind:
 * - `.toolchain/` moves to `scripts/toolchain/`, rebuilt for the target platform when needed, and
 *   wired onto PATH (behind system programs) via `.claude/hooks.json`'s `SessionStart` hook.
 * - Host-only executables whose usage requires Anabasis's `answer.json` / `task.json` / `input.json`
 *   without accepting general file arguments are omitted from `CLAUDE.md` and recorded in
 *   `export.json` under `hostOnlyPrograms`.
 * - Anabasis-only guide mechanics (`## Host-only`, exam validity/bookkeeping sections, turn-budget
 *   urgency lines, `public/resources/` skip clauses, and `answer.json`/`submit` steps) are stripped.
 * - Large specialist reference sections (>2,000 chars) move out of always-on `CLAUDE.md` into
 *   on-demand `.claude/skills/<slug>/SKILL.md` with a one-line trigger in `CLAUDE.md`.
 */
import { existsSync, lstatSync, mkdirSync, renameSync, writeFileSync } from "#src/meta/filesystem.ts";
import { GENERATED_TOOLS_FILE, TOOLS_SPEC_FILE } from "#src/meta/bundle-layout.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { tmpdir } from "#src/meta/os.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { dirname, join, relative } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { keyIfNotNull } from "#src/meta/optional-key.ts";
import { openHarness } from "#src/harness/open.ts";
import { type Program, programsOf } from "#src/harness/programs.ts";
import { HOST_ONLY } from "#src/harness/starter.ts";
import { toolTreeSearchDirs } from "#src/wall/isolation.ts";
import { type Place, placeOf } from "#src/harness/place.ts";
import { HARNESS_DIR, HERE, placeHarness, sourceNamed } from "./bundle.ts";
import { packageFolders, type PythonFor, rebuildForeignPython, uvPython } from "./foreign-python.ts";

interface Section {
  readonly heading: string;
  readonly body: string;
}

interface ExportedSkill {
  readonly slug: string;
  readonly heading: string;
  readonly description: string;
  readonly body: string;
}

interface GuideInputs {
  readonly preamble: string;
  readonly sections: readonly Section[];
  readonly skills: readonly ExportedSkill[];
  readonly programs: readonly Program[];
  readonly searched: readonly string[];
  readonly packages: readonly string[];
}

/** Where the tool tree lands in the exported tree, under the runner's `scripts/` entry. */
export const TOOLCHAIN = "scripts/toolchain";

/** The tree's hooks, which a rollout's installer copies into the settings Claude Code reads. */
const HOOKS = ".claude/hooks.json";

/** The harness's files Claude Code has no reader for. */
const DROPPED = [TOOLS_SPEC_FILE, GENERATED_TOOLS_FILE];

/** Minimum body length (chars) before a non-core reference section moves to an on-demand skill. */
const SKILL_OFFLOAD_CHARS = 2000;

const INTERPRETER_RE = /^(?:python|pip)[\d.]*$/u;
const HOST_FILE_RE =
  /\b(?:answer\.json|input\.json|public\/task\.json|public\/answer-format\.json|task\.json)\b|\bdeliverables\//u;
const GENERAL_ARG_RE =
  /<(?:file|dump|script|csv|data|input|path|dir|table|spells|census)|\.(?:csv|sql|py|tsv|xlsx|parquet)\b|\|/iu;
const HOST_SECTION_RE =
  /^(?:host-only|validity\b|bookkeeping\b|submission\b|answer\s+format\b|exam\s+rules?\b)/iu;
const CORE_SECTION_RE = /^(?:programs?\b|tools?\b|working\b|workflow\b|how\s+to\b|method\b)/iu;
const HEADING_NOISE_RE = /\s*\([^)]*(?:\bturns?\b|\bobjective\b|\brules?\s+R\d)[^)]*\)/giu;
const TURN_URGENCY_RE =
  /\b(?:\d+\s*[-–]\s*\d+\s+turns?|\d+\s+model\s+turns?|20\s+turns?\s+and\s+30\s+minutes|turn\s+(?:budget|limit|cap|target))\b/iu;
const SKIP_RESOURCES_RE = /\s*\([^)]*public\/resources\/[^)]*\)/giu;
const STEP_HOST_OPENER_RE =
  /^(\d+\.\s+)(?:one\s+command:\s*)?`[^`]*(?:public\/task\.json|public\/answer-format\.json|answer\.json)[^`]*`(?:\s*\([^)]*\))?[\s,;:.]*(?:then\s+)?/iu;
const HOST_STEP_RE =
  /\b(?:write\s+answer\.json|deliver\s+them\s+in\s+answer\.json|then\s+submit|call\s+submit|public\/answer-format\.json|rules\s+R\d|replaces\s+reading\s+task\.json|answer\s+format\s+and\s+rules)\b|\bpublic\/resources\//iu;

/** Counts the top-level modules of the folders it is given that import, and names those that do not. */
const IMPORTS = `import importlib, pkgutil, sys
names = sorted({m.name for m in pkgutil.iter_modules(sys.argv[1:]) if not m.name.startswith("_")})
bad = []
for name in names:
    try: importlib.import_module(name)
    except BaseException: bad.append(name)
print("IMPORTS", sys.version.split()[0], len(names) - len(bad), len(names), *bad[:5])`;

const escapeRegExp = (name: string): string => name.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/** First line of a program's account, dropping any `|` alternative branch that requires Anabasis host files. */
function usageLine(account: string | null): string | null {
  if (account === null) return null;
  const first = (account.split("\n")[0] ?? "").trim();
  if (first === "") return null;
  const parts = first
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part !== "" && !HOST_FILE_RE.test(part));
  const kept = parts.length > 0 ? parts.join(" | ") : first;
  return kept.replaceAll("public/files/", "");
}

/** Whether a program's first usage line requires Anabasis host files with no plain-file mode. */
function isHostOnlyProgram(program: Program): boolean {
  if (program.account === null) return false;
  const first = (program.account.split("\n")[0] ?? "").trim();
  const lead = /^[a-z0-9][a-z0-9_-]*/iu.exec(first)?.[0];
  if (lead !== undefined && lead !== program.name && !first.includes(program.name)) return false;
  return HOST_FILE_RE.test(first) && !GENERAL_ARG_RE.test(first);
}

/** Non-interpreter programs of an exported tree that accept ordinary inputs outside Anabasis. */
export const exportedPrograms = (tree: string): Program[] =>
  programsOf(join(tree, TOOLCHAIN)).filter(
    (program) => !INTERPRETER_RE.test(program.name) && !isHostOnlyProgram(program),
  );

/** Splits a section body into logical Markdown blocks (list items with continuations, or paragraphs). */
function splitBlocks(body: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) {
      blocks.push(current.join("\n").trimEnd());
      current = [];
    }
  };
  for (const line of body.split("\n")) {
    if (line.trim() === "") {
      flush();
    } else if (/^(?:[-*]|\d+\.)\s/u.test(line)) {
      flush();
      current.push(line);
    } else {
      current.push(line);
    }
  }
  flush();
  return blocks;
}

/** Strips a leading host-only command from a numbered workflow step when general instructions follow it. */
function stripStepOpener(block: string, dropped: readonly string[]): string {
  let out = block.replace(SKIP_RESOURCES_RE, "");
  const generic = STEP_HOST_OPENER_RE.exec(out);
  if (generic !== null) {
    const rest = out.slice(generic[0].length).trimStart();
    out = rest === "" ? "" : `${generic[1] ?? ""}${rest[0]?.toUpperCase() ?? ""}${rest.slice(1)}`;
  }
  for (const name of dropped) {
    const match = new RegExp(
      `^(\\d+\\.\\s+)\`${escapeRegExp(name)}[^\`]*\`[\\s,;:.]*(?:then\\s+)?`,
      "iu",
    ).exec(out);
    if (match !== null) {
      const rest = out.slice(match[0].length).trimStart();
      if (rest !== "" && !/\b(?:FAIL|ERROR|submit|answer\.json)\b/u.test(rest)) {
        out = `${match[1] ?? ""}${rest[0]?.toUpperCase() ?? ""}${rest.slice(1)}`;
      }
    }
  }
  return out;
}

/** Whether a block documents a dropped host-only program or is pure Anabasis submission/turn prose. */
function isHostOnlyBlock(block: string, dropped: readonly string[]): boolean {
  const compact = block.replaceAll(/\s+/gu, " ").trim();
  if (compact.length <= 140 && TURN_URGENCY_RE.test(compact)) return true;
  if (
    dropped.some((name) => new RegExp(`^(?:[-*]|\\d+\\.)\\s+\`?${escapeRegExp(name)}\\b`, "u").test(compact))
  ) {
    return true;
  }
  const hasDropped = dropped.some((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`, "u").test(compact));
  if (hasDropped && /\b(?:answer\.json|submit|FAIL|ERROR|R\d|manifest)\b/u.test(compact)) return true;
  return HOST_STEP_RE.test(compact);
}

/** Strips residual Anabasis-only clauses from a surviving block while preserving domain methodology. */
function cleanBlock(block: string, dropped: readonly string[]): string {
  const unwrapped = stripStepOpener(block, dropped);
  if (unwrapped === "" || isHostOnlyBlock(unwrapped, dropped)) return "";
  return unwrapped
    .replaceAll(/--task\s+public\/task\.json/gu, "<file>...")
    .replaceAll("public/files/", "")
    .replaceAll(/\s+and\s+the\s+TOTAL\s+that\s+`?records_received`?\s+must\s+equal/gu, "")
    .trim();
}

/** Cleans preamble paragraphs of Anabasis `answer.json` / turn-limit sentences while keeping `# ` title. */
function cleanPreamble(raw: string): string {
  const kept: string[] = [];
  for (const block of splitBlocks(raw)) {
    if (block.startsWith("#")) {
      kept.push(block);
    } else if (!TURN_URGENCY_RE.test(block) && !HOST_STEP_RE.test(block)) {
      kept.push(block);
    }
  }
  return kept.join("\n\n").trim();
}

/** Splits a guide into preamble and level-2 sections, dropping `## Host-only` and exam bookkeeping. */
function cleanSections(
  raw: string,
  dropped: readonly string[],
): { readonly preamble: string; readonly sections: Section[] } {
  const [beforeHostOnly = ""] = raw.split(new RegExp(`\\n${HOST_ONLY}\\n`, "iu"));
  const parts = beforeHostOnly.split(/\n(?=## )/u);
  const preamble = cleanPreamble(parts[0] ?? "");
  const sections: Section[] = [];
  for (const part of parts.slice(1)) {
    const newline = part.indexOf("\n");
    const rawHeading = (newline === -1 ? part : part.slice(0, newline)).replace(/^##\s+/u, "").trim();
    const rawBody = newline === -1 ? "" : part.slice(newline + 1);
    if (HOST_SECTION_RE.test(rawHeading)) continue;
    const heading = rawHeading.replace(HEADING_NOISE_RE, "").trim();
    const blocks = splitBlocks(rawBody)
      .map((block) => cleanBlock(block, dropped))
      .filter((block) => block !== "");
    if (blocks.length > 0) sections.push({ heading, body: blocks.join("\n") });
  }
  return { preamble, sections };
}

/** Lowercase hyphen slug suitable for `.claude/skills/<slug>/SKILL.md` (`[a-z0-9][a-z0-9_-]*`). */
function slugOf(heading: string, used: ReadonlySet<string>): string {
  const base =
    heading
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, "-")
      .replaceAll(/^-+|-+$/gu, "")
      .slice(0, 40)
      .replaceAll(/-+$/gu, "") || "reference";
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base.slice(0, 36)}-${String(n)}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Builds a concise, complete YAML description from a section's heading and bullet topics. */
function skillDescription(heading: string, body: string): string {
  const cleanHeading = heading.replaceAll(/["\n]/gu, " ").trim();
  const topics: string[] = [];
  let length = cleanHeading.length + 3;
  for (const block of splitBlocks(body)) {
    const lead = /^[-*]\s+([^:\n]{3,48}):/u.exec(block)?.[1]?.replaceAll(/[`"*]/gu, "").trim();
    if (lead === undefined || topics.includes(lead)) continue;
    const added = (topics.length === 0 ? 0 : 2) + lead.length;
    if (length + added > 175) break;
    topics.push(lead);
    length += added;
    if (topics.length === 5) break;
  }
  return topics.length > 0 ? `${cleanHeading} (${topics.join("; ")})` : cleanHeading;
}

/** Moves large non-core reference sections out of always-on `CLAUDE.md` into on-demand skills. */
function offloadSkills(sections: readonly Section[]): {
  readonly kept: Section[];
  readonly skills: ExportedSkill[];
} {
  const kept: Section[] = [];
  const skills: ExportedSkill[] = [];
  const used = new Set<string>();
  for (const section of sections) {
    if (!CORE_SECTION_RE.test(section.heading) && section.body.length > SKILL_OFFLOAD_CHARS) {
      const slug = slugOf(section.heading, used);
      used.add(slug);
      skills.push({
        slug,
        heading: section.heading,
        description: skillDescription(section.heading, section.body),
        body: section.body,
      });
    } else {
      kept.push(section);
    }
  }
  return { kept, skills };
}

/** Builds the final `CLAUDE.md` text from runtime metadata, cleaned sections, and skill triggers. */
function renderClaudeMd({ preamble, sections, skills, programs, searched, packages }: GuideInputs): string {
  const header = [
    "# Runtime environment",
    "",
    "Follow the task prompt and write all requested deliverables to the specified output directory.",
    ...(programs.length === 0
      ? []
      : [
          "",
          `These harness programs are on your PATH (under ${searched.map((dir) => `\`${dir}\``).join(", ")}, behind system programs) and accept ordinary file arguments:`,
          "",
          ...programs.map(({ name, account }) => {
            const line = usageLine(account);
            return `- ${name}${line === null ? "" : `: ${line}`}`;
          }),
        ]),
    ...(packages.length === 0
      ? []
      : ["", `Additional Python packages and modules live in ${packages.join(", ")}.`]),
    ...(skills.length === 0
      ? []
      : [
          "",
          "## On-demand skills",
          ...skills.map(
            ({ slug, description }) => `- When working on ${description}, use the \`${slug}\` skill.`,
          ),
        ]),
  ].join("\n");
  const body = [
    ...(preamble === "" ? [] : [preamble]),
    ...sections.map(({ heading, body: content }) => `## ${heading}\n${content}`),
  ];
  return `${[header, ...body].join("\n\n").trimEnd()}\n`;
}

/** The tree `into`, written from `source` for programs that run on `place`, the machine that will
 *  roll it: this one unless `--for` names another. Returns what `export.json` records. */
export async function exportForClaudeCode(
  into: string,
  source: "starter" | { readonly campaign: string; readonly harness?: string },
  place: Place = HERE,
  python: PythonFor = uvPython(place),
) {
  if (existsSync(into)) throw new Error(`${into} is there already; an export is made once`);
  const part = `${into}.part-${String(process.pid)}-${String(Date.now())}`;
  mkdirSync(part, { recursive: true });
  const origin = await placeHarness(join(part, HARNESS_DIR), source);
  const harness = await openHarness(join(part, HARNESS_DIR));
  const searched =
    harness.toolTree === null
      ? []
      : toolTreeSearchDirs(harness.toolTree).map((dir) =>
          join(TOOLCHAIN, relative(harness.toolTree ?? "", dir)),
        );
  if (harness.toolTree !== null) {
    mkdirSync(dirname(join(part, TOOLCHAIN)), { recursive: true });
    renameSync(harness.toolTree, join(part, TOOLCHAIN));
  }
  const rebuilt = await rebuildForeignPython(join(part, TOOLCHAIN), place, python);
  if (searched.length > 0) {
    const behind = searched.map((dir) => `$CLAUDE_PROJECT_DIR/${dir}`).join(":");
    const command = `echo "export PATH=\\"\\$PATH:${behind}\\"" >> "$CLAUDE_ENV_FILE"`;
    const hooks = { hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } };
    mkdirSync(dirname(join(part, HOOKS)), { recursive: true });
    writeFileSync(join(part, HOOKS), `${capturedJsonStringify(hooks, null, 2)}\n`);
  }
  const allNonInterpreter =
    harness.toolTree === null
      ? []
      : programsOf(join(part, TOOLCHAIN)).filter((program) => !INTERPRETER_RE.test(program.name));
  const hostOnlyPrograms = allNonInterpreter.filter(isHostOnlyProgram).map(({ name }) => name);
  const programs = allNonInterpreter.filter((program) => !isHostOnlyProgram(program));
  const packages =
    harness.toolTree === null
      ? []
      : (await packageFolders(join(part, TOOLCHAIN))).map(
          ({ site, pythons }) =>
            `\`${join(TOOLCHAIN, site)}\`${pythons.length === 0 ? "" : ` (built for CPython ${pythons.join(" and ")})`}`,
        );
  const cleaned = cleanSections(harness.guide ?? "", hostOnlyPrograms);
  const { kept, skills } = offloadSkills(cleaned.sections);
  for (const skill of skills) {
    const skillDir = join(part, ".claude", "skills", skill.slug);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: ${skill.slug}\ndescription: ${capturedJsonStringify(skill.description)}\n---\n\n# ${skill.heading}\n\n${skill.body}\n`,
    );
  }
  writeFileSync(
    join(part, "CLAUDE.md"),
    renderClaudeMd({ preamble: cleaned.preamble, sections: kept, skills, programs, searched, packages }),
  );
  const record = {
    harness: harness.digest,
    ...origin,
    dropped: DROPPED,
    toolchain: harness.toolTree === null ? null : TOOLCHAIN,
    searched,
    ...keyIfNotNull("hostOnlyPrograms", hostOnlyPrograms.length === 0 ? null : hostOnlyPrograms),
    ...keyIfNotNull("skills", skills.length === 0 ? null : skills.map(({ slug }) => slug)),
    ...keyIfNotNull("rebuilt", rebuilt === null ? null : { for: place.name, ...rebuilt }),
  };
  writeFileSync(join(part, "export.json"), `${capturedJsonStringify(record, null, 2)}\n`);
  renameSync(part, into);
  return record;
}

/**
 * What the exported tree's own `python3` makes of its packages on this machine under `env`, a
 * rollout's environment with the tree's folders behind it as its hook puts them, or null where the
 * tree has no `python3`. Refuses one that cannot start.
 */
export async function ownPython(tree: string, env: Readonly<Record<string, string>>): Promise<string | null> {
  const dirs = toolTreeSearchDirs(join(tree, TOOLCHAIN));
  const python = dirs
    .map((dir) => join(dir, "python3"))
    .find((path) => lstatSync(path, { throwIfNoEntry: false }) !== undefined);
  if (python === undefined) return null;
  const run = (words: readonly string[]) => {
    const ran = runSync([python, "-c", ...words], {
      cwd: tmpdir(),
      env: { ...env, PATH: [env.PATH ?? "", ...dirs].join(":") },
      timeout: 300_000,
    });
    const last = decodeOutput(ran.stderr).trim().split("\n").at(-1) ?? "";
    return {
      out: decodeOutput(ran.stdout),
      why: `exit ${String(ran.exitCode)}: ${last}`,
      ok: ran.exitCode === 0,
    };
  };
  const started = run(["pass"]);
  if (!started.ok) throw new Error(`${relative(tree, python)} cannot start here (${started.why})`);
  const sites = (await packageFolders(join(tree, TOOLCHAIN))).map(({ site }) => join(tree, TOOLCHAIN, site));
  const counted = run([IMPORTS, ...sites]);
  const [, version, ok, of, ...bad] = /^IMPORTS .*$/mu.exec(counted.out)?.[0].split(" ") ?? [];
  if (of === undefined) return `its python3 starts, and the count of its modules ended (${counted.why})`;
  return `its python3 is ${String(version)} and imports ${String(ok)} of ${of} of its modules${bad.length === 0 ? "" : `, not ${bad.join(", ")}`}`;
}

async function main(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      from: { type: "string" },
      harness: { type: "string" },
      into: { type: "string" },
      for: { type: "string" },
    },
  });
  if (values.from === undefined || values.into === undefined) throw new Error("name --from and --into");
  const source = sourceNamed(values.from, values.harness);
  const place = values.for === undefined ? HERE : placeOf(values.for);
  const record = await exportForClaudeCode(values.into, source, place);
  console.log(`export: ${values.into} is harness ${record.harness}, ${capturedJsonStringify(record)}`);
}

if (import.meta.main) await main(Bun.argv.slice(2));
