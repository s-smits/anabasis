import { useState } from "react";
import {
  asRecord,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  type JsonObject,
} from "../../../../src/meta/json-shape.ts";

function label(key: string) {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function itemLabel(index: string, value: JsonObject | readonly unknown[]): string {
  const toolName = asRecord(value)?.toolName;
  if (isString(toolName)) return `${Number(index) + 1}. ${toolName}`;
  const first = Array.isArray(value) ? undefined : Object.entries(value)[0];
  if (first && (isString(first[1]) || isNumber(first[1]) || isBoolean(first[1]))) {
    return `${label(first[0])}: ${String(first[1])}`;
  }
  return `Item ${Number(index) + 1}`;
}

function Group({
  value,
  defaultExpanded,
}: {
  value: JsonObject | readonly unknown[];
  defaultExpanded: boolean | "all";
}) {
  const [open, setOpen] = useState(Boolean(defaultExpanded));
  const count = Object.keys(value).length;
  if (count === 0) {
    return <span className="ana-record-empty">0 {Array.isArray(value) ? "items" : "fields"}</span>;
  }
  return (
    <details className="ana-record-group" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <small>
          {count} {Array.isArray(value) ? "items" : "fields"}
        </small>
      </summary>
      {open ? <RecordView value={value} defaultExpanded={defaultExpanded === "all" ? "all" : false} /> : null}
    </details>
  );
}

/** Evidence expands on demand; task inputs can open their first level. Large lists remain paged. */
export function RecordView({
  value,
  defaultExpanded = false,
}: {
  value: unknown;
  defaultExpanded?: boolean | "all";
}) {
  const [page, setPage] = useState(0);
  if (value === null || value === undefined) return <span className="ana-note">Not recorded</span>;
  const group = Array.isArray(value) ? value : asRecord(value);
  if (group === null) {
    // A leaf. `String(value)` would render anything the three guards miss as `[object Object]`;
    // JSON does render it, and a number reads the same either way.
    const shown = value === true ? "Yes" : "No";
    const leaf = isString(value) ? value : isBoolean(value) ? shown : JSON.stringify(value);
    return <span className="ana-record-value">{leaf}</span>;
  }
  const entries = Object.entries(group);
  if (entries.length === 0) return <span className="ana-note">None</span>;
  const start = Math.min(page * 100, Math.floor((entries.length - 1) / 100) * 100);
  return (
    <div className={`ana-record${defaultExpanded === true ? " ana-record-input" : ""}`}>
      <dl>
        {entries.slice(start, start + 100).map(([key, item]) => (
          <div key={key} className="ana-record-field">
            {Array.isArray(item) || isRecord(item) ? (
              <>
                <dt>{Array.isArray(group) ? itemLabel(key, item) : label(key)}</dt>
                <dd>
                  <Group
                    value={item}
                    defaultExpanded={
                      defaultExpanded === "all" ? "all" : defaultExpanded && Array.isArray(item)
                    }
                  />
                </dd>
              </>
            ) : (
              <>
                <dt>{label(key)}</dt>
                <dd>
                  <RecordView value={item} />
                </dd>
              </>
            )}
          </div>
        ))}
      </dl>
      {entries.length > 100 ? (
        <div className="ana-record-pages">
          <button
            type="button"
            className="ana-button"
            disabled={start === 0}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span>
            {start + 1}–{Math.min(start + 100, entries.length)} of {entries.length}
          </span>
          <button
            type="button"
            className="ana-button"
            disabled={start + 100 >= entries.length}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
