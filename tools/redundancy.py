"""Design-robust redundancy: do two arms respond to BOARDS the same way?

Profile = per-cell mean sharePar, centred within cell. Correlated profiles = redundant
members; selection between them cannot pay, which bounds VBS-SBS directly.

NULL: with k seats summing to K in one game, co-seated arms are forced toward
corr = -1/(k-1) = -0.5 at k=3. Read every number against that null, not against 0.
"""
import csv,statistics,itertools
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
def main(path=f"{SP}/archx-value/tools/population.csv", mingames=20, mincells=4):
    rows=list(csv.DictReader(open(path)))
    by=defaultdict(list); cellall=defaultdict(list)
    for r in rows:
        by[(r['bot'],r['cell'])].append(float(r['sharePar'])); cellall[r['cell']].append(float(r['sharePar']))
    cm={c:statistics.mean(v) for c,v in cellall.items()}
    prof=defaultdict(dict)
    for (b,c),v in by.items():
        if len(v)>=mingames: prof[b][c]=statistics.mean(v)-cm[c]
    def corr(x,y):
        n=len(x);mx=statistics.mean(x);my=statistics.mean(y)
        sx=statistics.pstdev(x);sy=statistics.pstdev(y)
        return None if sx==0 or sy==0 else sum((a-mx)*(b-my) for a,b in zip(x,y))/(n*sx*sy)
    NULL=-0.5
    out=[]
    for i,j in itertools.combinations(sorted(prof),2):
        common=sorted(set(prof[i])&set(prof[j]))
        if len(common)<mincells: continue
        c=corr([prof[i][x] for x in common],[prof[j][x] for x in common])
        if c is not None: out.append((c-NULL,c,i,j,len(common)))
    print(f"{'pair':44s} {'cells':>5s} {'corr':>7s} {'vs null':>8s}  reading")
    for d,c,i,j,n in sorted(out,reverse=True):
        tag="REDUNDANT" if d>0.9 else ("complementary" if d<-0.2 else "at null - uninformative")
        print(f"{i.replace('lobster-','')+' / '+j.replace('lobster-',''):44s} {n:5d} {c:+7.3f} {d:+8.3f}  {tag}")
    print(f"\nnull for co-seated arms at 3 seats = {NULL}; deviation from null is the signal.")
if __name__=='__main__': main()
