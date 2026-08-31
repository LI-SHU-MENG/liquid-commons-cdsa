const IMAGES=['North Atlantic.jpeg','North Atlantic_3.JPG','Bell Island.jpeg','Portugal Cove.jpeg','Fai Haven.jpeg','Etretat.jpeg','Poch Cove.jpeg','Poch Cove_2.jpeg','Portbou.jpeg','North Atlantic_3 2.jpeg','Cereal.jpeg','North Atlantic_2.jpeg'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const idx=i=>(i+IMAGES.length)%IMAGES.length;
const feat={};
let ctx=null,master=null,osc1=null,osc2=null,filter=null,gain=null,running=false,playback=false,startMs=0,current=0;

function horizons(){return JSON.parse(localStorage.getItem('liquidCommonsHorizons')||'{}');}

async function analyse(file){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const w=96,h=72,c=document.createElement('canvas');c.width=w;c.height=h;
      const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0,w,h);
      const d=g.getImageData(0,0,w,h).data;
      const hr=clamp(Math.round((horizons()[file]??.5)*(h-1)),3,h-4);
      const lumAt=(x,y)=>{const i=(y*w+x)*4;return .2126*d[i]/255+.7152*d[i+1]/255+.0722*d[i+2]/255;};
      let strength=0,contrast=0;
      for(let x=0;x<w;x++){
        strength+=Math.abs(lumAt(x,hr-1)-lumAt(x,hr+1));
        const a=lumAt(x,Math.max(0,hr-4));
        const b=lumAt(x,Math.min(h-1,hr+4));
        contrast+=Math.abs(a-b);
      }
      strength=clamp((strength/w)/.20,0,1);
      contrast=clamp((contrast/w)/.30,0,1);
      resolve({strength,contrast});
    };
    img.onerror=()=>resolve({strength:.5,contrast:.4});
    img.src=encodeURI(`./public/images/${file}`);
  });
}

function weights(a,b,c,p){const A=.5*(1-p)*(1-p),B=.75-(p-.5)*(p-.5),C=.5*p*p,s=A+B+C;return[A/s,B/s,C/s];}
function blendedHorizon(a,b,c,p){const h=horizons(),[wa,wb,wc]=weights(a,b,c,p);return(h[IMAGES[idx(a)]]??.5)*wa+(h[IMAGES[idx(b)]]??.5)*wb+(h[IMAGES[idx(c)]]??.5)*wc;}
function blendedFeature(a,b,c,p,key){const [wa,wb,wc]=weights(a,b,c,p);const fa=feat[IMAGES[idx(a)]]||{strength:.5,contrast:.4},fb=feat[IMAGES[idx(b)]]||{strength:.5,contrast:.4},fc=feat[IMAGES[idx(c)]]||{strength:.5,contrast:.4};return fa[key]*wa+fb[key]*wb+fc[key]*wc;}

function apply(a,b,c,p){
  if(!ctx||ctx.state!=='running')return;
  const h=blendedHorizon(a,b,c,p);
  const strength=blendedFeature(a,b,c,p,'strength');
  const contrast=blendedFeature(a,b,c,p,'contrast');
  const now=ctx.currentTime;

  // One continuous low-brass horizon line.
  // Higher visual horizon -> slightly higher tone. Range is intentionally audible: ~43–58 Hz.
  const normalized=clamp((.85-h)/.70,0,1);
  const base=lerp(43.0,58.0,normalized);
  const cutoff=lerp(260,1250,strength);
  const level=lerp(0.014,0.050,contrast);
  const harmonicLevel=lerp(.12,.28,strength);

  osc1.frequency.setTargetAtTime(base,now,0.9);
  osc2.frequency.setTargetAtTime(base*2.003,now,0.9);
  osc2Gain.gain.setTargetAtTime(harmonicLevel,now,1.0);
  filter.frequency.setTargetAtTime(cutoff,now,1.0);
  gain.gain.setTargetAtTime(level,now,1.0);
  updateMonitor({h,base,strength,contrast,cutoff,level});
}

let osc2Gain=null;

function updateMonitor(q){
  const parent=document.querySelector('#soundMonitor');
  if(!parent)return;
  parent.style.gridTemplateColumns='1fr';
  parent.innerHTML=`<div><strong>HORIZON — CONTINUOUS LOW BRASS</strong><br>Frequency ${q.base.toFixed(2)} Hz<br>Horizon ${q.h.toFixed(3)}<br>Line strength ${q.strength.toFixed(3)}<br>Contrast ${q.contrast.toFixed(3)}<br>Timbre ${Math.round(q.cutoff)} Hz<br>Level ${q.level.toFixed(3)}</div>`;
}

async function analyseAll(){const entries=await Promise.all(IMAGES.map(async f=>[f,await analyse(f)]));entries.forEach(([k,v])=>feat[k]=v);}

async function init(){
  if(ctx){await ctx.resume();running=true;return;}
  ctx=new (window.AudioContext||window.webkitAudioContext)();
  master=ctx.createGain();master.gain.value=.62;master.connect(ctx.destination);
  osc1=ctx.createOscillator();osc2=ctx.createOscillator();osc2Gain=ctx.createGain();filter=ctx.createBiquadFilter();gain=ctx.createGain();
  osc1.type='sawtooth';osc2.type='triangle';
  osc1.frequency.value=49;osc2.frequency.value=98.15;
  osc2Gain.gain.value=.18;
  filter.type='lowpass';filter.frequency.value=650;filter.Q.value=.7;
  gain.gain.value=.0001;
  osc1.connect(filter);osc2.connect(osc2Gain);osc2Gain.connect(filter);filter.connect(gain);gain.connect(master);
  osc1.start();osc2.start();
  await ctx.resume();
  gain.gain.exponentialRampToValueAtTime(.025,ctx.currentTime+1.6);
  running=true;
  await analyseAll();
  applyCurrent();
}

function currentIndex(){const name=document.querySelector('#filename')?.textContent?.trim();const i=IMAGES.indexOf(name);return i>=0?i:current;}
function applyCurrent(){current=currentIndex();apply(current,current,current,.5);}

function loop(t){
  if(running&&playback&&ctx?.state==='running'){
    const dur=Math.max(12,+document.querySelector('#durationInput')?.value||58);
    const prog=(((t-startMs)/1000)%dur)/dur;
    const cycle=prog*IMAGES.length;
    const center=Math.floor(cycle)%IMAGES.length;
    const p=cycle-Math.floor(cycle);
    apply(center-1,center,center+1,p);
  }
  requestAnimationFrame(loop);
}

const oldBtn=document.querySelector('#soundProxy');
if(oldBtn){
  const clone=oldBtn.cloneNode(true);oldBtn.replaceWith(clone);clone.textContent='Start long tone';
  clone.addEventListener('click',async()=>{
    if(!ctx){await init();clone.textContent='Long tone: on';}
    else if(ctx.state==='running'){await ctx.suspend();clone.textContent='Long tone: off';}
    else{await ctx.resume();clone.textContent='Long tone: on';applyCurrent();}
  });
}

document.querySelector('#nextBtn')?.addEventListener('click',()=>setTimeout(applyCurrent,0));
document.querySelector('#prevBtn')?.addEventListener('click',()=>setTimeout(applyCurrent,0));
document.querySelector('#horizonSlider')?.addEventListener('change',async()=>{const f=IMAGES[currentIndex()];feat[f]=await analyse(f);applyCurrent();});
document.querySelector('#playBtn')?.addEventListener('click',()=>{playback=true;startMs=performance.now();});
document.querySelector('#exitPlayback')?.addEventListener('click',()=>{playback=false;setTimeout(applyCurrent,0);});
requestAnimationFrame(loop);
