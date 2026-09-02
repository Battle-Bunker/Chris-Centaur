# Score the rook registration on the COMPLETED cell, clock-corrected extraction.
import gzip,json,glob,statistics,math
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
def flows(batch):
    out=[]
    for f in sorted(glob.glob(f"{SP}/continuous/{batch}/arms/*/*/*.jsonl.gz")):
        hdr=None;res=None;turns=[]
        try:
            with gzip.open(f,'rt') as fh:
                for line in fh:
                    r=json.loads(line)
                    if r['kind']=='header':hdr=r
                    elif r['kind']=='result':res=r
                    elif r['kind']=='turn':turns.append(r)
        except Exception: pass
        if not(hdr and res and turns): continue
        s2b={s['teamID']:s['bot'] for s in hdr['seats']};K=len(hdr['config']['teams'])
        B=defaultdict(float)
        for i in range(len(turns)-1):     # ONE CLOCK: board only
            L0={s['id']:s['length'] for s in turns[i]['board']['snakes']}
            L1={s['id']:s['length'] for s in turns[i+1]['board']['snakes']}
            w0=defaultdict(float)
            for uid,l in L0.items(): w0[uid.rsplit('-',1)[0]]+=l
            W0=sum(w0.values()) or 1
            gain=defaultdict(float);lD=defaultdict(float);lS=defaultdict(float)
            for uid,l0 in L0.items():
                tm=uid.rsplit('-',1)[0]
                if uid not in L1: lD[tm]+=l0
                else:
                    d=L1[uid]-l0
                    if d>0: gain[tm]+=d
                    elif d<0: lS[tm]+=-d
            tl=sum(lD.values())+sum(lS.values())
            for tm,b in s2b.items():
                p=w0[tm]/W0
                B[b]+=(K/W0)*((1-p)*(gain[tm]-lD[tm]-lS[tm])+p*(tl-lD[tm]-lS[tm]))
        S={p['bot']:p['sharePar'] for p in res['placements']}
        T,M='lobster-territory','lobster-material'
        if T in S and M in S:
            anyelim=any(p['eliminatedOnTurn'] is not None for p in res['placements'])
            out.append((B[T]-B[M], S[T]-S[M], anyelim))
    return out
# k from the ORIGINAL three cells, clock-corrected (basis B)
tr=[]
for b in ("rl1","rl4","rl3"): tr+=flows(b)
kfit=sum(x*y for x,y,_ in tr)/sum(x*x for x,_,_ in tr)
rook=flows("rl5")
X=[x for x,_,_ in rook]; Y=[y for _,y,_ in rook]
mx=statistics.mean(X); my=statistics.mean(Y)
sd=statistics.stdev(Y); ci=1.96*sd/math.sqrt(len(Y))
print(f"k refit on the three original cells, CLOCK-CORRECTED basis B: k = {kfit:.3f}")
print(f"\nROOK CELL, {len(rook)} games, clock-corrected extraction")
print(f"   rook's own folded flow (T-M)  : {mx:+.4f}")
print(f"   forecast  = k x flow          : {kfit*mx:+.4f}")
print(f"   MEASURED G                    : {my:+.4f}   [{my-ci:+.3f},{my+ci:+.3f}]")
print(f"   error                         : {my-kfit*mx:+.4f}")
el=[(x,y) for x,y,e in rook if e]; ne=[(x,y) for x,y,e in rook if not e]
for nm,g in (("games WITH an elimination",el),("games with NO elimination",ne)):
    if not g: continue
    gx=statistics.mean(a for a,_ in g); gy=statistics.mean(b for _,b in g)
    print(f"   {nm:26s} n={len(g):3d}  flow {gx:+.3f} -> model {kfit*gx:+.3f}   measured {gy:+.3f}   err {gy-kfit*gx:+.3f}")
