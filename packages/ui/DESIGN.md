# Anabasis design principles

The baseline is the Forge dashboard with one main truth chart, strict typography
and evidence discipline. A multi-panel overview is not the visual baseline.

## Composition

Forge opens with the editorial eyebrow and display title, three compact readouts,
and one wide climb chart. Stopped runs show their recorded reason before the metrics; the difficulty decision remains a disclosure below. Provenance and
adoption decisions belong to Evidence.
Every other view answers a distinct technical question. Five plain navigation labels:
Forge, Evals, Tasks, Evidence, Settings. Do not replace this with question-shaped
navigation, a panel wall or several charts competing for the same information.

## Identity

Near-black zinc canvas `#09090b`, neutral white text, cyan `#4cc2ff` for interaction
and the measured series. Green, amber and red describe evidence; no coloured side
rules on cards. Electrolize for titles, Newsreader italic for the one editorial
accent, Manrope for prose, Space Grotesk for tabular figures, true monospace for
identities. Bundle every font. The altimeter rule beneath the hero is the signature.

Use the shared primitives and token layer. The chart retains the original shadcn
ChartContainer/Recharts composition, adapted to the Bun app's shared stylesheet.
Do not introduce a second palette or style components independently.

## Evidence

Show passed / verified beside a score. Keep unaccepted and non-results separate.
A missing score is a gap. A missing date cannot gain an invented position in time.
Break the line when model identity changes or is unavailable. Mark changed task
sets; an increasing pass rate across changed tasks is not proof of improvement.
Difficulty is the recorded controller decision, never a level inferred from a name.

Each fact has one visible owner. Put explanations and raw identities one click away.
Use short labels and facts that change with the run. Show refresh failure honestly;
do not expose reader implementation terms as connection status.

Evidence inventories are paginated by the server, 100 matching files at a time.
Search and category selection apply before paging. Do not transfer or render a whole
run inventory during dashboard refresh.

## User decisions before data

Judge each element by the question it answers or the action it enables. Forge leads
with state, results, progress and blockers. Evals compares measured outcomes. Tasks
supports investigation: selecting a row brings its details into focus. Evidence
holds adoption, reviews and the optional file inspector. Settings names the future
run it affects. Do not promote hashes, storage paths or schema fields into summaries.
Keep exact records accessible for auditing, without making them the primary workflow.

Task selection opens an in-place detail view, with the list hidden rather than pushed above
the details. Back to tasks restores the filtered list and focus to the selected row. Keep the selected subpage when switching projects; commit its selection and loaded
evidence together, updating the existing Forge cards. Keep previous evidence visible while
a new read finishes. Pickers start on the current
selection and support keyboard dismissal. All five navigation actions remain available on
narrow screens; avoid a hidden drawer without a visible way to open it.

Task inputs show collection items and their field counts in one column;
item contents and other field groups stay collapsed. Label tool calls by call number and tool name, and other items by their first scalar key-value pair; use a numbered item when that value is nested or missing. Keep evidence records on demand
and large collections paged.

## Craft guidance from Emil Kowalski

Use [Emil Kowalski's design engineering skills](https://github.com/emilkowalski/skills)
heavily for interaction craft, subordinate to the Anabasis identity and composition above.
The installed `emil-design-eng` skill is the starting point; animation guidance is a
judgement aid, not a requirement to add motion. Keep the existing fonts, palette,
altimeter, cards and five-view structure.

High-frequency navigation, project changes, task inspection and keyboard actions stay
immediate. Never animate refreshed evidence or draw a new chart on each poll. Keep the
previous content until its replacement is ready. Avoid transitions on layout properties
such as sidebar width and page margins: they move the reading surface and trigger layout.

Make controls respond on press, using a restrained scale only for pointer interaction;
keyboard operation stays immediate. Respect reduced motion. Any occasional motion needs
a clear purpose, a short explicit duration, an appropriate origin and interruption without
blocking input. Prefer the platform and existing components over a new animation dependency.

Polish comes from legible hierarchy, nearby controls, reliable focus and scroll restoration,
useful labels, honest empty states and consistent spacing. Test those details in the browser.
Preserve evidence meaning and the operator's established layout when applying these skills.

Use shallow card shadows, one shared table surface and consistent 40px filter controls.
Keep table labels and abbreviated identities intact, with horizontal scrolling when needed.
The project menu may extend beyond the sidebar to show full names, but stays within the
viewport; short screens retain sidebar scrolling. Nested disclosures use the inner radius
and a quieter border. Touch controls keep a minimum 44px target where practical.
