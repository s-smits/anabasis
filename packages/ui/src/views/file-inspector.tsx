import { RecordView } from "../components/record.js";
import { useEffect, useRef } from "react";
import { Callout } from "../components/layout.js";
import { Badge, Button } from "../components/primitives.js";
import type { FilePayload } from "../models.js";
import { bytes } from "./format.js";
import { isObject, isString } from "../../../../src/meta/json-shape.ts";
import { hasText } from "../../../../src/meta/text.ts";

/** Read-only evidence viewer. Protected verifier material stays hidden until the local operator
 *  opens the file and chooses to reveal it. */
export function FileInspector({
  path,
  payload,
  loading,
  error,
  onClose,
  onReveal,
  expandAll = false,
}: {
  path: string | null;
  payload: FilePayload | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onReveal: () => void;
  expandAll?: boolean;
}) {
  const pane = useRef<HTMLElement>(null);
  const open = path !== null;
  useEffect(() => {
    if (!open) return;
    const origin = document.activeElement;
    pane.current?.focus({ preventScroll: true });
    return () => {
      if (origin instanceof HTMLElement && origin.isConnected && document.activeElement === document.body) {
        origin.focus({ preventScroll: true });
      }
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [open, onClose]);
  if (path === null) return null;
  const withheld = payload?.protected === true && isObject(payload.value) && "withheld" in payload.value;
  return (
    <aside ref={pane} tabIndex={-1} className="ana-inspector" aria-label="Evidence file" aria-busy={loading}>
      <div className="ana-inspector-head">
        <div>
          <span>Evidence file</span>
          <strong>{path}</strong>
        </div>
        <Button onClick={onClose}>Close</Button>
      </div>
      {hasText(error) ? <Callout tone="bad">{error}</Callout> : null}
      {payload ? (
        <>
          <div className="ana-record-meta">
            <Badge tone={payload.protected ? "warn" : "good"}>
              {payload.protected ? "protected" : "public"}
            </Badge>
            <span>{payload.contentType}</span>
            <span>{bytes(payload.bytes)}</span>
            {payload.truncated ? <Badge tone="warn">truncated</Badge> : null}
          </div>
          {withheld ? (
            <Callout tone="warn">
              Protected verifier material is hidden by default. Reveal only if you are acting as the local
              operator.
              <div>
                <Button onClick={onReveal}>Reveal protected content</Button>
              </div>
            </Callout>
          ) : isString(payload.value) ? (
            <pre className="ana-file-content">{payload.value}</pre>
          ) : (
            <RecordView
              key={`${path}:${expandAll}`}
              value={payload.value}
              defaultExpanded={expandAll ? "all" : false}
            />
          )}
        </>
      ) : null}
    </aside>
  );
}
