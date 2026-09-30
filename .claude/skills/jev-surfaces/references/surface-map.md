# Surface map at 96230cfc

Every surface below was found by the sweep in `SKILL.md` and checked against the source at
`96230cfc` (2026-09-28). The file and line references are that tree's, so re-read each one
before acting on it. No surface here has been measured against live Jev: no API key was
available when the map was written, and the scripts in `examples.md` were proved against a
local fake of the endpoint, which proves the request and the parsing and nothing about the
answers. Every "expect" below is therefore a prediction to freeze and test, never a result.

The ranking puts first what can be measured cheaply against labels that already exist and can
change nothing in a run. It puts last what would change a model-visible prompt in a paid run.

## Tier 1: tooling, labelled, advisory

**1. The simplify-precision judge.** `precision.mts` asks a blind Opus judge one fixed yes/no
question per shape (`QUESTIONS`, `.claude/skills/simplify-precision/scripts/precision.mts:84`),
in packets of ten sites, and `score` turns the verdicts into a Wilson interval per shape against
a target point of 0.8. `labels.tsv` beside that skill holds 347 verdicts from three judge rounds
(145, 144 and a held-out 58). That is a Noul surface as it stands. The state is the census
finding plus the lines at the site, the question is the shape's own sentence, and the labels are
already there. What it would change is the cost of a round, because a Jev pre-screen could send
the judge only the sites Jev is unsure about. Two cautions come from the skill's own record. The
judge itself agreed with only 7 of 13 operator yes answers, so agreement with the judge is not
the same as agreement with the operator, and the ledger rows (`tools/oxlint/not-slop.tsv`) are
the check on both. And `copied-block` asks about two places at once, which is the indirection
jev-1.13 reads worst, so expect it to trail the single-site shapes such as `unread-field` and
`compatibility-path`. `shadow-judge.ts` in `examples.md` is this experiment.

**2. The prose posture classifier.** `prose-classify.ts` labels every Builder and solver prose
row with the nearest of a fixed anchor set (`CLASSES`,
`.claude/skills/whole-run-investigation/classifier/prose-classify.ts:192`), flags rows below a
0.5 margin, and joins the labels to each submit's outcome and each case's kind. A Choice whose
criteria are the class descriptions returns a calibrated distribution where the embedding
returns a nearest anchor and a margin, and the outcome join is already built, so the comparison
is direct: does Jev's posture in the rows before a submit separate accepted from refused
submits better than the embedding's? The obstacle is not quality. The file's header says no
provider is called and no row text leaves the process, and that was a choice. Replacing it
sends Builder prose to TypeSafe, which is the operator's decision to make before the first
live call. The labels are advisory leads (`ADRIFT`, `:305`), never a score input, so the
authority filter passes.

**3. The family tier reader.** `query-complexity.ts` places each family's rule decisions and
check descriptions on four tiers, easy to frontier, by embedding against anchors (`TIERS`,
`.claude/skills/whole-run-investigation/classifier/query-complexity.ts:145`), and
`climb-velocity.ts` reads the tiers across batteries. That is a Score with four described
levels, and the anchor sentences are already level descriptions. The same local-only choice
applies. Two cautions matter more here. There are no labels, only anchors, so there is nothing
to measure agreement against until someone labels families. And a tier describes what the
bundle says it asks; rule 11 of `AGENTS.md` keeps difficulty with blind measurement, so a tier
from Jev is no more evidence of difficulty than the embedding's.

**4. The prompt-surface audience.** `extract-prompt-surface.ts` guesses whether a string holder
is model-visible from name regexes (`STRONG`, `:297`; `VOCAB`, `:306`), a deny list
(`DEFAULT_DENY_TOKENS`, `:102`) and longest-prefix paths, and the operator then classifies
groups by hand into five audiences. A Choice over those five, with the holder's name, owner
path and string as state, fits well. The skill does not record the operator's hand labels,
though, so this surface needs a labelled sample before it can be measured.

**5. Feature discovery over submit prose.** The posture output (`prose-classify.ts --json`)
carries, for each submit, its `outcome` and the `recent` rows before it with excerpts. That is
(text, outcome) data, which is what the autoresearch loop needs, and `discover.ts` runs it. It
is thin, though: the firmware campaign read while writing this map had one submit. So pool
every campaign, group the folds by campaign, and expect a few hundred records rather than the
cookbook's 2,000. Report the base rate beside every figure, because a small set with a lopsided
outcome makes a weak question look useful.

## Tier 2: product, advisory, a new recorded condition

**6. The context tool's ranking.** `cite` in `src/builder/context-tool.ts:177` ranks every line
of the round's documents by how many of the question's content words it contains, requires two
shared words once the question has three, and returns the top 30 (`CITED_DEFAULT`, `:59`) to
the Builder. There is no stemming and no weighting. The tool also takes a `decides` parameter,
"the decision the answer will settle" (`:69`), and records it (`:287`) without using it in the
ranking. A rerank is the textbook Jev surface: keep the lexical pass as a recall filter, then
ask one Score per shortlisted line against both the question and the decision, and one Noul
asking whether any line bears on it at all. `context-rerank.ts` is this. It is advisory, since
the Builder chooses what to do with the lines, but it changes a tool result every Builder round
reads, so it is a new condition with a moved digest. It would send workspace notes, measured
batteries and passing solver traces to TypeSafe. There are no labels either: the measurement
would be an operator-labelled set of (question, decides, line, bears-on-it) rows, drawn from
recorded `context` calls.

**7. Judge citation support.** A Judge fail must cite a public rule verbatim, and that check is
exact set membership (`citableRules`, `src/truth/judge-drivers.ts:80`; `parseVerdict`, `:95`).
Membership proves that the rule exists, not that it supports the fail. TypeSafe's citation-check
cookbook is this exact shape: one Choice (supports, contradicts, says nothing) over the cited
rule, the rationale and the part of the artifact it names. The answer would go to the Epoch
Reviewer as an annotation on a veto or a disputed fail, and never to the Builder. It stays
speculative until tried, because many public rules here are numeric limits, and a rule of the
form "utilisation at most 0.95" is a comparison Jev cannot make. Expect it to help only on the
rules that are semantic.

**8. Invented rules.** Rule 11 records Builders inventing duty and report rules the request never
held. One Noul per public rule in `brief.json` fits this: "would a practitioner asked for
`request` hold `rule` as part of that request?", with the one-line prompt as state. The answer
would be a lead in the Epoch Reviewer's orientation, which moves that prompt's digest. Nothing
is labelled yet. The five runs read on 2026-09-24 are where a first labelled set would come
from, and the reviewer must stay the one who decides whether a rule is invented.

## Safeguard only

**9. The provider-error regex.** `PROVIDER_BLOCKER_MESSAGE` (`src/truth/runtime-blocker.ts:56`),
joined with the allowance and thread-open clauses into `RUNTIME_NON_RESULT_MESSAGE` (`:60`),
decides through `solverNonResultReason` (`:103`) whether an unaccepted case is a runtime
non-result and leaves the verified denominator. It is the one prose classifier in `src` that
moves a denominator, and that is exactly why Jev cannot decide it: the case kinds are code's
(rule 5), and a probability threshold on a moving model would make the denominator a moving
condition. Beside it there is a real gap. A provider failure the regex does not know stays in
the denominator as a solver failure, which lowers a capability rate without anyone seeing it.
A log-only safeguard fits that gap. For a case the classifier left in the denominator, with no
accepted submit, ask one Noul over its error strings: "is this a provider, transport or
credential failure rather than the solver's own?" Above a high threshold, write one safeguard
line. The state is error strings only, which is small and a mild data class. What the line
buys is evidence for the next regex clause, and the `safeguards` skill owns its shape and its
retirement.

## Considered and closed

The verifier and every check in `evaluator.ts` are closed by design prior 1, and a Jev check is
not a hashed installed tool (prior 9). `placeOnBand`, the Wilson placement, effort, counts,
margins and every threshold are arithmetic. The diagnosis reader's owner and boundary
(`src/review/diagnosis-tool.ts:77`) are a reading across numbered steps of several solves. That
is multi-hop, and routing owners by a code-held classifier is what rule 5 rules out, so the
most Jev could do there is a consistency safeguard between the reader's own cause and its owner.
The Epoch Reviewer is a tool-using reader that executes probes, not a classification. The Main
Judge's own verdict needs the artifact read against every rule, often numerically, and a cheaper
second verdict would add a disagreement channel without adding evidence. `mentionsTask`
(`src/meta/identifier-scan.ts:33`) is a leak check that is exact on purpose. A paraphrase
detector beside it ("the third truss task") would be a log-only sensor at most, and nothing
recorded yet shows a paraphrased leak. The Builder's authoring decisions, meaning its tasks,
families and difficulty, belong to the model that writes them, and Jev writes nothing. The
reset-time parsing in `src/truth/provider-reset.ts` is date arithmetic. A new refusal of any
kind is closed: the gate audit asks a refusal to be 98% sure it refuses something actually
wrong, and a calibrated probability is not a proof of that.
