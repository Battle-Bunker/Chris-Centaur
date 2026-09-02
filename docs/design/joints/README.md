# Joints and composition — design set

Architecture design, COMPOSITION lens: the joint system itself — configuration,
registries, the engine API, and how strategy collections compose. Design only;
no shipping code on this branch. Anchors verified against
`claude/cluster-lookahead` @ `3090b77`, the kit line @ `639416b`, and
`TacticToes` @ `416d9c8`.

**Start at `07-SYNTHESIS.md`** — it is standalone. The rest are the derivations.

| file | what it settles |
|---|---|
| `00-CORE.md` | the disease (values and premises travelling separately), the four moves, joints as a manifest, bots as expressions over collections, the reachability law |
| `01-PREMISE-LATTICE.md` | the premise as an index and `(S, w)` as the fiber; join / meet / advance; the reducibility tag as the price of the meet; `frame` as a fourth projection coordinate; the config half of the base |
| `02-JOINT-INVENTORY.md` | the eleven joints read off the shipping code with the law each actually uses; the ordering comparator; admission over valuation; the reduction joint in five places; the shipped bot written as a value; four migration increments; §7 absorbs the VALUE lens |
| `03-ENGINE-API.md` | cut at determinism rather than purity: `settleTurn` with an injected spawner, one exported adjudicator, grammar queries shared with the human interface, a resolution record on the wire |
| `04-ADDRESSING.md` | the half-built experiment coordinate system; `botId`; declared versus observed coordinates; what lane (b) can say under addressing |
| `05-ADVANCE-AND-COMMITMENTS.md` | the memoryless-across-turns finding; `advance` as the third operation; the two purchase columns (and why ponder needs both); the carried premise as one object for pins, reference actions, commitments, roles and stances |
| `06-SELECTION-AND-SKETCH.md` | within-bot dynamic selection as a premise change; Law S; the concrete types; the three CI checks; the byte-identity path; the refusal list |
| `07-SYNTHESIS.md` | the whole factorization, the build order across lenses, the risks, and a checker-clean owner summary |
| `08-FIT-PROVENANCE.md` | ruling 49: a fitted number is a value with the premise it was fitted under; transfer penalty, the two fit laws, and six degrees of freedom the machine expresses that we never tried |
| `09-REDTEAM-RESPONSE.md` | the TIME lens's six breaks against this carve: all six adopted, three with sharper forms (obligation composes by min-deadline; Law K for calibration; per-site reduction bindings that default to broadcast) |
| `10-REDTEAM-BELIEF.md` | adversarial pass on the EPISTEMICS carve: the "touches nothing" claim is a diff test against a regime shift, plus lever preconditions, frozen-slot contention, the tag's non-partition, fog-tracking fear, the oracle's sampling bias and the observer-belief cost model |

Cross-lens: this set adopts the EPISTEMICS lens's support/weight vocabulary
(`design/belief-fog`), the TIME lens's `advance` and anticipatory meet
(`design/time-interruption`), and the VALUE lens's weight-flow currency and
homogeneity diagnostic (`design/value-evaluation`). Where a relayed claim did
not match the source document, the mismatch is named at
`02-JOINT-INVENTORY.md` §7.
