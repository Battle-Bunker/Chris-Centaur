# Does WEIGHT LOST TO DEATH predict sharePar better than DEATH COUNT?
import gzip,json,glob,statistics,math,sys
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
def ci(v):
    n=len(v); m=statistics.mean(v); s=statistics.stdev(v) if n>1 else 0
    return m, m-1.96*s/math.sqrt(n), m+1.96*s/math.sqrt(n)
def run(batch,label):
    dcount=defaultdict(list); dweight=defaultdict(list); spd=[]
    rows=[]
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
        s2b={s['teamID']:s['bot'] for s in hdr['seats']}
        # length of each unit on each turn
        prevlen={}
        cnt=defaultdict(int); wt=defaultdict(int)
        for t in turns:
            for uid in (t['events'].get('deaths') or {}):
                b=s2b.get(uid.rsplit('-',1)[0])
                cnt[b]+=1; wt[b]+=prevlen.get(uid,1)
            prevlen={s['id']:s['length'] for s in t['board']['snakes']}
        sp={p['bot']:p['sharePar'] for p in res['placements']}
        T,M='lobster-territory','lobster-material'
        if T in sp and M in sp:
            dcount[label].append(cnt[T]-cnt[M]); dweight[label].append(wt[T]-wt[M]); spd.append(sp[T]-sp[M])
    if not spd: return None
    dc=ci(dcount[label]); dw=ci(dweight[label]); s=ci(spd)
    print(f"--- {label} (n={len(spd)}) ---")
    print(f"    deaths (T-M)        {dc[0]:+8.3f} [{dc[1]:+.2f},{dc[2]:+.2f}]     sharePar per death avoided  = {s[0]/-dc[0] if dc[0] else float('nan'):+.3f}")
    print(f"    WEIGHT lost (T-M)   {dw[0]:+8.2f} [{dw[1]:+.1f},{dw[2]:+.1f}]     sharePar per weight saved   = {s[0]/-dw[0] if dw[0] else float('nan'):+.4f}")
    print(f"    sharePar (T-M)      {s[0]:+8.3f} [{s[1]:+.2f},{s[2]:+.2f}]")
    return (s[0], dc[0], dw[0])
out={}
for b,l in [("rl1","snake6"),("rl4","snake5-queen"),("rl3","snake5-knight")]:
    out[l]=run(b,l)
print("\n=== ONE-COEFFICIENT MODEL TEST ===")
print("If safety is priced in WEIGHT, one coefficient k should give sharePar = k * (weight saved) on ALL cells.")
print(f"{'cell':16s} {'sharePar':>9s} {'per-death k':>12s} {'per-WEIGHT k':>13s}")
for l,(s,dc,dw) in out.items():
    print(f"{l:16s} {s:+9.3f} {s/-dc if dc else float('nan'):12.4f} {s/-dw if dw else float('nan'):13.5f}")
