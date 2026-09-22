# Initial prompts and the queries their Built Harness handles

The normal input to Anabasis is one line, plus optional `--context` paths. The system owns research
and task construction. This catalog shows what that one line can look like and which queries the
resulting Built Harness should handle. The relationship follows a shared rule: the
representation block in `src/author/builder-start-prompt.ts` states how each prompt shape expands into
a task battery, and the battery families are the query types.

## The three prompt shapes

**A — a field of tasks.** The request names a kind of work. The battery samples the field:
different families of work, with varied instances and difficulty within each family.

**B — a single build.** The request names one product with many components. The rule: read it as
the subject of its domain. Every named component and behaviour stays in the verified tasks, and the
battery varies the stated conditions around that build — different constraints, sequences,
quantities and failure cases — rather than inventing a different product or repeating the same
build under new names.

**C — a site plus an agent.** The request supplies a context artifact (a map, a terrain, a
dataset) and asks for an agent that works inside it. The rule: base every task on that
context. Each task is a different job a user could put to the agent there, verified against the
supplied context's own facts rather than an invented substitute for it. Shape C prompts carry
their site through `--context`.

In every shape the tasks keep the request's practical meaning: the checks evaluate how the answer
performs under stated conditions, not only how it is assembled.

## Ten prompts

### 1. Database migration (B)

> Build a PostgreSQL migration that splits customer addresses into a separate table while preserving records, foreign keys, application queries and rollback behaviour.

Queries the Built Harness handles: the migration for a stated schema; preservation of null and
duplicate addresses; query results before and after migration; rollback after a partially completed
operation; the same migration under stated transaction and compatibility constraints.

### 2. Bridge over a mapped valley (C)

> This 3D terrain map is the context; build an agent that designs and optimizes a pedestrian
> bridge across the marked span.

Queries: a truss design for a stated load at a stated crossing point on the map; a redesign that
clears a stated flood level; the minimum-material variant that still meets a stated deflection
limit; feasibility of a stated design under a stated wind load; a rerouted crossing when one
anchorage area is excluded.

### 3. Cold-store duty roster (A)

> Build an agent that writes duty rosters for a 24/7 cold-store warehouse under qualification
> and legal rest rules.

Queries: a week's roster for a stated staff list; the rework after a stated sickness; a swap
request that must not break rest rules; the minimum staffing that still covers every shift; a
roster that spreads night shifts evenly.

### 4. Process separation stage (B)

> Design a liquid separation stage with a recycle stream that meets stated product purity, recovery and energy limits.

Queries: a design for a stated feed composition; the operating point after a feed change; mass
and energy balances around the recycle loop; feasibility under a reduced heat duty; a redesign
when one separation step is unavailable.

### 5. Small quantum state preparation (A)

> Build an agent that prepares small quantum states on up to four qubits using only H, CNOT and
> T gates.

Queries: a circuit preparing a stated target state; the same state under a stated gate budget;
the measurement outcome distribution a stated circuit produces; a depth reduction of a stated
circuit that preserves its output; a preparation that avoids a stated forbidden coupling.

### 6. Delivery routing over a road graph (C)

> This road graph with travel times is the context; build an agent that plans delivery routes
> with time windows and vehicle capacity.

Queries: routes for a stated order list; the replan after a stated road closure; the fewest
vehicles that still meet every window; the arrival times a stated route produces; the effect of
one added stop on a stated plan.

### 7. Booking service (B)

> Build a Python booking service with rooms, overlapping-reservation rejection, cancellation
> windows and a JSON API.

Queries: the full source for the stated service; the response to a stated request sequence
(book, overlap attempt, cancel inside and outside the window); the state after a stated series
of events; the same service with a stated added constraint (a per-user booking limit); rejection
behaviour for stated malformed input.

### 8. Orchard irrigation (C)

> This orchard plot map and well capacity are the context; build an agent that plans weekly drip
> irrigation.

Queries: a week's schedule for stated crop water needs; the replan for a stated capacity cut;
the plot that runs short under a stated schedule; the schedule change after a stated rainfall;
the maximum plantable area the stated well still supports.

### 9. Titration protocols (A)

> Build an agent that writes step-by-step titration protocols for stated target concentrations
> and available glassware.

Queries: the protocol for a stated target and kit; the dilution series a stated protocol
produces; the smallest glassware set that still reaches a stated precision; the failure point in
a stated protocol; the rework when one reagent concentration changes.

### 10. School timetable (A)

> Build an agent that lays out school timetables under room, teacher and subject-hour
> constraints.

Queries: a timetable for a stated class and teacher set; the rework after a stated room loss;
the clash a stated draft contains; the minimum room count for a stated curriculum; a timetable
that keeps a stated teacher's day contiguous.

## The link, stated once

One initial prompt names a domain. The shape rules guide its expansion into task families. Those
families define the query types the battery measures. A battery that drops a
named component (shape B), invents a substitute site (shape C), or evaluates only how answers are
assembled (any shape) breaks that link: the Built Harness then answers queries the battery never
measured.
