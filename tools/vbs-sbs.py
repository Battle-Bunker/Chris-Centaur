"""INSTRUMENT 1 - the VBS - SBS gap: the headroom of member selection.

SBS (single best solver) = the arm with the best aggregate sharePar.
VBS (virtual best solver) = per scenario take the best arm, then average.
gap = VBS - SBS = what a perfect per-scenario selector would buy over one fixed arm.

Two granularities, and the difference between them is the point:
  per-SEED  - an upper bound, and CONTAMINATED BY NOISE (a selector cannot know a
              seed's outcome in advance). Reported with its own noise floor.
  per-CELL  - the honest headroom for a selector keyed on observable board shape.

NOISE FLOOR: rotateSeats gives up to 3 rotations per (cell,seed). Treating one bot's
own rotations as pseudo-arms yields the VBS gap attributable to noise + seat effects
alone. A per-seed gap below its floor is not headroom.
"""
import csv,statistics,sys
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"

def load(path=f"{SP}/archx-value/tools/population.csv", src=None):
    rows=list(csv.DictReader(open(path)))
    if src: rows=[r for r in rows if r['src']==src]
    for r in rows: r['sharePar']=float(r['sharePar'])
    return rows

def blocks(rows):
    """A comparison block = a bot-set plus the scenarios where ALL of them played."""
    bygame=defaultdict(dict)
    meta={}
    for r in rows:
        bygame[r['game']][r['bot']]=r['sharePar']
        meta[r['game']]=(r['cell'],r['seed'],r['src'])
    sets=defaultdict(list)
    for g,d in bygame.items(): sets[frozenset(d)].append(g)
    return bygame,meta,sets

def vbs_sbs(scores):
    """scores: {scenario: {arm: value}} restricted to scenarios where all arms present."""
    arms=sorted({a for d in scores.values() for a in d})
    per=defaultdict(list)
    vbs=[]
    for s,d in scores.items():
        if len(d)<len(arms): continue
        for a in arms: per[a].append(d[a])
        vbs.append(max(d.values()))
    if not vbs: return None
    means={a:statistics.mean(v) for a,v in per.items()}
    sbs_arm=max(means,key=means.get)
    return dict(arms=arms,n=len(vbs),sbs_arm=sbs_arm,sbs=means[sbs_arm],
                vbs=statistics.mean(vbs),gap=statistics.mean(vbs)-means[sbs_arm],means=means)

def report(rows,label):
    bygame,meta,sets=blocks(rows)
    big=sorted(sets.items(),key=lambda kv:-len(kv[1]))
    print(f"\n{'='*78}\n{label}\n{'='*78}")
    print("comparison blocks (bot-set : games):")
    for s,gs in big[:6]: print(f"   {len(gs):6d}  {sorted(s)}")
    for s,gs in big[:3]:
        arms=sorted(s)
        # ---- per-SEED (rotations averaged) ----
        seed_sc=defaultdict(lambda: defaultdict(list))
        cell_sc=defaultdict(lambda: defaultdict(list))
        for g in gs:
            cell,seed,_=meta[g]
            for a,v in bygame[g].items():
                seed_sc[(cell,seed)][a].append(v); cell_sc[cell][a].append(v)
        seed_m={k:{a:statistics.mean(v) for a,v in d.items()} for k,d in seed_sc.items()}
        cell_m={k:{a:statistics.mean(v) for a,v in d.items()} for k,d in cell_sc.items()}
        rs=vbs_sbs(seed_m); rc=vbs_sbs(cell_m)
        # ---- NOISE FLOOR: one bot's own rotations as pseudo-arms, per seed ----
        floor=None
        best=max(rs['means'],key=rs['means'].get)
        ps=defaultdict(dict)
        for g in gs:
            cell,seed,_=meta[g]
            d=seed_sc[(cell,seed)]
            v=d.get(best,[])
        pseudo={}
        for (cell,seed),d in seed_sc.items():
            v=d.get(best,[])
            if len(v)>=2: pseudo[(cell,seed)]={f"rot{i}":x for i,x in enumerate(v[:3])}
        if pseudo:
            k=min(len(x) for x in pseudo.values())
            pseudo={s:{f"rot{i}":list(d.values())[i] for i in range(k)} for s,d in pseudo.items()}
            floor=vbs_sbs(pseudo)
        print(f"\n  BLOCK {arms}   ({len(gs)} games)")
        print(f"    per-arm mean sharePar: " + "  ".join(f"{a}={rs['means'][a]:.3f}" for a in arms))
        print(f"    per-SEED  n={rs['n']:5d}  SBS={rs['sbs']:.3f} ({rs['sbs_arm']})  VBS={rs['vbs']:.3f}  GAP={rs['gap']:+.3f}")
        if floor: print(f"       noise floor (same bot, rotations as pseudo-arms, k={len(next(iter(floor['means'])))}): GAP={floor['gap']:+.3f}  -> excess = {rs['gap']-floor['gap']:+.3f}")
        print(f"    per-CELL  n={rc['n']:5d}  SBS={rc['sbs']:.3f} ({rc['sbs_arm']})  VBS={rc['vbs']:.3f}  GAP={rc['gap']:+.3f}")
        print(f"    per-cell winners: " + ", ".join(f"{c}:{max(d,key=d.get).replace('lobster-','')}" for c,d in sorted(cell_m.items())[:10]))

if __name__=='__main__':
    rows=load()
    report(rows,"ALL ROWS (native + derived sharePar)")
    report(load(src='native'),"NATIVE sharePar ONLY (post-schema-change batches)")

# ---------------------------------------------------------------------------
# Per-cell floor + per-joint decomposition (M42)
# ---------------------------------------------------------------------------
import random
def percell_detail(rows,botset,seed=11):
    rnd=random.Random(seed)
    bygame,meta,sets=blocks(rows)
    gs=sets[frozenset(botset)]
    arms=sorted(botset)
    cell_sc=defaultdict(lambda: defaultdict(list))
    for g in gs:
        cell,_,_=meta[g]
        for a,v in bygame[g].items(): cell_sc[cell][a].append(v)
    cell_m={c:{a:statistics.mean(v) for a,v in d.items()} for c,d in cell_sc.items()}
    r=vbs_sbs(cell_m); sbs_arm=r['sbs_arm']
    # PER-CELL NOISE FLOOR: split the SBS arm's own games in each cell into halves
    pseudo={}
    for c,d in cell_sc.items():
        v=d.get(sbs_arm,[])
        if len(v)<4: continue
        vv=v[:]; rnd.shuffle(vv); h=len(vv)//2
        pseudo[c]={'halfA':statistics.mean(vv[:h]),'halfB':statistics.mean(vv[h:])}
    fl=vbs_sbs(pseudo) if pseudo else None
    print(f"\n  PER-CELL DETAIL  {arms}")
    print(f"    SBS={r['sbs']:.3f} ({sbs_arm})  VBS={r['vbs']:.3f}  GAP={r['gap']:+.3f}"
          + (f"   per-cell noise floor={fl['gap']:+.3f}  -> EXCESS={r['gap']-fl['gap']:+.3f}" if fl else ""))
    print(f"    {'cell':32s} {'n':>4s} {'best arm':>18s} {'best':>7s} {'SBS arm':>8s} {'gain':>7s}")
    contrib=[]
    for c,d in cell_m.items():
        if len(d)<len(arms): continue
        b=max(d,key=d.get); gain=d[b]-d[sbs_arm]
        contrib.append((gain,c,b,d[b],d[sbs_arm],len(cell_sc[c][sbs_arm])))
    for gain,c,b,bv,sv,n in sorted(contrib,reverse=True):
        if gain<=1e-9: continue
        print(f"    {c:32s} {n:4d} {b.replace('lobster-',''):>18s} {bv:7.3f} {sv:8.3f} {gain:+7.3f}")
    tot=sum(g for g,*_ in contrib)
    print(f"    cells where switching helps: {sum(1 for g,*_ in contrib if g>1e-9)}/{len(contrib)}"
          f"   total gain {tot:.3f} over {len(contrib)} cells = {tot/len(contrib):+.3f} mean")

if __name__=='__main__':
    rows=load()
    for bs in (['lobster-material','lobster-territory','reflex'],
               ['plain','potionBoth','potionOrder'],
               ['parentDefault','potionIntel','reflex']):
        percell_detail(rows,bs)
