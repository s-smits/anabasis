# Anabasis design principles

The baseline is the Campaign pane with one main truth chart, strict typography
and evidence discipline. A multi-panel overview is not the visual baseline.

## Composition

Four panes, with plain labels, in this order: Campaign, Moves, Tasks, Log. One
drill-down runs through them: campaign, move, solve, then turn and call. The pane
and every selection inside it (move, solve, task, harness, what the inspector shows)
live in the URL, so the back button undoes a selection and any view can be linked.
Do not replace this with question-shaped navigation, a panel wall or several charts
competing for the same information.

The Campaign pane is the main page, top to bottom:

- the campaign's line: the project as the editorial eyebrow, the name as the display
  title, its state and its dollars billed against its total, over the altimeter rule;
- three readouts: the reference harness and its promotions, the last comparison's
  reading as wins, losses and ties, and the decision table's next move with its
  reason, or the ending where the campaign ended;
- one wide chart of the comparisons: one stacked column a comparison, its scored
  tasks by outcome, in counts. A promotion is a divider between columns, with its own
  mark where it was made despite the rule and where it returned to the starter; a
  change of setting is a break; a control is drawn quieter; a repeat is tied to the
  comparison it repeats; the sessions that ran between two comparisons are small marks
  beneath. A comparison with no report stands open at its scored tasks, never at zero.
  A column opens its comparison in Moves;
- the harness strip: every version, starter first, at one size in one row that
  scrolls sideways. The selected card opens in place; left and right move the
  selection; "Compare with previous" opens the diff in the inspector. No scaled,
  half-hidden or animated cards, and no two harnesses' numbers set side by side as if
  measured together: each card's tally names its own comparison;
- two small charts: each side's valid share in each comparison, as two dots, and the
  dollars billed over the moves against the total;
- the counters as one line of plain text.

The page works with no promotion, which is most campaigns. Before the first
comparison the chart's place says what the campaign holds to compare.

Moves lists every session and comparison in order with its handover, its cost and
its duration. Tasks is a grid of task versions against comparisons. Log pages the raw
events. Selecting a row opens an in-place detail view, with the list hidden rather
than pushed above the details; back restores the filtered list and focus to the
selected row. Keep previous evidence visible while a new read finishes. Pickers start
on the current selection and support keyboard dismissal. All four navigation actions
remain available on narrow screens; avoid a hidden drawer without a visible way to
open it.

Judge each element by the question it answers or the action it enables. Do not
promote hashes, storage paths or schema fields into summaries; keep exact records
accessible for auditing, without making them the primary workflow. Inputs show
collection items and their field counts in one column; item contents and other field
groups stay collapsed. Label tool calls by call number and tool name, and other items
by their first scalar key-value pair; use a numbered item when that value is nested or
missing.

## House style

A block has one title and at most one qualifying line. No note above a block and no
caption below it: what explains a number is one click deeper, in a tooltip, a card
that opens, the inspector or the pane a row opens. A chart's legend is its key, not a
caption, and stands with it.

Sizes are tokens. Below a page title every font size is one of the five steps of
`styles.css`, `--ana-text-xs` to `--ana-text-lg`, named for its role as a colour is.
A title keeps its own clamp. A new rule names a step and never a literal size.

Outcome colours are fixed. The six things a scored task comes to are drawn only in
the `--ana-out-*` tokens, in the order and under the labels of `views/outcome.ts`:
won in the accent, lost in the bad tone, the three ties in three zinc tints, lightest
where the reference harness was valid on every solve, and set aside in the warning
tone. No outcome is drawn in another colour, these colours mean nothing else in a
chart, and a label or a count always stands beside the colour.

Use the repository's terms with one meaning each: campaign, comparison, reference
harness, held-out task, practice task, valid answer, rejection, promotion. A "step" is
only a comparison's significant reading, and the units of a campaign's sequence are
moves. v1's words for its sequence have no meaning here.

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

Show the tally beside a reading. Keep rejections, tasks set aside and non-results
separate. A missing reading is a gap. A missing date cannot gain an invented position
in time. Break the sequence when the setting changes or is unavailable. The scored
tasks change between comparisons; never join two comparisons' counts by a line, and
more wins across changed tasks is not proof of improvement. The next move is the
decision table's recorded line, never a move inferred from a name.

Each fact has one visible owner. Put explanations and raw identities one click away.
Use short labels and facts that change with the run. Show refresh failure honestly;
do not expose reader implementation terms as connection status.

The log is paginated by the server, 100 matching events at a time. Kind and session
filters apply before paging. Do not transfer or render a whole log during dashboard
refresh.

## Craft guidance from Emil Kowalski

Use [Emil Kowalski's design engineering skills](https://github.com/emilkowalski/skills)
heavily for interaction craft, subordinate to the Anabasis identity and composition above.
The installed `emil-design-eng` skill is the starting point; animation guidance is a
judgement aid, not a requirement to add motion. Keep the existing fonts, palette,
altimeter, cards and four-pane structure.

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
