# How much do the two objectives diverge in practice?
# argmax-at-cap: heaviest team takes the game (draw among ties).
# sharePar:      proportional split.
# Measure: the top-2 weight margin at game end, and how often argmax is knife-edge.
import gzip,json,glob,statistics
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
rows=defaultdict(list); wins=defaultdict(lambda: defaultdict(int)); shares=defaultdict(lambda: defaultdict(float))
for batch,label in [("rl1","snake6"),("rl4","snake5-queen"),("rl3","snake5-knight"),("rl5","snake5-rook")]:
    for f in sorted(glob.glob(f"{SP}/continuous/{batch}/arms/*/*/*.jsonl.gz")):
        hdr=None;res=None
        try:
            with gzip.open(f,'rt') as fh:
                for line in fh:
                    r=json.loads(line)
                    if r['kind']=='header':hdr=r
                    elif r['kind']=='result':res=r
        except Exception: pass
        if not(hdr and res): continue
        ps=sorted(res['placements'], key=lambda p:-p['adjudicatedMaterial'])
        W=sum(p['adjudicatedMaterial'] for p in ps) or 1
        top,second=ps[0],ps[1]
        margin=top['adjudicatedMaterial']-second['adjudicatedMaterial']
        rows[label].append((margin, margin/W, top['adjudicatedMaterial']/W))
        # who wins under each rule
        wins[label][top['bot']]+=1
        for p in res['placements']: shares[label][p['bot']]+=p['sharePar']
print(f"{'cell':16s} {'n':>4s} {'median top-2 margin':>20s} {'as % of W':>10s} {'margin<=2 wt':>13s} {'top share':>10s}")
for c in ('snake6','snake5-queen','snake5-knight','snake5-rook'):
    v=rows[c]
    if not v: continue
    m=[a for a,_,_ in v]; frac=[b for _,b,_ in v]; ts=[t for _,_,t in v]
    tight=sum(1 for a in m if a<=2)
    print(f"{c:16s} {len(v):4d} {statistics.median(m):20.1f} {100*statistics.median(frac):9.1f}% {100*tight/len(v):12.0f}% {100*statistics.mean(ts):9.0f}%")
print("\nWINNER under argmax (heaviest at end) vs MEAN sharePar, per bot:")
for c in ('snake6','snake5-queen','snake5-knight','snake5-rook'):
    n=sum(wins[c].values())
    if not n: continue
    print(f"  {c}:")
    for b in sorted(shares[c], key=lambda x:-wins[c][x]):
        print(f"     {b:20s} argmax wins {wins[c][b]:3d}/{n:3d} = {100*wins[c][b]/n:3.0f}%   mean sharePar {shares[c][b]/n:.3f}")
