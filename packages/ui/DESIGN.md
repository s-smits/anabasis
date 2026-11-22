# Anabasis design principles

The visual baseline is the Campaign pane featuring a single primary truth chart, disciplined typography and strict evidential clarity. Multi-panel overview dashboards are deliberately avoided.

## Composition

The interface consists of four plainly labelled panes in fixed order: Campaign, Moves, Tasks and Log. Navigation follows a single drill-down hierarchy: campaign, move, solve, then individual turn and tool call. The active pane and every nested selection (move, solve, task, harness and inspector state) are synchronised with the URL so browser back navigation undoes selections and every view is directly linkable. Do not replace this hierarchy with question-driven navigation, multi-panel walls or redundant charts competing for the same data.

The Campaign pane serves as the main view, arranged top to bottom:

- **Campaign header**: the project name as the editorial eyebrow, the campaign name as the display title, its current state and cumulative dollar spend against the budget cap, seated above the altimeter rule.
- **Three summary readouts**: the current reference harness with its promotion count, the most recent comparison's reading expressed as wins, losses and ties, and the decision table's next recommended move with its rationale (or the terminal ending once the campaign has concluded).
- **Primary comparison chart**: a wide chart displaying one stacked column per comparison, showing scored tasks broken down by outcome in raw counts. Promotions appear as dividers between columns, with distinct markers for manual overrides (`--despite`) and returns to the starter; changes in experimental setting insert a visual break; A/A controls render in a muted style; repeated comparisons link visually to the comparison they repeat; and Builder sessions occurring between comparisons appear as small marks beneath the axis. An in-progress or unreported comparison remains open at its scored task count rather than collapsing to zero. Clicking any column opens that comparison in the Moves pane.
- **Harness strip**: a single horizontally scrolling row displaying every harness version at uniform card size, starting with the starter harness. Selecting a card expands it in place; left and right arrow keys move the selection; "Compare with previous" opens the diff in the inspector. Avoid scaled, partially hidden or animated cards, and never place two harnesses' scores side by side as if evaluated under identical conditions: every card's tally explicitly identifies its own comparison.
- **Two secondary charts**: first, a breakdown of won tasks per comparison by the deciding measure (validity, objective or bill), rendered as one column per comparison in three tonal strengths of the win colour; second, cumulative dollar spend across moves against the budget cap. Both the latest readout and each comparison's detail view display the same measure breakdown alongside the tally, since a step won on cost reads as 28-1-1 just as plainly as one won on valid answers.
- **Summary counters**: rendered as a single line of plain text.

The layout functions cleanly when no promotions have occurred, which is the common case. Prior to the first comparison, the chart area reports what task supply the campaign currently holds for evaluation.

The remaining panes support targeted inspection: Moves lists every session and comparison chronologically with its handover, cost and duration; Tasks presents a matrix of task versions against comparisons; and Log paginates raw JSONL events. Selecting a row opens an in-place detail view with the parent list hidden rather than stacked above it; navigating back restores the filtered list and returns focus to the previously selected row. Previous evidence remains visible while a new fetch completes. Pickers open anchored to the current selection and support keyboard dismissal. All four navigation tabs remain directly accessible on narrow viewports without hiding behind an unlabelled drawer.

Evaluate every visual element by the question it answers or the action it enables. Keep raw hashes, storage paths and schema fields out of top-level summaries while preserving full auditability one click deeper. Collection inputs list items and their field counts in a single column, keeping item payloads and secondary field groups collapsed by default. Label tool calls by call number, tool name and the truncated first line of the command or primary text argument; label other items by their first scalar key-value pair, falling back to an indexed label when that value is nested or absent.

## House style

Each visual block carries a single title and at most one qualifying line. Avoid explanatory notes above blocks or captions beneath them: details explaining a figure belong one click deeper in a tooltip, expandable card, inspector or detail pane. A chart legend functions as a key rather than a caption and stays integrated with the chart.

All typography sizes use design tokens. Below the page title, every font size maps to one of the five scale steps in `styles.css` (`--ana-text-xs` through `--ana-text-lg`), named semantically like colour tokens. Page titles retain their own responsive clamp. New CSS rules always reference a token step rather than a literal size.

Typography and spacing remain restrained. Labels, table headers and readout titles use sentence case with normal letter tracking rather than uppercase with wide tracking. Font weight never exceeds 600. Padding, margins and gaps follow a 4px scale. All tables use tabular figures, and p-values are formatted consistently to three decimal places via `pText`. Status indicators remain quiet: semantic tones tint a small square-cornered background, while neutral statuses render as plain text rather than filled pills. Labels, buttons and single-line statuses omit trailing full stops. Adjacent readouts size to the width their content requires rather than forcing equal-width columns.

Outcome colours are strictly fixed. The six possible outcomes of a scored task use only the `--ana-out-*` tokens, ordered and labelled according to `views/outcome.ts`: won in the accent colour, lost in the error tone, the three tie categories in three zinc tints (lightest where the reference harness was valid on every rollout) and set aside in the warning tone. No outcome may use another colour, these colours carry no other meaning in charts, and every colour swatch is paired with an explicit label or count.

Use canonical repository terminology consistently: campaign, comparison, reference harness, held-out task, practice task, valid answer, rejection and promotion. Reserve "step" exclusively for a statistically significant comparison reading, and refer to elements of a campaign's sequence as moves. Legacy v1 terminology does not apply here.

## Identity

The palette uses a near-black zinc canvas (`#09090b`), neutral white text and cyan (`#4cc2ff`) for interactive elements and the primary measured series. Green, amber and red are reserved strictly for evidential status; cards carry no coloured side rules. Typography pairs Electrolize for titles, Newsreader for the editorial voice (upright in the eyebrow, italic in asides), Manrope for body prose, Space Grotesk for tabular figures and a true monospace face for identifiers. All fonts are bundled locally. The altimeter rule beneath the hero header is the visual signature.

Build exclusively on the shared primitives and token layer. Charts retain the shadcn `ChartContainer`/Recharts composition adapted to the Bun application's shared stylesheet. Do not introduce secondary colour palettes or standalone component styles.

## Evidence

Always display the raw task tally beside a statistical reading, keeping rejections, set-aside tasks and non-results strictly separated. Represent a missing reading as an explicit gap, and never fabricate a timeline position for a missing timestamp. Insert a sequence break whenever experimental conditions change or are unavailable. Because the evaluated task set shifts between comparisons, never connect separate comparisons' counts with a continuous line, and never present higher raw win counts across different task sets as proof of improvement. Display the next move directly from the decision table's recorded output rather than inferring it from a label.

Every fact has one visible owner on screen, with explanations and raw identifiers one click away. Prefer concise labels and values that reflect live campaign state. Report refresh failures plainly without leaking internal reader implementation terms as connection status.

The server paginates the log at 100 matching events per page, applying event-kind and session filters before pagination. Never transfer or render a full campaign log during dashboard refresh.

## Craft guidance from Emil Kowalski

Apply [Emil Kowalski's design engineering skills](https://github.com/emilkowalski/skills) for interaction craft, subordinate to the Anabasis visual identity and composition rules above. The installed `emil-design-eng` skill serves as the reference; treat its animation guidance as a design aid rather than a mandate to add motion. Preserve the established fonts, palette, altimeter, cards and four-pane layout.

High-frequency interactions (navigation, project switching, task inspection and keyboard shortcuts) must remain immediate. Never animate refreshed evidence or redraw charts on background polls; retain previous content until replacement data is ready. Avoid transitioning layout properties such as sidebar width or page margins, which shift the reading surface and trigger layout thrashing.

Provide crisp press feedback on pointer controls using a restrained scale while keeping keyboard actions instantaneous. Respect reduced-motion preferences. Any deliberate motion must have a clear functional purpose, a short explicit duration, a grounded transform origin and immediate interruptibility without blocking input. Rely on platform primitives and existing components rather than adding animation libraries.

Visual polish derives from clear hierarchy, well-placed controls, reliable focus and scroll restoration, informative labels, honest empty states and consistent spacing; verify these behaviours in a real browser while preserving evidential integrity and the established layout.

Maintain shallow card shadows, a single shared table surface and uniform 40px filter controls. Keep table labels and abbreviated identifiers intact, permitting horizontal scrolling where necessary. The project menu may extend past the sidebar to display full names while remaining clamped within the viewport, and short viewports must preserve sidebar scrolling. Nested disclosures use an inner border radius and a quieter border. Touch targets should meet a 44px minimum where practical.

## Typographic hygiene from unslop

The typographic and spacing rules under House style incorporate the checklist from [unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky (CC BY 4.0): sentence-case labels, maximum font weight of 600, a 4px spacing scale, uniform tabular number formatting, quiet status badges, omission of trailing full stops and content-proportional readout widths. Treat this checklist as a review standard for new styles, subordinate to the Anabasis identity above.
