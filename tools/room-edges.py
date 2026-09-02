"""a1k0n's Tron correction: does room count EDGES rather than CELLS?

He fitted K1*(N1-N2) + K2*(E1-E2) with K1~0.055, K2~0.194 - edges ~3.5x cells.
`room` is documented here as the DEATH PREDICTOR, so the decisive local test is:
which better predicts that this unit dies soon?

Both statistics are computed on the same first-arrival region, so this is a like-for-like
comparison of the quantity, not of the region.
"""
import gzip,json,glob,statistics,math
from collections import deque,defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
ORTH=[(1,0),(-1,0),(0,1),(0,-1)]; HORIZON=4; LOOKAHEAD=10
def bfs(sources,blocked,W,H,horizon=HORIZON):
    d={}; q=deque()
    for s in sources:
        if s not in d: d[s]=0; q.append(s)
    while q:
        c=q.popleft(); dc=d[c]
        if dc>=horizon: continue
        for dx,dy in ORTH:
            n=(c[0]+dx,c[1]+dy)
            if n in d or n in blocked or not(0<=n[0]<W and 0<=n[1]<H): continue
            d[n]=dc+1; q.append(n)
    return d
def auc(pos,neg):
    if not pos or not neg: return float('nan')
    allv=sorted([(v,1) for v in pos]+[(v,0) for v in neg])
    r=0; n1=len(pos); n0=len(neg); rank=0; i=0
    ranks={}
    # average ranks for ties
    while i<len(allv):
        j=i
        while j<len(allv) and allv[j][0]==allv[i][0]: j+=1
        avg=(i+j-1)/2+1
        for k in range(i,j): ranks[k]=avg
        i=j
    s=sum(ranks[k] for k,(v,lab) in enumerate(allv) if lab==1)
    return (s-n1*(n1+1)/2)/(n1*n0)
cells_died=[];cells_liv=[];edges_died=[];edges_liv=[];both=[]
for batch in ("rl1","rl3","rl4","rl5"):
    for f in sorted(glob.glob(f"{SP}/continuous/{batch}/arms/*/*/*.jsonl.gz"))[:12]:
        hdr=None;turns=[]
        try:
            with gzip.open(f,'rt') as fh:
                for line in fh:
                    r=json.loads(line)
                    if r['kind']=='header':hdr=r
                    elif r['kind']=='turn':turns.append(r)
        except Exception: pass
        if not(hdr and turns): continue
        alive_at=[{s['id'] for s in t['board']['snakes']} for t in turns]
        for i in range(0,len(turns)-LOOKAHEAD,5):
            bd=turns[i]['board']; W,H=bd['width'],bd['height']
            occ=set()
            for s in bd['snakes']:
                for c in s['body']: occ.add((c['x'],c['y']))
            heads={s['id']:(s['body'][0]['x'],s['body'][0]['y']) for s in bd['snakes']}
            for uid,h in heads.items():
                others=[v for k,v in heads.items() if k!=uid]
                ed=bfs(others,occ,W,H)
                mine=bfs([h],occ,W,H)
                owned={c for c,dc in mine.items() if dc<ed.get(c,99)}
                N=len(owned)
                E=sum(1 for c in owned for dx,dy in ((1,0),(0,1)) if (c[0]+dx,c[1]+dy) in owned)
                died = uid not in alive_at[i+LOOKAHEAD]
                (cells_died if died else cells_liv).append(N)
                (edges_died if died else edges_liv).append(E)
                both.append((N,E,1 if died else 0))
print(f"n={len(both)} unit-observations; died within {LOOKAHEAD} turns: {sum(d for _,_,d in both)}")
print(f"\n{'statistic':10s} {'mean|died':>10s} {'mean|lived':>11s} {'AUC (predicting death)':>24s}")
print(f"{'CELLS N':10s} {statistics.mean(cells_died):10.1f} {statistics.mean(cells_liv):11.1f} {1-auc(cells_died,cells_liv):24.4f}")
print(f"{'EDGES E':10s} {statistics.mean(edges_died):10.1f} {statistics.mean(edges_liv):11.1f} {1-auc(edges_died,edges_liv):24.4f}")
# a1k0n's combination, his ratio K2/K1 = 3.5
comb_d=[e*3.5+n for n,e,d in both if d]; comb_l=[e*3.5+n for n,e,d in both if not d]
print(f"{'N+3.5E':10s} {statistics.mean(comb_d):10.1f} {statistics.mean(comb_l):11.1f} {1-auc(comb_d,comb_l):24.4f}")
r=[(e/n if n else 0) for n,e,d in both]
print(f"\nedges per cell: mean {statistics.mean(r):.3f} (a region's E/N ~ its compactness)")
print("AUC > 0.5 = the statistic predicts death; higher is a better predictor.")
