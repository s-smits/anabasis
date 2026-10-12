import { ExamSide } from "../components/exam-side.tsx";
import { Badge } from "../components/primitives.tsx";
import { RecordView } from "../components/record.tsx";
import { type Of, useEvent, useHarness, useHarnessDiff, useHarnessFile } from "../live.ts";
import type { CampaignReading, HarnessDiff, Tier } from "../models.ts";
import type { Navigation } from "../route.ts";
import { AnswerIssues, harnessLabel } from "./drill.tsx";
import { FileInspector } from "./file-inspector.tsx";
import { bytes, time } from "./format.ts";
import { plural } from "../../../../src/meta/text.ts";

/*
 * What the inspector on the right holds, as the route names it (`route.ts`): a file of a kept
 * harness's `agent/` (`harness` and `file`), the diff of two harnesses (`diff` to `harness`), or one
 * raw event (`event`). The Campaign pane opens the first two, the Moves pane a session's harness,
 * and the Log pane the third.
 *
 * Each is read here, and only while the route names it: the diff per file, and the event only on
 * a server in the exam tier, since in the default tier it is refused and its place is the exam
 * side's quiet line, never an error (the brief of 11 October, section 8). An answer to the previous
 * file, diff or event is no answer to the one named now and is shown as loading, and the issues an
 * answer carries, a harness folder missing or refused, a path refused, are shown with it.
 */

/** One line of a unified diff, numbered on the side or sides it stands on. */
interface DiffLine {
  readonly kind: "hunk" | "add" | "remove" | "same" | "note";
  readonly old: number | null;
  readonly fresh: number | null;
  readonly text: string;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;
const SIGNS = { hunk: "", add: "+", remove: "−", same: "", note: "" } as const;
const CHANGE_TONES = { added: "good", removed: "bad", changed: "neutral" } as const;

/** A unified diff's lines from its first hunk on, the file headers before it left out. */
function diffLines(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let [old, fresh] = [0, 0];
  let started = false;
  for (const line of diff.split("\n")) {
    const hunk = HUNK.exec(line);
    if (hunk !== null) {
      started = true;
      [old, fresh] = [Number(hunk[1]), Number(hunk[2])];
      lines.push({ kind: "hunk", old: null, fresh: null, text: line });
      continue;
    }
    if (!started || line === "") continue;
    if (line.startsWith("+")) {
      lines.push({ kind: "add", old: null, fresh, text: line.slice(1) });
      fresh += 1;
    } else if (line.startsWith("-")) {
      lines.push({ kind: "remove", old, fresh: null, text: line.slice(1) });
      old += 1;
    } else if (line.startsWith("\\")) {
      lines.push({ kind: "note", old: null, fresh: null, text: line.slice(1).trim() });
    } else {
      lines.push({ kind: "same", old, fresh, text: line.slice(1) });
      [old, fresh] = [old + 1, fresh + 1];
    }
  }
  return lines;
}

/** A harness's `agent/` files, each a link that opens it in the inspector, and what the server could
 *  not read of them. */
export function HarnessFiles({
  of,
  digest,
  current,
  navigation,
}: {
  of: Of;
  digest: string;
  current: string | null;
  navigation: Navigation;
}) {
  const files = useHarness(of, digest);
  if (files.data === null || !files.current) {
    return <p className="ana-faint">{files.error ?? "Reading the harness's files."}</p>;
  }
  return (
    <>
      <AnswerIssues answer={files.data} />
      <ul className="ana-file-links">
        {files.data.files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              className={`ana-evidence-link ${file.path === current ? "is-current" : ""}`}
              aria-current={file.path === current ? "true" : undefined}
              onClick={() => navigation.push({ harness: digest, file: file.path, diff: null, event: null })}
            >
              {file.path}
            </button>
            <small>{bytes(file.bytes)}</small>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Two harnesses' files compared, one unified diff a changed file, each line signed as well as
 *  tinted so that an addition and a removal read apart without colour. */
export function DiffView({ diff }: { diff: HarnessDiff }) {
  return (
    <div className="ana-diff">
      <p className="ana-faint">{plural(diff.files.length, "file")} changed.</p>
      <AnswerIssues answer={diff} />
      {diff.files.length === 0 ? (
        <p className="ana-exam-side">The two harnesses' agent files are the same.</p>
      ) : null}
      {diff.files.map((file) => {
        const lines = diffLines(file.diff);
        const added = lines.filter((line) => line.kind === "add").length;
        const removed = lines.filter((line) => line.kind === "remove").length;
        return (
          <section key={file.path} className="ana-diff-file" aria-label={`${file.path}, ${file.change}`}>
            <header>
              <code>{file.path}</code>
              <Badge tone={CHANGE_TONES[file.change]}>{file.change}</Badge>
              <span className="ana-num">
                +{added} −{removed}
              </span>
            </header>
            <table className="ana-diff-lines">
              <tbody>
                {lines.map((line, at) => (
                  <tr key={`${String(at)}:${line.kind}`} className={`is-${line.kind}`}>
                    <td className="ana-diff-no">{line.old ?? ""}</td>
                    <td className="ana-diff-no">{line.fresh ?? ""}</td>
                    <td className="ana-diff-sign" aria-label={line.kind === "same" ? undefined : line.kind}>
                      {SIGNS[line.kind]}
                    </td>
                    <td className="ana-diff-text">{line.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

function DiffBody({ of, a, b }: { of: Of; a: string; b: string }) {
  const live = useHarnessDiff(of, a, b);
  if (live.data === null || !live.current) {
    return <p className="ana-faint">{live.error ?? "Reading the diff."}</p>;
  }
  return <DiffView diff={live.data} />;
}

/** One raw event. A page in the default tier knows the server refuses it, and does not ask. */
function EventBody({ campaign, index, tier }: { campaign: string; index: number; tier: Tier }) {
  const live = useEvent(campaign, tier === "exam" ? index : null);
  if (tier === "default" || live.refused === "exam-side") return <ExamSide what="a raw event's payload" />;
  if (live.data === null || !live.current) {
    return <p className="ana-faint">{live.error ?? "Reading the event."}</p>;
  }
  return (
    <>
      <div className="ana-record-meta">
        <span>{live.data.kind}</span>
        <time>{time(live.data.at)}</time>
      </div>
      <AnswerIssues answer={live.data} />
      <RecordView key={index} value={live.data.data} defaultExpanded="all" />
    </>
  );
}

/** The inspector the route opens, or nothing while it names none. */
export function Inspector({
  navigation,
  reading,
}: {
  navigation: Navigation;
  reading: CampaignReading | null;
}) {
  const { route } = navigation;
  const close = () => navigation.push({ file: null, diff: null, event: null });
  const campaign = reading?.row.key ?? null;
  const of: Of = { key: campaign, since: reading?.row.lastEventAt ?? null };
  const harness = harnessLabel(reading, route.harness);
  const file = useHarnessFile(of, route.harness, route.file);
  if (route.file !== null && route.harness !== null) {
    // The previous file's answer stands for nothing under the new path.
    const data = file.current ? file.data : null;
    // A refused path is answered with no value and an issue that says why: the issue, not an empty file.
    const refused = data?.value === null && data.issues.length > 0;
    return (
      <FileInspector
        label="Harness file"
        path={`${harness} / ${route.file}`}
        payload={
          data === null || refused
            ? null
            : { content: data.content, value: data.value, truncated: data.truncated, bytes: data.bytes }
        }
        loading={file.loading || !file.current}
        error={file.error}
        onClose={close}
      >
        {data === null ? null : <AnswerIssues answer={data} />}
        {campaign === null ? null : (
          <HarnessFiles of={of} digest={route.harness} current={route.file} navigation={navigation} />
        )}
      </FileInspector>
    );
  }
  if (route.diff !== null && route.harness !== null) {
    return (
      <FileInspector
        label="Harness diff"
        path={`${harnessLabel(reading, route.diff)} to ${harness}`}
        payload={null}
        loading={false}
        error={null}
        onClose={close}
      >
        {campaign === null ? null : <DiffBody of={of} a={route.diff} b={route.harness} />}
      </FileInspector>
    );
  }
  if (route.event === null) return null;
  return (
    <FileInspector
      label="Event"
      path={`#${String(route.event)}`}
      payload={null}
      loading={false}
      error={null}
      onClose={close}
      expandAll
    >
      {campaign === null ? null : (
        <EventBody campaign={campaign} index={route.event} tier={reading?.tier ?? "default"} />
      )}
    </FileInspector>
  );
}
