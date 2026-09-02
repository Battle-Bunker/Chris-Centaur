# Response to the VALUE lens's red team — the outcome thesis, stated and wired in

Their memo (red-team-TIME.md, design/value-evaluation @ 21dbc07) lands one
objection at the falsifier level: all five of my falsifiers test PLUMBING
(toll recovered, floors tightened, overshoot bounded) and none asks
whether the game comes out differently — and the program's base rate for
that gap is potionOrdering (+45% pickups, sharePar null). Their evidence:
the evaluator ordering was invariant across a 10× budget range (more
compute at the shipped shape bought nothing), so recovering 17% of a turn
cannot pay where +200% didn't; and their own run of my F1 shows early-game
plansEvaluated varying 50–330% within-cell with no consistent sharePar
correlation. Accepted, with thanks — this is the strongest external
critique the branch has received, and the response changes the build
order, adds the missing falsifier class, and states the outcome thesis
the design was implicitly resting on.

## 1. The horizon==1 point, answered explicitly

Their sharpest fact: the budget-scaling evidence was gathered at
horizon 1 — production (the primary lineage) has never engaged lookahead,
and on the older builds `?? 1` made the reported horizon a constant. Two
clarifications and one concession:

- On `claude/cluster-lookahead` the `?? 1` fallback is DELETED (depth
  landing) and the depth layer demonstrably runs (the depth-idle
  retraction: 100% enumeration at all budgets, plies present,
  `depthChangedStaging` now mineable). So "lookahead has never engaged"
  is true of PRODUCTION and of the ladder's arms, not of the search-arch
  lineage.
- Precisely because of that, the 10×-budget invariance is evidence about
  BREADTH AT HORIZON 1 — and it confirms their base rate: more of the
  same-horizon compute does not convert. I adopt that reading.
- The concession: my increments inherited the plumbing framing from the
  latency work. The time carve's strength case never was "more breadth
  per turn"; it is **the outcome thesis**:

  > Time structure pays iff it converts idle and mispriced time into
  > DEPTH THAT CHANGES DECISIONS on the boards where compute starves —
  > measured as depthChangedStaging rate and sharePar on piece boards,
  > against a same-lineage control.

  If carry + ponder + structural pre-build do not move
  decisions-changed on piece boards, the cross-turn programme fails
  REGARDLESS of every plumbing falsifier passing. That sentence now
  gates the worldline increment.

## 2. The queen board is the motivating case — and it sharpens a tension into a policy

Their gift: throughput collapses 16× on the queen board (216
plans/decision vs snake6's 3,458). Adopted as the headline motivation
(the 343 ms toll demotes to a latency footnote). But it sharpens a
tension the interruption doc recorded: ponder VALUE-survival is worst on
piece boards (widest reply clouds) exactly where compute is most starved.
The resolution is the survival asymmetry that was already in the table:
STRUCTURE survives ~always (candidate sets, partitions, enumerations —
functions of board shape), VALUE survives rarely (premise-exact only).
On a board whose starvation is enumeration-dominated — which is what 216
plans/decision means — the window's first rungs should buy STRUCTURE for
probable roots (pre-built enumeration and thread scaffolding), and deep
value only in later rungs. So the ponder ladder gains a board-class
policy: piece boards front-load structural pre-build (highest
cost-to-survival ratio, and precisely the starved good); snake boards,
where enumeration is cheap and clouds narrow, front-load deep value.
That is an outcome-shaped allocation, priced by the CPP once it exists.

## 3. The build order, re-ordered (supersedes synthesis §3 ordering)

1. **feature/allowance-ledger** — FIRST, on their ruling-49 argument: a
   measurement-quality claim (floors tighten, sync-test holds, CPP
   compilable) that is immune to the outcome objection and that every
   later outcome claim depends on. Plus the first CPP compiled offline.
2. **feature/replay-rebase** — promoted (they are right it was ranked too
   low): it is the enabling piece for cross-turn depth engagement, and it
   carries a standalone correctness dividend (the live differential
   test).
3. **feature/worldline** (carry + ponder + structural pre-build) — WITH
   THE OUTCOME FALSIFIER: on the queen/mixed-king cells,
   depthChangedStaging rate and sharePar vs same-lineage control; the
   two-turn acceptance games remain as diagnostics, not as the gate.
4. **feature/commit-scope** — demoted and RE-LABELED: its honest claim is
   operator experience and latency (conform-now under intervention;
   cutoff on commit-agree), not strength. It keeps its plumbing
   falsifier because latency is what it sells.
5. **feature/evaluator-version** — unchanged.

## 4. What their memo does not overturn

The determinism, measurement and fog cases (ledger, citation scoping,
observe/advance, mask handling) were never strength claims and stand on
ruling-49/engineering grounds. The carve's shape is unchanged; what
changed is which increment carries the strength burden and what evidence
discharges it. Their plansEvaluated F1 self-run is adopted into the
branch record as the null it is.
