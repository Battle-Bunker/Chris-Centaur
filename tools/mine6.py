import gzip,json,sys,os,glob,statistics,math
from collections import defaultdict
def games(batch):
    for arm in ('nullA','nullB'):
        for d in glob.glob(f"{batch}/arms/{arm}/*"):
            if os.path.isdir(d):
                for f in sorted(glob.glob(d+"/*.jsonl.gz")): yield arm,f
def ci(v):
    n=len(v); m=statistics.mean(v); s=statistics.stdev(v) if n>1 else 0
    h=1.96*s/math.sqrt(n); return m,m-h,m+h
def run(batch,label,CUT=40):
    pairs=defaultdict(list)   # metric -> list of within-game (terr - mat)
    sppair=[]; elimpair=[]
    ng=0
    for arm,f in games(batch):
        hdr=None;res=None;turns=[]
        with gzip.open(f,'rt') as fh:
            for line in fh:
                r=json.loads(line)
                if r['kind']=='header':hdr=r
                elif r['kind']=='result':res=r
                elif r['kind']=='turn':turns.append(r)
        if not res: continue
        ng+=1
        s2b={s['teamID']:s['bot'] for s in hdr['seats']}
        early=defaultdict(int); tot=defaultdict(int)
        for t in turns:
            for uid in (t['events'].get('deaths') or {}):
                b=s2b.get(uid.rsplit('-',1)[0])
                tot[b]+=1
                if t['turn']<=CUT: early[b]+=1
        sp={p['bot']:p['sharePar'] for p in res['placements']}
        el={p['bot']:(1 if p['eliminatedOnTurn'] is not None else 0) for p in res['placements']}
        T,M='lobster-territory','lobster-material'
        if T in sp and M in sp:
            pairs['earlyDeaths(T-M)'].append(early[T]-early[M])
            pairs['totalDeaths(T-M)'].append(tot[T]-tot[M])
            pairs['sharePar(T-M)'].append(sp[T]-sp[M])
            pairs['elim(T-M)'].append(el[T]-el[M])
        elimpair.append(sum(el.values()))
    print(f"=== {label} ({ng} games) ===   mean teams eliminated/game = {statistics.mean(elimpair):.2f}")
    for k,v in pairs.items():
        m,lo,hi=ci(v)
        print(f"   {k:22s} {m:+7.3f}  95% CI [{lo:+.3f},{hi:+.3f}]")
run(sys.argv[1],sys.argv[2])
