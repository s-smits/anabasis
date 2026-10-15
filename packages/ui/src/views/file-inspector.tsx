import { RecordView } from "../components/record.tsx";
import { type KeyboardEvent, type ReactNode, useCallback, useRef } from "react";
import { Callout } from "../components/layout.tsx";
import { Badge, Button } from "../components/primitives.tsx";
import type { FileContent } from "../models.ts";
import { bytes } from "./format.ts";
import { isString, type JsonValue } from "../../../../src/meta/json-shape.ts";
import { hasText } from "../../../../src/meta/text.ts";

/** What the inspector shows: a harness file, a diff of two harnesses, or a raw event. */
interface InspectorPayload {
  readonly content: FileContent;
  readonly value: JsonValue;
  readonly truncated: boolean;
  readonly bytes: number | null;
}

/** The read-only inspector on the right. v1 hid protected verifier files behind a reveal button;
 *  v2 keeps the exam side behind the server's tier instead, so what reaches the page may be shown.
 *  This is its frame: the head, the way out by button or Escape, and the focus it takes and gives
 *  back. What it holds is `inspector.tsx`'s to choose.
 *
 *  The pane takes focus as it attaches and gives it back to what held it before as it detaches,
 *  through its ref, and Escape closes it while focus is in it. Until 14 October both were effects:
 *  StrictMode ran the first twice, and the second run took the pane itself for the origin, which
 *  left focus on the page's body at every close (a browser test of that day). */
export function FileInspector({
  label,
  path,
  payload,
  loading,
  error,
  onClose,
  expandAll = false,
  children,
}: {
  /** What is open: "Harness file", "Harness diff", "Event". */
  label: string;
  path: string | null;
  payload: InspectorPayload | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  expandAll?: boolean;
  /** What the inspector shows above the payload, or in its place where there is none: a harness's
   *  file list, a diff, an event, or the line that says the exam side holds it. */
  children?: ReactNode;
}) {
  const origin = useRef<Element | null>(null);
  // Stable, so that the pane attaches once while it stays open, whatever it shows, and not on each
  // render. At its detach the pane is still in the page, focused or holding focus.
  const pane = useCallback((element: HTMLElement) => {
    origin.current = document.activeElement;
    element.focus({ preventScroll: true });
    return () => {
      const back = origin.current;
      const held = element.contains(document.activeElement) || document.activeElement === document.body;
      if (back instanceof HTMLElement && back.isConnected && held) back.focus({ preventScroll: true });
    };
  }, []);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      onClose();
    }
  };
  if (path === null) return null;
  return (
    <aside
      ref={pane}
      tabIndex={-1}
      className="ana-inspector"
      aria-label={label}
      aria-busy={loading}
      onKeyDown={onKeyDown}
    >
      <div className="ana-inspector-head">
        <div>
          <span>{label}</span>
          <strong>{path}</strong>
        </div>
        <Button onClick={onClose}>Close</Button>
      </div>
      {hasText(error) ? <Callout tone="bad">{error}</Callout> : null}
      {children}
      {payload === null ? null : (
        <>
          <div className="ana-record-meta">
            <span>{payload.content}</span>
            {payload.bytes === null ? null : <span>{bytes(payload.bytes)}</span>}
            {payload.truncated ? <Badge tone="warn">truncated</Badge> : null}
          </div>
          {isString(payload.value) ? (
            <pre className="ana-file-content">{payload.value}</pre>
          ) : (
            <RecordView
              key={`${path}:${String(expandAll)}`}
              value={payload.value}
              defaultExpanded={expandAll ? "all" : false}
            />
          )}
        </>
      )}
    </aside>
  );
}
