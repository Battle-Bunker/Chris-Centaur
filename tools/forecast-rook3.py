# PRE-REGISTERED out-of-sample forecast for the rook cell, THREE-CHANNEL fold,
# k = 1.227 fixed by snake6 + snake5-queen + snake5-knight. Nothing fitted to the rook.
import gzip,json,glob,statistics,math,sys
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
K_FIXED=1.227
def ci(v):
    n=len(v)
    if n<2: return (float('nan'),)*3
    m=statistics.mean(v);s=statistics.stdev(v);h=1.96*s/math.sqrt(n);return m,m-h,m+h
def netflow(batch):
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
        s2b={s['teamID']:s['bot'] for s in hdr['seats']}; Kt=len(hdr['config']['teams'])
        prevlen={};prevstand=None;N={}
        for t in turns:
            if prevstand:
                W=sum(s['material'] for s in prevstand) or 1
                sh={s['teamID']:s['material']/W for s in prevstand}
                loss={};gain={}
                for uid in (t['events'].get('deaths') or {}):
                    tm=uid.rsplit('-',1)[0];loss[tm]=loss.get(tm,0)+prevlen.get(uid,1)
                for s in t['board']['snakes']:
                    d=s['length']-prevlen.get(s['id'],s['length'])
                    if d>0:
                        tm=s['id'].rsplit('-',1)[0];gain[tm]=gain.get(tm,0)+d
                tl=sum(loss.values())
                for tm,b in s2b.items():
                    N[b]=N.get(b,0)+(Kt/W)*((1-sh.get(tm,0))*(gain.get(tm,0)-loss.get(tm,0))+sh.get(tm,0)*(tl-loss.get(tm,0)))
            prevlen={s['id']:s['length'] for s in t['board']['snakes']}
            prevstand=t['standings']
        S={p['bot']:p['sharePar'] for p in res['placements']}
        T,M='lobster-territory','lobster-material'
        if T in S and M in S: out.append((N.get(T,0)-N.get(M,0), S[T]-S[M]))
    return out
r=netflow('rl5')
if not r: sys.exit("no complete rook games yet")
x=ci([a for a,_ in r]); y=ci([b for _,b in r])
print(f"ROOK CELL — {len(r)} of 48 complete games")
print(f"  net folded flow (T-M)      : {x[0]:+.4f}")
print(f"  FORECAST  G = 1.227 x flow : {K_FIXED*x[0]:+.3f}      <-- pre-registered, k fixed elsewhere")
print(f"  observed G so far          : {y[0]:+.3f}  [{y[1]:+.3f},{y[2]:+.3f}]")
print(f"\n  (sanity — same model on the three fitted cells:)")
for b,l in [("rl1","snake6"),("rl4","queen"),("rl3","knight")]:
    rr=netflow(b); xx=statistics.mean(a for a,_ in rr); yy=statistics.mean(bb for _,bb in rr)
    print(f"    {l:8s} model {K_FIXED*xx:+.3f}   observed {yy:+.3f}   resid {yy-K_FIXED*xx:+.3f}")
