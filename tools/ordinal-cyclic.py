"""CURL-CAPABLE cyclicity: pairwise FINISHING ORDER, not a difference of per-arm means.

Any A[i][j] = m(i) - m(j) built from per-arm scalars is a gradient field and has zero
curl BY CONSTRUCTION - at any seat count. So the earlier zero was a property of the
STATISTIC, not of the game, and finding no cyclicity in it is circular.

The ordinal statistic is not a difference of per-arm scalars:
    A[i][j] = P(i finishes ahead of j | both seated) - 0.5
Triangle sums are then NOT identically zero and rock-paper-scissors can appear.

Counterweight (recorded, not discovered here): 3-seat games genuinely suppress RPS
structure because third parties absorb losses. Expect SMALL. Small != zero-by-construction.
"""
import csv,itertools,statistics,math,random
from collections import defaultdict
SP="/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad"
rows=list(csv.DictReader(open(f"{SP}/archx-value/tools/population.csv")))
bygame=defaultdict(dict); gcell={}
for r in rows:
    bygame[r['game']][r['bot']]=float(r['sharePar']); gcell[r['game']]=r['cell']
def matrices(games):
    win=defaultdict(lambda:[0.0,0]); 
    for g in games:
        d=bygame[g]
        for i,j in itertools.combinations(sorted(d),2):
            s=1.0 if d[i]>d[j] else (0.0 if d[i]<d[j] else 0.5)
            win[(i,j)][0]+=s; win[(i,j)][1]+=1
    A={};N={}
    for (i,j),(s,n) in win.items():
        if n<30: continue
        A[(i,j)]=s/n-0.5; A[(j,i)]=-A[(i,j)]; N[(i,j)]=N[(j,i)]=n
    return A,N
def triangles(A):
    bots=sorted({b for p in A for b in p})
    return [t for t in itertools.combinations(bots,3) if all((i,j) in A for i,j in itertools.combinations(t,2))]
def cyc(A,t):
    i,j,k=t; return A[(i,j)]+A[(j,k)]+A[(k,i)]
print("=== ORDINAL (finishing-order) CYCLICITY, whole archive ===\n")
A,N=matrices(bygame.keys())
tri=triangles(A)
print(f"{'triangle':52s} {'min n':>6s} {'cycle':>9s} {'|cycle| / mean|edge|':>21s}")
rows_out=[]
for t in sorted(tri,key=lambda t:-min(N[(a,b)] for a,b in itertools.combinations(t,2))):
    c=cyc(A,t); sc=statistics.mean(abs(A[(a,b)]) for a,b in itertools.combinations(t,2))
    n=min(N[(a,b)] for a,b in itertools.combinations(t,2))
    rows_out.append((abs(c),c,t,n,sc))
    print(f"{str([x.replace('lobster-','') for x in t]):52s} {n:6d} {c:+9.4f} {100*abs(c)/sc if sc else 0:20.1f}%")
# permutation null: shuffle each game's scores among its seats, recompute triangle cycles
rnd=random.Random(3); games=list(bygame.keys())
null=defaultdict(list)
for _ in range(300):
    perm={}
    for g in games:
        d=bygame[g]; ks=list(d); vs=[d[k] for k in ks]; rnd.shuffle(vs)
        perm[g]=dict(zip(ks,vs))
    sv=bygame; globals()['bygame']=perm
    An,_=matrices(games)
    for t in tri:
        if all((i,j) in An for i,j in itertools.combinations(t,2)): null[t].append(abs(cyc(An,t)))
    globals()['bygame']=sv
print("\nagainst a within-game permutation null (300 draws): is the observed cycle larger than chance?")
for absc,c,t,n,sc in sorted(rows_out,reverse=True):
    nl=null.get(t,[])
    if not nl: continue
    p=sum(1 for x in nl if x>=absc)/len(nl)
    print(f"   {str([x.replace('lobster-','') for x in t]):50s} |cycle|={absc:.4f}  null mean={statistics.mean(nl):.4f}  p={p:.3f}")
