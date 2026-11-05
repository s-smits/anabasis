/**
 * One profession's experience library: the harness each earlier task of that profession adopted,
 * whole, with why it was adopted and the lesson its experience session wrote
 * (`harness2/core/library.py`, Apache-2.0, Google LLC, at 1cfe254). A profession's directory only
 * ever holds that profession's entries, so retrieval is by construction, and a task reads only the
 * entries of tasks before it in the stream.
 *
 * Local change: the verdict tripwire on an entry reads the experience's values and the reason as
 * they are, instead of Python's `str(dict)` of them, so an escaped quote in a repr cannot hide a
 * marker.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { pyLen, pyStrip, splitLines, walkFiles } from "./py.ts";
import { treeHasNoGraderVerdicts } from "./context.ts";
import { alwaysOn, readTree, writeTree, type Tree } from "./tree.ts";

/** The file an entry's lesson lives in, and the improver's sign that a library holds one. */
const LESSON_FILE = "EXPERIENCE.md";

/** The lesson an experience session wrote, with `edits` when it wrote edit rows. */
export type Experience = Readonly<
  Partial<Record<"cue" | "lesson" | "evidence" | "confidence" | "edits", string>>
>;

/** `has_experience`: a lesson counts only with its cue, lesson and evidence. */
export function hasExperience(experience: Experience): boolean {
  return [experience.cue, experience.lesson, experience.evidence].every(
    (value) => pyStrip(value ?? "") !== "",
  );
}

/** `_inventory`: a one-line census of the components in a harness. */
function inventory(tree: Tree): string {
  const counts = { skills: 0, sub_agents: 0, scripts: 0, hooks: 0 };
  for (const rel of tree.keys()) {
    if (rel.startsWith(".claude/skills/") && rel.endsWith("SKILL.md")) counts.skills += 1;
    else if (rel.startsWith("sub_agents/")) counts.sub_agents += 1;
    else if (rel.startsWith("scripts/")) counts.scripts += 1;
    else if (rel === ".claude/hooks.json") counts.hooks += 1;
  }
  const bits = Object.entries(counts).flatMap(([kind, n]) => (n > 0 ? [`${n} ${kind}`] : []));
  const chars = String(pyLen(alwaysOn(tree))).replaceAll(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `${(bits.length > 0 ? bits : ["always-on edits only"]).join(", ")}; ${chars} always-on chars`;
}

/** `_field`: the value of one `- **name**:` line of an EXPERIENCE.md. */
function field(path: string, name: string): string {
  if (!existsSync(path)) return "";
  const line = splitLines(readFileSync(path, "utf8")).find((row) => row.startsWith(`- **${name}**:`));
  return line === undefined ? "" : pyStrip(line.slice(line.indexOf(":") + 1));
}

/** `Library`: one (run, profession) library, read before each task and added to after it. */
export class Library {
  readonly dir: string;
  readonly domain: string;

  constructor(root: string, domain: string) {
    this.domain = domain;
    // `domain_dir`: one directory name for a profession, separators and their spaces collapsed.
    this.dir = join(root, pyStrip(domain.replaceAll(/\s*[/\\]\s*/gu, "__")) || "unknown");
  }

  /** `context_dir`: the directory an improver reads, or null while the profession has no lesson. */
  contextDir(): string | null {
    const lessons = walkFiles(this.dir).some((rel) => rel.split("/").at(-1) === LESSON_FILE);
    return existsSync(join(this.dir, "INDEX.md")) && lessons ? this.dir : null;
  }

  entries(): string[] {
    const dir = join(this.dir, "harnesses");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => statSync(join(dir, name)).isDirectory())
      .toSorted();
  }

  /** `retain`: keep only the entries of the tasks before the current one in this stream. */
  retain(tasks: readonly string[]): void {
    const keep = new Set(tasks.map((task) => task.replaceAll("/", "__")));
    const drop = this.entries().filter((entry) => !keep.has(entry));
    for (const entry of drop) rmSync(join(this.dir, "harnesses", entry), { recursive: true, force: true });
    if (drop.length > 0) this.rebuildIndex();
  }

  /** `add`: keep one adopted harness with why it was adopted, then rebuild the index. */
  add(
    task: string,
    harness: Tree,
    adoption: { why: string; label: string; runId: string; experience: Experience },
  ): void {
    const { why, label, runId, experience } = adoption;
    if (!hasExperience(experience)) return;
    treeHasNoGraderVerdicts(harness);
    treeHasNoGraderVerdicts(new Map([[LESSON_FILE, [...Object.values(experience), why].join("\n")]]));
    const dir = join(this.dir, "harnesses", task.replaceAll("/", "__"));
    rmSync(join(dir, "harness"), { recursive: true, force: true });
    writeTree(harness, join(dir, "harness"), "bare");
    const lines = [
      `# ${task}`,
      "",
      `- adopted: \`${label}\`${runId === "" ? "" : `  (run \`${runId}\`)`}`,
      `- components: ${inventory(harness)}`,
      "",
    ];
    if (pyStrip(why) !== "") {
      lines.push("## Why this was chosen", pyStrip(why), "");
    }
    if ((experience.edits ?? "") !== "") {
      lines.push("## What each edit did", pyStrip(experience.edits ?? ""), "");
    }
    if ((experience.lesson ?? "") !== "") {
      lines.push("## Transferable lesson");
      for (const key of ["cue", "lesson", "evidence", "confidence"] as const) {
        const value = experience[key] ?? "";
        if (value !== "") lines.push(`- **${key}**: ${pyStrip(value)}`);
      }
      lines.push("");
    }
    writeFileSync(join(dir, LESSON_FILE), lines.join("\n"));
    this.rebuildIndex();
  }

  /** `rebuild_index`: INDEX.md from what is on disk. */
  rebuildIndex(): void {
    const rows = [
      `# Library — ${this.domain}`,
      "",
      "Each entry is an earlier task in THIS domain whose harness was chosen, stored with its FULL component tree and why it was picked. Browse this index, then open the entries that look relevant to the matter in front of you.",
      "",
    ];
    const names = this.entries();
    if (names.length === 0) rows.push("_(empty — this is the first task in this domain)_");
    for (const name of names) {
      const entry = join(this.dir, "harnesses", name);
      const cue = field(join(entry, LESSON_FILE), "cue");
      rows.push(
        `## \`harnesses/${name}/\``,
        `- harness: \`harnesses/${name}/harness/\` — ${inventory(readTree(join(entry, "harness")))}`,
        `- why:     \`harnesses/${name}/EXPERIENCE.md\``,
      );
      if (cue !== "") rows.push(`- cue:     ${cue}`);
      rows.push("");
    }
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, "INDEX.md"), rows.join("\n"));
  }
}
