import type { ProjectBackendSelection, ProjectBackendSlot, ProjectView } from "../models.js";
import { Callout, Section } from "./layout.js";
import { Code } from "./primitives.js";

export function ProjectBackends({
  project,
  saving,
  error,
  onChange,
}: {
  project: ProjectView;
  saving: ProjectBackendSlot | null;
  error: string | null;
  onChange: (slot: ProjectBackendSlot, selection: ProjectBackendSelection) => void;
}) {
  return (
    <Section title="Providers">
      <p className="ana-section-intro">Applies to this project’s next run.</p>
      {project.backends.error === null ? (
        <div className="ana-project-backends">
          {project.backends.slots.map((slot) => (
            <label key={slot.slot}>
              <span>{slot.label}</span>
              <select
                value={slot.selection}
                disabled={saving !== null}
                onChange={(event) =>
                  onChange(
                    slot.slot,
                    /* SAFETY: the option values are the admitted selections this select was rendered from, and the server refuses any other value before it reaches a run. */ event
                      .target.value as ProjectBackendSelection,
                  )
                }
              >
                {slot.choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
              <small>
                {saving === slot.slot ? (
                  "saving…"
                ) : slot.kind === null ? (
                  slot.source
                ) : (
                  <>
                    <Code>
                      {slot.kind}/{slot.model ?? "unresolved"}
                    </Code>
                    {slot.reasoningEffort === null ? "" : ` · ${slot.reasoningEffort}`}
                    {` · ${slot.source}`}
                  </>
                )}
              </small>
            </label>
          ))}
        </div>
      ) : (
        <Callout tone="bad">{project.backends.error}</Callout>
      )}
      {error === null ? null : <Callout tone="bad">{error}</Callout>}
    </Section>
  );
}
