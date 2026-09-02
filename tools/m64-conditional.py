"""M64 - is the sign-flipping cycle SELECTABLE?

POP-3 found the logit cycle flips sign between snake boards (+0.60) and piece boards
(-0.43..-0.55). A sign flip by board family IS "the best arm depends on the board",
which is exactly what VBS-SBS measures and exactly what a pooled average destroys.

The selector is keyed on BOARD FAMILY, read off the ROSTER - a pre-specified,
observable property, so this is not selection on the outcome. And it is CROSS-VALIDATED:
the family-best arm is chosen on one half of each cell's games and scored on the other,
so the reported gain is attainable, not an oracle.

Baselines, all under the same split-half protocol:
    SBS        one arm everywhere, chosen on the training half
    FAMILY     one arm per board family (2 groups, 1 bit)
    ORACLE     one arm per cell (unattainable; the POP-1 figure)
    FLOOR      the same procedures over pseudo-arms built from ONE bot's own games
"""
import csv,statistics,random,sys
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"

def family(roster):
    kinds=set(roster.split('|'))
    return 'snake-only' if kinds=={'snake'} else 'has-piece'

def load(triple):
    rows=list(csv.DictReader(open(f"{SP}/archx-value/tools/population.csv")))
    bygame=defaultdict(dict); meta={}
    for r in rows:
        bygame[r['game']][r['bot']]=float(r['sharePar'])
        meta[r['game']]=(r['cell'],family(r['roster']))
    T=set(triple)
    games=[g for g,d in bygame.items() if T<=set(d)]
    cells=defaultdict(list)
    for g in games: cells[meta[g][0]].append(g)
    fam={c:meta[cells[c][0]][1] for c in cells}
    return bygame,cells,fam

def run(triple,reps=300,seed=17,minper=8):
    arms=sorted(triple)
    bygame,cells,fam=load(triple)
    cells={c:g for c,g in cells.items() if len(g)>=minper}
    if not cells: return None
    rnd=random.Random(seed)
    res=defaultdict(list)
    for _ in range(reps):
        A=defaultdict(dict); B=defaultdict(dict)
        for c,gs in cells.items():
            g2=gs[:]; rnd.shuffle(g2); h=len(g2)//2
            for tag,part in (('A',g2[:h]),('B',g2[h:])):
                if not part: continue
                d={a:statistics.mean(bygame[g][a] for g in part) for a in arms}
                (A if tag=='A' else B)[c]=d
        common=[c for c in cells if c in A and c in B]
        if len(common)<4: continue
        # SBS: best single arm on A, scored on B
        mA={a:statistics.mean(A[c][a] for c in common) for a in arms}
        sbs=max(mA,key=mA.get)
        res['SBS'].append(statistics.mean(B[c][sbs] for c in common))
        # FAMILY: best arm per family on A, scored on B
        fbest={}
        for f in set(fam[c] for c in common):
            cs=[c for c in common if fam[c]==f]
            mf={a:statistics.mean(A[c][a] for c in cs) for a in arms}
            fbest[f]=max(mf,key=mf.get)
        res['FAMILY'].append(statistics.mean(B[c][fbest[fam[c]]] for c in common))
        # ORACLE: best arm per cell on A, scored on B
        res['ORACLE'].append(statistics.mean(B[c][max(A[c],key=A[c].get)] for c in common))
        # FLOOR: pseudo-arms from the SBS arm's own games
        pA={};pB={}
        for c,gs in cells.items():
            g2=gs[:]; rnd.shuffle(g2); q=len(g2)//4
            if q<1: continue
            parts=[g2[0:q],g2[q:2*q],g2[2*q:3*q],g2[3*q:4*q]]
            pA[c]={f"p{i}":statistics.mean(bygame[g][sbs] for g in parts[i]) for i in (0,1)}
            pB[c]={f"p{i}":statistics.mean(bygame[g][sbs] for g in parts[i+2]) for i in (0,1)}
        cc=[c for c in common if c in pA and c in pB]
        if len(cc)>=4:
            mp={a:statistics.mean(pA[c][a] for c in cc) for a in ('p0','p1')}
            b0=max(mp,key=mp.get)
            base=statistics.mean(pB[c][b0] for c in cc)
            fb={}
            for f in set(fam[c] for c in cc):
                cs=[c for c in cc if fam[c]==f]
                mf={a:statistics.mean(pA[c][a] for c in cs) for a in ('p0','p1')}
                fb[f]=max(mf,key=mf.get)
            res['FLOOR'].append(statistics.mean(pB[c][fb[fam[c]]] for c in cc)-base)
    def ci(v):
        v=sorted(v); n=len(v); return statistics.mean(v), v[int(.025*n)], v[int(.975*n)]
    out={}
    for k in ('SBS','FAMILY','ORACLE'):
        if res[k]: out[k]=ci(res[k])
    if res['FLOOR']: out['FLOOR']=ci(res['FLOOR'])
    out['_cells']=len(cells); out['_fams']={f:sum(1 for c in cells if fam[c]==f) for f in set(fam.values())}
    out['_gainF']=ci([f-s for f,s in zip(res['FAMILY'],res['SBS'])])
    out['_gainO']=ci([o-s for o,s in zip(res['ORACLE'],res['SBS'])])
    return out

for triple in (('lobster-material','lobster-territory','reflex'),
               ('parentDefault','potionIntel','reflex')):
    r=run(triple)
    print(f"\n=== {sorted(triple)} ===")
    if not r: print("   insufficient data"); continue
    print(f"   cells={r['_cells']}  families={r['_fams']}")
    for k in ('SBS','FAMILY','ORACLE'):
        if k in r: print(f"   {k:8s} score {r[k][0]:.4f}  [{r[k][1]:.4f},{r[k][2]:.4f}]")
    print(f"   GAIN family-conditional over SBS : {r['_gainF'][0]:+.4f}  [{r['_gainF'][1]:+.4f},{r['_gainF'][2]:+.4f}]")
    print(f"   GAIN per-cell oracle over SBS    : {r['_gainO'][0]:+.4f}  [{r['_gainO'][1]:+.4f},{r['_gainO'][2]:+.4f}]")
    if 'FLOOR' in r: print(f"   FLOOR (same protocol, pseudo-arms): {r['FLOOR'][0]:+.4f}  [{r['FLOOR'][1]:+.4f},{r['FLOOR'][2]:+.4f}]")
