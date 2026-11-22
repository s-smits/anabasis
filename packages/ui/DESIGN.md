# Anabasis design principles

The visual baseline is the Campaign pane: one primary truth chart, disciplined typography and strict evidential clarity. Avoid multi-panel overview walls.

## Composition

Four plainly labelled panes in fixed order: **Campaign**, **Moves**, **Tasks**, **Log**. Single drill-down hierarchy: campaign → move → solve → turn/tool call. Sync active pane and every nested selection (move, solve, task, harness, inspector) with the URL so Back undoes selections and every view is linkable.

**Campaign pane (top to bottom)**:
- **Campaign header**: project eyebrow, campaign display title, state, cumulative spend vs budget cap, above the altimeter rule.
- **Three summary readouts**: current reference harness + promotion count; latest comparison reading (wins/losses/ties); `decide` next move + rationale (or terminal ending).
- **Primary comparison chart**: one stacked column per comparison of raw scored task counts. Dividers mark promotions (distinct markers for `--despite` overrides and starter returns); visual breaks mark condition changes; muted style for A/A controls; links for repeated comparisons; small sub-axis marks for Builder sessions. Unreported comparisons stay open at their scored count. Clicking a column opens it in Moves.
- **Harness strip**: single horizontal scroll row of uniform cards starting with the starter. Click expands in place; Left/Right arrows move selection; "Compare with previous" opens the diff inspector. Never animate/scale cards or place two harnesses' scores side by side without each card naming its own comparison.
- **Two secondary charts**: (1) won tasks per comparison by deciding measure (validity, objective, bill) in three tonal strengths (also shown on latest readout and detail view); (2) cumulative USD spend vs budget cap.
- **Summary counters**: single plain-text line.

Must handle zero-promotion campaigns cleanly; before the first comparison, report current task supply.

**Other panes**: **Moves** lists sessions/comparisons chronologically (handover, cost, duration); **Tasks** shows a task-version × comparison matrix; **Log** paginates raw JSONL events (100 matching events/page, filtered server-side before pagination—never transfer a full log on refresh). Selecting a row opens detail in place (hiding the parent list) and Back restores filters and focus. Keep prior evidence visible while refetching; anchor pickers to selection with keyboard dismissal; keep all four tabs accessible on narrow viewports. Keep raw hashes/paths/schema fields one click deeper; collapse collection payloads by default; label tool calls by number, tool name and truncated first line.

## House style & identity

- **Block copy**: one title + ≤1 qualifying line; put details in tooltips, expandable cards or detail panes; legends stay integrated with charts.
- **Palette & fonts**: `#09090b` near-black zinc canvas, neutral white text, `#4cc2ff` cyan accent/primary series; green/amber/red strictly for evidential status (no coloured card side rules). Locally bundled fonts: Electrolize (titles), Newsreader (eyebrow/italic asides), Manrope (body), Space Grotesk (tabular figures), true monospace (identifiers). Build on shared primitives, CSS tokens (`--ana-text-xs` through `--ana-text-lg`, responsive title clamp) and Recharts/`ChartContainer` without secondary palettes.
- **Typography & spacing** (incorporating [unslop](https://github.com/heydamir/unslop), CC BY 4.0): sentence-case labels with normal tracking, max weight 600, 4px spacing scale, tabular figures, `pText` (3 decimals for p-values), quiet square-cornered status tints (plain text for neutral), no trailing full stops on labels/buttons/single-line statuses, content-proportional readout widths.
- **Outcome colours**: strictly the six `--ana-out-*` tokens ordered per `views/outcome.ts` (won = accent, lost = error, 3 tie zinc tints lightest when reference valid on all rollouts, set aside = warning), paired with explicit labels/counts and never reused for other meanings.
- **Terminology**: use canonical `AGENTS.md` §14 terms (reserve "step" for a statistically significant reading; elements of a campaign sequence are "moves").

## Evidence

Always show raw task tallies beside readings; keep rejections, set-asides and non-results separate. Render missing readings as gaps and never fabricate timestamps or connect separate comparisons' counts with a continuous line. Insert sequence breaks when conditions change. Render `decide`'s recorded move directly. Report refresh failures plainly without leaking internal reader terms.

## Interaction craft

Apply [Emil Kowalski's design engineering skills](https://github.com/emilkowalski/skills) (`emil-design-eng`) subordinate to Anabasis's identity and layout:
- Keep navigation, project switching, task inspection and shortcuts immediate; never animate refreshed evidence or redraw charts on background polls; avoid transitioning layout properties (sidebar width, margins).
- Use restrained scale press feedback on pointer controls, respect reduced motion, keep any motion brief/interruptible/purposeful via platform primitives.
- Keep shallow card shadows, one shared table surface, 40px filter controls, intact labels (horizontal scroll if needed), clamped project menus, scrollable sidebars on short viewports, quieter nested disclosure borders, and ≥44px touch targets where practical. Verify changes in a real browser.
