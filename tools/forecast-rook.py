# OUT-OF-SAMPLE FORECAST for the rook cell, with k fixed at 2.919 by the other three cells.
import gzip,json,glob,statistics,math
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
K_FIXED=2.9187
def ci(v):
    n=len(v)
    if n<2: return (statistics.mean(v) if v else float('nan'),float('nan'),float('nan'))
    m=statistics.mean(v);s=statistics.stdev(v);h=1.96*s/math.sqrt(n);return m,m-h,m+h
fold=[];sp=[];pw=[];elim=0;nteam=0;capped=0
for f in sorted(glob.glob(f"{SP}/continuous/rl5/arms/*/*/*.jsonl.gz")):
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
    s2b={s['teamID']:s['bot'] for s in hdr['seats']}
    Kt=len(hdr['config']['teams']); pidx={i for i,k in enumerate(hdr['config']['roster']) if k!='snake'}
    prevlen={};prevstand=None;F={}
    for t in turns:
        for uid in (t['events'].get('deaths') or {}):
            team=uid.rsplit('-',1)[0];b=s2b.get(team);w=prevlen.get(uid,1)
            if prevstand:
                W=sum(s['material'] for s in prevstand) or 1
                mine=next((s['material'] for s in prevstand if s['teamID']==team),0)
                F[b]=F.get(b,0)+(Kt/W)*(1-mine/W)*w
        prevlen={s['id']:s['length'] for s in t['board']['snakes']}
        prevstand=t['standings']
    S={p['bot']:p['sharePar'] for p in res['placements']}
    T,M='lobster-territory','lobster-material'
    if T in S and M in S:
        fold.append(-(F.get(T,0)-F.get(M,0))); sp.append(S[T]-S[M])
    for p in res['placements']:
        nteam+=1
        if p['eliminatedOnTurn'] is not None: elim+=1
    for s in turns[-1]['board']['snakes']:
        if int(s['id'].rsplit('-',1)[1]) in pidx and s2b.get(s['id'].rsplit('-',1)[0])==T: pw.append(s['length'])
f=ci(fold); s=ci(sp)
print(f"ROOK CELL, {len(sp)} complete games so far (target 48) -- PROVISIONAL")
print(f"  territory rook final weight     : {statistics.mean(pw):.1f}   (queen 31.2, knight 3.0)")
print(f"  eliminations per game           : {elim/(nteam/3):.2f}   (snake6 0.73, queen 1.04, knight 0.12)")
print(f"  folded weight saved (T-M)       : {f[0]:+.4f}")
print(f"  ---> FORECAST G = k * fold      : {K_FIXED*f[0]:+.3f}     with k = {K_FIXED} FIXED by the other three cells")
print(f"  observed G so far               : {s[0]:+.3f}  [{s[1]:+.3f},{s[2]:+.3f}]")
