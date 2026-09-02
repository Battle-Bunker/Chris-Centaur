# SCORING THE ROOK REGISTRATION — the model passes, the number I published did not

The rook cell completed: **territory − material G = +0.424, CI [0.195, 0.670]** (own A/A floor
0.606, so it does not clear its floor; territory − reflex +1.225 [0.982, 1.444] clears
decisively). I pre-registered a forecast. Scoring it against my own stated criterion.

---

## 1. WHAT I REGISTERED, AND THE PLAIN VERDICT ON IT

| registration | value | measured | inside CI? |
|---|---|---|---|
| 2-channel, k=2.919 (cycle 3) | **+0.173** | +0.424 | **no** |
| 3-channel, k=1.227 (cycle 4) | **+0.078** | +0.424 | **no** |

**Both published numbers are wrong, and the second is wrong by a factor of five.** That is the
honest headline and it goes first.

---

## 2. WHY, AND IT IS NOT THE CLOCK BUG

The registered *formula* is `G = k × (the rook cell's own realised folded flow)`, with `k` fixed
by the other three cells. The flow is a **measured input**, and when I registered the number the
cell had **12 of 48 games**. Its flow estimate then was +0.0632. Converged, it is **+0.3243** —
**a factor of five out.**

Evaluating the same registered formula on the completed cell:

| extraction | k | rook flow | forecast | measured | error |
|---|---|---|---|---|---|
| as registered (mixed-clock script) | 1.227 | +0.3328 | **+0.408** | +0.424 | +0.016 |
| **clock-corrected (basis B, k refit on the 3 original cells)** | **1.230** | **+0.3243** | **+0.3988** | **+0.4241** | **+0.0253** |

Two things follow, and they point in opposite directions for me:

1. **The clock-mixing defect did not drive the miss.** Corrected and uncorrected extractions agree
   to within 0.01 (+0.399 vs +0.408). This was sampling noise in an input, not the bug I found in
   cycle 5.
2. **The model transports.** `k` fitted on three rosters predicts a fourth to within **+0.025 —
   about 6%** — out-of-sample, comfortably inside the measured CI. That is precisely what I said
   the test would check: *"it tests whether the COEFFICIENT transports to a roster it was not
   fitted on — not whether the flows themselves can be predicted."*

**Applying my own criterion literally:** I wrote *"if the completed cell's G lands far from
`1.227 × its net folded flow`, the fold is overfitted to three points and I will say so."* It
landed at +0.424 against +0.399. **The criterion passes.**

**But the methodological error is mine and it is real.** I published a point forecast whose
input was not converged. Labelling it "PROVISIONAL" and quoting a ±1.1 CI on the *observed*
side did not excuse quoting a hard number on the *predicted* side. The correct registration
would have been the formula plus an input-uncertainty band, and I would have had to say the band
was too wide at n=12 to be worth registering yet.

---

## 3. THE ERROR STRUCTURE MATCHES THE BOUNDARY FINDING

Splitting the rook cell by whether any team was eliminated:

| | n | flow | model | measured | error |
|---|---|---|---|---|---|
| games **with** an elimination | 31 | +0.316 | +0.389 | +0.421 | **+0.032** |
| games with **no** elimination | 17 | +0.339 | +0.417 | +0.430 | **+0.014** |

The interior-only fold **under-predicts, and under-predicts more than twice as much where an
elimination occurred** — exactly the direction and the place cycle 5b's boundary finding
predicts, since the elimination premium sits at the terminal step the fold does not contain.
The out-of-sample residual is not noise: it has the shape my own diagnosis says it should.

---

## 4. THE VERDICT I WOULD NOT SIGN

The suggested honest verdict was *"the fold predicts within-game share accounting excellently but
cross-bot cell G poorly."* **The data does not support the second half and I will not claim it.**
Given converged flows the fold predicts cross-bot cell G to 6% out-of-sample on a fourth roster.

The accurate statement of where its reach ends is narrower and more useful:

> **The fold converts flows into share, and does that well — in the interior exactly, and
> out-of-sample to ~6%. It does not predict the flows.** Anything requiring flows to be known in
> advance is outside it: forecasting a cell's G before the cell is run, ranking arms before
> playing them, or choosing between two bots on paper. The rook miss was an instance of exactly
> that boundary — I fed it an input it had no way to supply, and the input was wrong.

That is not a small limitation and I would rather it were stated crisply than softened: **the
fold is an accounting identity with a transportable coefficient, not a predictor of play.**
Everything the lens has claimed — interior completeness, the Ng policy-invariance theorem, the
2:1 asymmetry, the terminal-boundary localisation — is independent of forecasting cell G, and
none of it moves either way on this result.

---

## 5. AND A CHECK THAT STRENGTHENS COMPOSITION'S FALSIFIER

Before running their falsifier (*seat `model/terminal@1`, leave the fold alone, and the +0.969
game-length dependence must move into explained variance*), I worried it could fire spuriously:
part of my terminal gap might be that the replay simply has no `board[last+1]`, i.e. the last
turn's flows are **unobservable** rather than **unmodelled**. Those need different fixes, and the
falsifier would wrongly condemn the boundary model for a data artefact.

Tested — split the terminal gap by whether any elimination occurred:

| | n | mean \|terminal gap\| |
|---|---|---|
| no elimination | 65 | **0.0097** |
| an elimination occurred | 79 | **0.1248** |

**12.9× larger where the settling rule does more work.** An unobserved-last-turn artefact would
be roughly equal in both groups; it is not. **So the gap is the adjudication rule, and their
falsifier is safe to run as written.** My worry was worth testing and came out in their favour.
