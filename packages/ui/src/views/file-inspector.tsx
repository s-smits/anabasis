import { RecordView } from "../components/record.tsx";
import { type KeyboardEvent, type ReactNode, useCallback, useRef } from "react";
import { Callout } from "../components/layout.tsx";
import { Badge, Button } from "../components/primitives.tsx";
import type { FileContent } from "../models.ts";
import { bytes } from "./format.ts";
import { isString, type JsonValue } from "../../../../src/meta/json-shape.ts";
import { hasText } from "../../../../src/meta/text.ts";

interface InspectorPayload {
  readonly content: FileContent;
  readonly value: JsonValue;
  readonly truncated: boolean;
  readonly bytes: number | null;
}

/** The read-only inspector's frame: its head, the way out by button or Escape, and the focus it
 *  takes and gives back; what it holds is `inspector.tsx`'s. The pane takes focus as it attaches
 *  and returns it as it detaches, through its ref, rather than in an effect, which StrictMode runs
 *  twice so the second run would take the pane for the origin. */
export function FileInspector({
  label,
  path,
  payload,
  loading,
  error,
  onClose,
  children,
}: {
  label: string;
  path: string;
  payload: InspectorPayload | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  /** What the inspector shows above the payload, or in its place: a harness's file list, a diff, an
   *  event, or the line that says the exam side holds it. */
  children?: ReactNode;
}) {
  const origin = useRef<Element | null>(null);
  // Stable, so the pane attaches once while it stays open, not on each render; at its detach the pane
  // is still in the page, focused or holding focus.
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
            <RecordView key={path} value={payload.value} />
          )}
        </>
      )}
    </aside>
  );
}
