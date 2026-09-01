# Does third-party damage HELP us, and is the exchange rate ~ (1-p):p ?
# Per team-observation: regress sharePar on (own weight lost) and (weight lost by OTHERS).
import gzip,json,glob,statistics
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
def ols2(X1,X2,Y):
    n=len(Y); m1=statistics.mean(X1);m2=statistics.mean(X2);my=statistics.mean(Y)
    x1=[a-m1 for a in X1];x2=[a-m2 for a in X2];y=[a-my for a in Y]
    s11=sum(a*a for a in x1);s22=sum(a*a for a in x2);s12=sum(a*b for a,b in zip(x1,x2))
    s1y=sum(a*b for a,b in zip(x1,y));s2y=sum(a*b for a,b in zip(x2,y))
    det=s11*s22-s12*s12
    if det==0: return None
    return ((s22*s1y-s12*s2y)/det, (s11*s2y-s12*s1y)/det)
rows=[]
for batch,label in [("rl1","snake6"),("rl4","snake5-queen"),("rl3","snake5-knight")]:
    X1=[];X2=[];Y=[]
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
        prevlen={}; lost={}
        for t in turns:
            for uid in (t['events'].get('deaths') or {}):
                team=uid.rsplit('-',1)[0]
                lost[team]=lost.get(team,0)+prevlen.get(uid,1)
            prevlen={s['id']:s['length'] for s in t['board']['snakes']}
        tot=sum(lost.values())
        for p in res['placements']:
            own=lost.get(p['teamID'],0)
            X1.append(own); X2.append(tot-own); Y.append(p['sharePar'])
    b=ols2(X1,X2,Y)
    if b: rows.append((label,len(Y),b[0],b[1]))
print(f"{'cell':16s} {'n':>4s} {'b_ownWeightLost':>16s} {'b_othersWeightLost':>19s}   ratio |own|/|others|")
for l,n,b1,b2 in rows:
    print(f"{l:16s} {n:4d} {b1:+16.4f} {b2:+19.4f}   {abs(b1/b2) if b2 else float('nan'):.2f}")
print("\nPredicted by the share metric at 3-team par (p=1/3):")
print("   b_own    < 0  (losing our weight costs us),  magnitude (1-p) = 0.667")
print("   b_others > 0  (third-party losses RAISE our share), magnitude p = 0.333")
print("   => ratio |b_own| / |b_others| = (1-p)/p = 2.0")
