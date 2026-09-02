"""ITEM 3 - THE REPORTING RETROFIT, with the librarian's declared split (not cargo-culted).

  stratified bootstrap CI   - resample cell x seat x seed, not games, because that is the
                              design's actual dependence structure
  P(A beats B) + interval   - "how sure" in ONE number per verdict; this is the form that
                              exposed the RL literature's coin-flips
  performance profiles      - for CROSS-CELL comparison (fraction of cells where A is within
                              tau of the best), because a mean over cells hides the shape
  IQM                       - for the across-cell AGGREGATE ONLY; not for per-cell numbers
  seed population           - every spec must state it; a pinned seed is REPRODUCIBLE, not
                              REPRESENTATIVE, and the two are routinely conflated
"""
import csv,statistics,random,math
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"

def load():
    rows=list(csv.DictReader(open(f"{SP}/archx-value/tools/population.csv")))
    by=defaultdict(dict); strat={}
    for r in rows:
        by[r['game']][r['bot']]=float(r['sharePar'])
        strat[r['game']]=(r['cell'], r['seed'])
    return by,strat

def strat_boot(games,by,strat,stat,reps=2000,seed=5):
    """Resample STRATA (cell x seed), then games within them."""
    rnd=random.Random(seed)
    bycell=defaultdict(list)
    for g in games: bycell[strat[g][0]].append(g)
    cells=list(bycell)
    out=[]
    for _ in range(reps):
        cs=[rnd.choice(cells) for _ in cells]
        samp=[]
        for c in cs:
            pool=bycell[c]
            samp += [rnd.choice(pool) for _ in pool]
        v=stat(samp)
        if v is not None: out.append(v)
    out.sort()
    return statistics.mean(out), out[int(.025*len(out))], out[int(.975*len(out))]

def p_beats(A,B,by):
    def s(games):
        n=w=0
        for g in games:
            d=by[g]
            if A in d and B in d:
                n+=1; w+= 1 if d[A]>d[B] else (0.5 if d[A]==d[B] else 0)
        return w/n if n else None
    return s

def iqm(vals):
    v=sorted(vals); n=len(v); lo=n//4; hi=n-lo
    return statistics.mean(v[lo:hi]) if hi>lo else statistics.mean(v)

def perf_profile(by,strat,arms,taus=(0.0,0.05,0.1,0.2,0.5)):
    cell=defaultdict(lambda: defaultdict(list))
    for g,d in by.items():
        if not set(arms)<=set(d): continue
        for a in arms: cell[strat[g][0]][a].append(d[a])
    prof=defaultdict(dict)
    cells=[c for c in cell if all(cell[c][a] for a in arms)]
    for t in taus:
        for a in arms:
            k=sum(1 for c in cells if statistics.mean(cell[c][a]) >= max(statistics.mean(cell[c][b]) for b in arms)-t)
            prof[a][t]=k/len(cells)
    return prof,len(cells)

if __name__=='__main__':
    by,strat=load()
    print("STANDING VERDICTS, RETROFITTED\n")
    verdicts=[("lobster-territory","lobster-material"),
              ("lobster-territory","reflex"),
              ("potionOrder","plain"),
              ("potionBoth","plain"),
              ("parentDefault","potionIntel")]
    print(f"{'verdict':46s} {'n games':>8s} {'P(A beats B)':>14s} {'95% stratified CI':>22s}")
    for A,B in verdicts:
        gs=[g for g,d in by.items() if A in d and B in d]
        if len(gs)<50: continue
        m,lo,hi=strat_boot(gs,by,strat,p_beats(A,B,by))
        flag=" *** interval contains 0.5" if lo<=0.5<=hi else ""
        print(f"{A.replace('lobster-','')+' > '+B.replace('lobster-',''):46s} {len(gs):8d} {m:14.3f}   [{lo:.3f}, {hi:.3f}]{flag}")
    arms=['lobster-material','lobster-territory','reflex']
    prof,nc=perf_profile(by,strat,arms)
    print(f"\nPERFORMANCE PROFILE over {nc} cells - fraction of cells where an arm is within tau of the best")
    print(f"{'arm':22s}" + "".join(f"{'t='+str(t):>10s}" for t in (0.0,0.05,0.1,0.2,0.5)))
    for a in arms:
        print(f"{a:22s}" + "".join(f"{prof[a][t]:10.2f}" for t in (0.0,0.05,0.1,0.2,0.5)))
    cellm=defaultdict(list)
    for g,d in by.items():
        if 'lobster-territory' in d and 'lobster-material' in d:
            cellm[strat[g][0]].append(d['lobster-territory']-d['lobster-material'])
    per=[statistics.mean(v) for v in cellm.values() if len(v)>=10]
    print(f"\nACROSS-CELL AGGREGATE of territory-material over {len(per)} cells:")
    print(f"   mean = {statistics.mean(per):+.4f}   median = {statistics.median(per):+.4f}   IQM = {iqm(per):+.4f}")
    print("   (IQM is for this across-cell aggregate ONLY; per-cell numbers keep their own CIs)")
