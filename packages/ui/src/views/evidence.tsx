import { useEffect, useState } from "react";
import { Callout, Section } from "../components/layout.js";
import { Badge, Button, DataTable } from "../components/primitives.js";
import { EVIDENCE_PAGE_SIZE, type RunView } from "../models.js";
import { Filters, Search, Select } from "./controls.js";
import { bytes, evidenceLabel, time } from "./format.js";
import { poll } from "../poll.js";
import { bool, number, object, text } from "../server/json.js";

/** Validate the fields the browser displays; the server owns file access and category selection. */
export function parseEvidencePage(value: unknown) {
  const page = object(value);
  const offset = number(page?.offset);
  const hasMore = bool(page?.hasMore);
  if (
    !Array.isArray(page?.files) ||
    offset === null ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    hasMore === null
  ) {
    throw new Error("File list response has an invalid page shape.");
  }
  const files = page.files.map((entry) => {
    const file = object(entry);
    const path = text(file?.path);
    const category = text(file?.category);
    const content = text(file?.content);
    const modifiedAt = text(file?.modifiedAt);
    const size = number(file?.bytes);
    const protectedFile = bool(file?.protected);
    if (
      path === null ||
      category === null ||
      content === null ||
      modifiedAt === null ||
      size === null ||
      size < 0 ||
      protectedFile === null
    ) {
      throw new Error("File list response has an invalid file row.");
    }
    return { path, category, content, modifiedAt, bytes: size, protected: protectedFile };
  });
  return { files, offset, hasMore };
}

export function EvidenceView({
  run,
  selectedPath,
  onOpen,
}: {
  run: RunView;
  selectedPath: string | null;
  onOpen: (path: string) => void;
}) {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<ReturnType<typeof parseEvidencePage> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    let stop: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      stop = poll(async () => {
        const params = new URLSearchParams({
          project: run.projectId,
          run: run.title,
          offset: String(offset),
          q: query,
          category,
        });
        await fetch(`/api/evidence?${params}`, {
          cache: "no-store",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]),
        })
          .then(async (response) => {
            if (!response.ok) throw new Error(`File list unavailable (HTTP ${response.status}).`);
            const value = parseEvidencePage(await response.json());
            if (!abort.signal.aborted) {
              setPage(value);
              setError(null);
            }
          })
          .catch((cause: unknown) => {
            if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
          })
          .finally(() => {
            if (!abort.signal.aborted) setLoading(false);
          });
      }, 5_000);
    }, 200);
    return () => {
      window.clearTimeout(timer);
      stop?.();
      abort.abort();
    };
  }, [run.projectId, run.title, offset, query, category, revision]);
  const unloaded = loading ? "Loading files…" : "No files";
  const pager = (
    <div className="ana-file-pagination">
      <span aria-live="polite">
        {page === null
          ? unloaded
          : page.files.length > 0
            ? `${page.offset + 1}–${page.offset + page.files.length}`
            : "No files"}
      </span>
      <Button
        disabled={loading || offset === 0}
        onClick={() => setOffset(Math.max(0, offset - EVIDENCE_PAGE_SIZE))}
      >
        Previous
      </Button>
      <Button
        disabled={loading || page?.hasMore !== true}
        onClick={() => setOffset(offset + EVIDENCE_PAGE_SIZE)}
      >
        Next
      </Button>
    </div>
  );
  return (
    <Section
      title="Run files"
      aside={
        <Button onClick={() => setRevision(revision + 1)} disabled={loading}>
          Refresh files
        </Button>
      }
    >
      <Filters>
        <Search
          value={query}
          onChange={(value) => {
            setQuery(value);
            setOffset(0);
          }}
          placeholder="Search all files"
        />
        <Select
          label="Category"
          value={category}
          onChange={(value) => {
            setCategory(value);
            setOffset(0);
          }}
          values={[
            "all",
            "observation",
            "iteration",
            "gate",
            "case",
            "trace",
            "judge",
            "claim",
            "analysis",
            "promotion",
            "harness",
            "log",
            "other",
          ]}
        />
      </Filters>
      {pager}
      {error === null ? null : (
        <Callout tone="bad">
          {error} {page === null ? "" : "Showing the previous file list."}
        </Callout>
      )}
      <div aria-busy={loading}>
        <DataTable>
          <thead>
            <tr>
              <th>path</th>
              <th>kind</th>
              <th>size</th>
              <th>updated</th>
              <th>access</th>
            </tr>
          </thead>
          <tbody>
            {page?.files.map((file) => (
              <tr key={file.path} className={selectedPath === file.path ? "is-selected" : ""}>
                <td>
                  <button
                    type="button"
                    className="ana-evidence-link"
                    title={file.path}
                    onClick={() => onOpen(file.path)}
                  >
                    {evidenceLabel(file.path)}
                  </button>
                </td>
                <td>
                  {file.category} · {file.content}
                </td>
                <td className="ana-num">{bytes(file.bytes)}</td>
                <td>{time(file.modifiedAt)}</td>
                <td>
                  <Badge tone={file.protected ? "warn" : "good"}>
                    {file.protected ? "protected" : "public evidence"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>
      {page !== null && page.files.length > 20 ? pager : null}
    </Section>
  );
}
