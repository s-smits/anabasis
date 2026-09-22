# Simulate the brittle angles across runs

**Use this case when:** the operator asks for "the brittle angles", "the weak spots" or "what would break", names several runs or syntheses, and no single component is the question.

"Simulate the brittle angles" names no component. The work is to find the components that keep
appearing unbound across recorded runs, give each one exactly one condition, and let the cheap conditions kill
the expensive ones.

## 1. Collect the candidates

Run `pick-run.mts --json` over the syntheses (two or three runs is the usual request; use
`--component` once per suspect to count hits). A candidate is a component that:

- recurs in at least two syntheses' findings or adjudication, and
- no gate or test binds on the tree under test — check by grepping the tests for its export; a
  boundary that gained a check since the concern was written is already answered.

The recorded brittle boundaries all sit where model-visible prose crosses a controller boundary:
carried memory under a changed binding, starter text read as a kernel claim, an advisory reason
interpreted by the Builder, a provider refusal arriving as a successful turn, a submit-time gate
that the pre-submit check did not run.

## 2. One angle per component, one condition per angle

Write each angle as a question with a falsifier, and choose its shape from the routing table in
`SKILL.md`. Mixed shapes are the norm: most angles are deterministic (`check-one-fact`,
`scenario-stub`, `layer-walk`) and only the judgment questions need `live-segment` or
`fullrun-conditions`. Pre-register every condition in one note — including the condition you expect to fail and the
conditions you decided not to run — and hash it before anything starts.

## 3. Run cheap first

Deterministic conditions run first. Each one either clears a layer under a live condition or refutes the live
condition's premise, and a refuted premise cancels that condition before it is paid for. On 2026-08-23 two of
three brittle angles on #329/#331 were answered deterministically within the session; the third
waited on one full-run condition. Live conditions then run with one steward each, as in `live-segment`.

## 4. Resolve and route

Resolve every row with `predictions.mts --resolve`; `--unresolved` must print `none` before the
session reports. Each finding names one owner. A component that survived its angle is cleared for
that angle only; say which angles were not run.

## Finish

Report one row per angle: component, shape, condition, result, owner. Name the conditions dropped, the condition expected to fail and whether it did, and the angles not run.
