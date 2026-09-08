/**
 * Two PNGs, differenced in a browser: same size?, how many pixels differ, the
 * bounding box, and one differing pixel's two colours. The walkthrough`s own
 * `diffPngs`, off the driver, so a walk re-run can be compared shot by shot
 * without re-running the walk. `node scripts/lens-png-diff.js a.png b.png …`
 */
const fs=require('fs'),{chromium}=require('playwright');
(async()=>{
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const p=await (await b.newContext()).newPage();
await p.goto('about:blank');
const pairs=process.argv.slice(2);
for(let i=0;i<pairs.length;i+=2){
  const uri=(f)=>`data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
  const r=await p.evaluate(async([ua,ub])=>{
    const load=(s)=>new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=s;});
    const [ia,ib]=await Promise.all([load(ua),load(ub)]);
    if(ia.width!==ib.width||ia.height!==ib.height)return{sameSize:false,a:[ia.width,ia.height],b:[ib.width,ib.height]};
    const draw=(img)=>{const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);return x.getImageData(0,0,img.width,img.height).data;};
    const [da,db]=[draw(ia),draw(ib)];
    let n=0,top=1e9,bot=-1,left=1e9,right=-1,sample=null;
    for(let k=0;k<da.length;k+=4){
      if(da[k]!==db[k]||da[k+1]!==db[k+1]||da[k+2]!==db[k+2]){
        n++;const px=(k/4)%ia.width, py=Math.floor(k/4/ia.width);
        if(py<top)top=py; if(py>bot)bot=py; if(px<left)left=px; if(px>right)right=px;
        if(!sample)sample={x:px,y:py,a:[da[k],da[k+1],da[k+2]],b:[db[k],db[k+1],db[k+2]]};
      }}
    return{sameSize:true,w:ia.width,h:ia.height,differing:n,pct:+(n/(ia.width*ia.height)*100).toFixed(4),rows:[top,bot],cols:[left,right],sample};
  },[uri(pairs[i]),uri(pairs[i+1])]);
  console.log(pairs[i].split('/').pop(), JSON.stringify(r));
}
await b.close();})();
