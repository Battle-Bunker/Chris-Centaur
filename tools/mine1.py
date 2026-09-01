import gzip,json,sys,os,glob
from collections import defaultdict

def games(batch):
    for arm in ('nullA','nullB'):
        d=f"{batch}/arms/{arm}/pp-roster-ladder"
        if not os.path.isdir(d): 
            d=glob.glob(f"{batch}/arms/{arm}/*")[0]
        for f in sorted(glob.glob(d+"/*.jsonl.gz")):
            yield arm,f

def summarize(batch,label):
    rows=[]
    for arm,f in games(batch):
        hdr=None; res=None; turns=[]
        with gzip.open(f,'rt') as fh:
            for line in fh:
                r=json.loads(line)
                if r['kind']=='header': hdr=r
                elif r['kind']=='result': res=r
                elif r['kind']=='turn': turns.append(r)
        if not res: continue
        seats={s['teamID']:s['bot'] for s in hdr['seats']}
        rows.append(dict(arm=arm,file=os.path.basename(f),hdr=hdr,res=res,turns=turns,seats=seats))
    return rows

for batch,label in [(sys.argv[1],sys.argv[2])]:
    rows=summarize(batch,label)
    print(f"=== {label}: {len(rows)} games ===")
    # ending reason
    reasons=defaultdict(int)
    capped=0
    for g in rows:
        rs=g['res']['reason']
        key='elimination' if 'last team standing' in rs else ('cap' if 'turn' in rs.lower() or 'cap' in rs.lower() else rs[:40])
        reasons[key]+=1
    print("end reasons:",dict(reasons))
    print("turns: mean %.1f  min %d max %d"%(sum(g['res']['turns'] for g in rows)/len(rows),min(g['res']['turns'] for g in rows),max(g['res']['turns'] for g in rows)))
    # sharePar distribution per bot
    sp=defaultdict(list)
    for g in rows:
        for p in g['res']['placements']:
            sp[p['bot']].append(p['sharePar'])
    for bot,v in sorted(sp.items()):
        import statistics
        zeros=sum(1 for x in v if x<0.01); threes=sum(1 for x in v if x>2.5)
        print(f"  {bot:20s} n={len(v):3d} mean={statistics.mean(v):.3f}  sharePar==0: {zeros:3d} ({100*zeros/len(v):.0f}%)  sharePar>2.5: {threes:3d} ({100*threes/len(v):.0f}%)")
    # elimination survival
    surv=defaultdict(lambda:[0,0])
    for g in rows:
        for p in g['res']['placements']:
            surv[p['bot']][1]+=1
            if p['eliminatedOnTurn'] is None: surv[p['bot']][0]+=1
    print("  survived to end (not eliminated):")
    for bot,(s,n) in sorted(surv.items()): print(f"    {bot:20s} {s}/{n} = {100*s/n:.0f}%")
