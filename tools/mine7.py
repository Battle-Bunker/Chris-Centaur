import gzip,json,sys,os,glob,statistics,math
from collections import defaultdict
def games(batch):
    for arm in ('nullA','nullB'):
        for d in glob.glob(f"{batch}/arms/{arm}/*"):
            if os.path.isdir(d):
                for f in sorted(glob.glob(d+"/*.jsonl.gz")): yield arm,f
def ci(v):
    n=len(v)
    if n<2: return (float('nan'),)*3
    m=statistics.mean(v); s=statistics.stdev(v); h=1.96*s/math.sqrt(n); return m,m-h,m+h
def run(batch,label):
    noelim=[]; withelim=[]; noelim_mat=[]
    ng=0
    for arm,f in games(batch):
        hdr=None;res=None
        with gzip.open(f,'rt') as fh:
            for line in fh:
                r=json.loads(line)
                if r['kind']=='header':hdr=r
                elif r['kind']=='result':res=r
        if not res: continue
        ng+=1
        sp={p['bot']:p['sharePar'] for p in res['placements']}
        fm={p['bot']:p['adjudicatedMaterial'] for p in res['placements']}
        anyelim=any(p['eliminatedOnTurn'] is not None for p in res['placements'])
        T,M='lobster-territory','lobster-material'
        if T not in sp or M not in sp: continue
        d=sp[T]-sp[M]
        (withelim if anyelim else noelim).append(d)
        if not anyelim: noelim_mat.append(fm[T]-fm[M])
    m,lo,hi=ci(noelim); m2,lo2,hi2=ci(withelim); m3,lo3,hi3=ci(noelim_mat)
    print(f"=== {label} ({ng} games) ===")
    print(f"   games with NO elimination : n={len(noelim):3d}  sharePar(T-M) = {m:+.3f} [{lo:+.3f},{hi:+.3f}]   finalMaterial(T-M) = {m3:+.1f} [{lo3:+.1f},{hi3:+.1f}]")
    print(f"   games WITH an elimination : n={len(withelim):3d}  sharePar(T-M) = {m2:+.3f} [{lo2:+.3f},{hi2:+.3f}]")
run(sys.argv[1],sys.argv[2])
