"""ITEM 1 - THE DEAD-CELL DETECTOR.

DEADNESS = spread of ARM performance on a cell, relative to that cell's WITHIN-ARM noise
floor. One column over the arm x cell matrix POP-1 already builds.

Distinct from M5 (outcome variance). M5 asks "does the outcome vary at all"; deadness asks
"does it vary BETWEEN ARMS". A cell can have large outcome variance and zero deadness -
every arm scores the same on average while individual games swing wildly - and that is the
WORST block to spend, because M5 says it is lively.

    signal(cell)  = sd across arms of their mean sharePar          (between-arm)
    floor(cell,B) = the A/A floor AT A FIXED BLOCK SIZE B: the typical gap between two
                    disjoint B-game samples of the SAME arm on that cell
    DEADNESS(B)   = signal / floor(B)     <= 1  =>  DEAD AT THAT SPEND

WHY THE BUDGET IS PART OF THE STATISTIC (a bug caught by the positive control). My first
version computed the floor by halving whatever games the cell happened to have. That floor
shrinks as 1/sqrt(n), so a cell with 1,056 games/arm is "live" for any non-zero difference -
and snake5-knight, independently shown dead three times, scored 6.31 "live". That ratio is a
SIGNIFICANCE statistic, not a DECISION statistic. Deadness must answer "if I spend B games
per arm here, will the arms separate?", so B is fixed by the experimenter, not by the corpus.
Reported at B=24 and B=96. Absolute `signal` is reported alongside, because a difference can
be detectable and still too small to care about.

Positive control: snake5-knight, independently shown dead three times.
"""
import csv,statistics,random,math
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"

def run(B=24, mingames=None, reps=300, seed=23):
    mingames = mingames or 2*B
    rows=list(csv.DictReader(open(f"{SP}/archx-value/tools/population.csv")))
    per=defaultdict(lambda: defaultdict(list))     # cell -> arm -> [sharePar]
    allsc=defaultdict(list)
    for r in rows:
        per[r['cell']][r['bot']].append(float(r['sharePar']))
        allsc[r['cell']].append(float(r['sharePar']))
    rnd=random.Random(seed)
    out=[]
    for cell,arms in per.items():
        arms={a:v for a,v in arms.items() if len(v)>=minges} if False else {a:v for a,v in arms.items() if len(v)>=mingames}
        if len(arms)<2: continue
        means={a:statistics.mean(v) for a,v in arms.items()}
        signal=statistics.pstdev(list(means.values()))
        halves=[]
        for a,v in arms.items():
            d=[]
            for _ in range(reps):
                w=v[:]; rnd.shuffle(w)
                d.append(abs(statistics.mean(w[:B])-statistics.mean(w[B:2*B]))/2)
            halves.append(statistics.mean(d))
        floor=statistics.mean(halves)          # A/A floor at block size B
        m5=statistics.pstdev(allsc[cell])          # outcome variance (M5)
        n=min(len(v) for v in arms.values())
        out.append((signal/floor if floor else float('inf'), signal, floor, m5, cell, len(arms), n))
    return sorted(out)

if __name__=='__main__':
    import sys
    B=int(sys.argv[1]) if len(sys.argv)>1 else 24
    print(f"### DEADNESS AT A SPEND OF B={B} GAMES PER ARM ###\n")
    out=run(B=B)
    print(f"{'cell':34s} {'arms':>4s} {'n/arm':>6s} {'M5 (outcome sd)':>16s} {'signal':>8s} {'floor':>8s} {'DEADNESS':>9s}  verdict")
    for ratio,sig,fl,m5,cell,na,n in out:
        v = "DEAD - do not spend" if ratio<=1.0 else ("marginal" if ratio<=2.0 else "live")
        star = "  <-- positive control" if cell=='snake5-knight' else ""
        print(f"{cell:34s} {na:4d} {n:6d} {m5:16.3f} {sig:8.3f} {fl:8.3f} {ratio:9.2f}  {v}{star}")
    dead=[o for o in out if o[0]<=1.0]
    print(f"\n{len(dead)} of {len(out)} cells are DEAD by this criterion.")
    hi=[o for o in dead if o[3]>0.5]
    print(f"{len(hi)} of those have HIGH outcome variance (M5 > 0.5) - lively to M5, dead to arms,")
    print("   i.e. exactly the blocks M5 cannot protect you from:")
    for ratio,sig,fl,m5,cell,na,n in sorted(hi,key=lambda o:-o[3])[:8]:
        print(f"     {cell:34s} M5={m5:.3f}  deadness={ratio:.2f}  n/arm={n}")
