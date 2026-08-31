const images = [
  'North Atlantic.jpeg','North Atlantic_3.JPG','Bell Island.jpeg','Portugal Cove.jpeg','Fai Haven.jpeg','Etretat.jpeg','Poch Cove.jpeg','Poch Cove_2.jpeg','Portbou.jpeg','North Atlantic_3 2.jpeg','Cereal.jpeg','North Atlantic_2.jpeg'
];

const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const lerp = (a,b,t) => a + (b-a)*t;
const idx = i => (i + images.length) % images.length;
const features = {};

let ctx, master, oscA, oscB, toneFilter, airNoise, airFilter, airGain;
let started = false;
let playback = false;
let playbackStart = 0;
let duration = 58;
let current = 0;

function horizons(){
  return JSON.parse(localStorage.getItem('liquidCommonsHorizons') || '{}');
}

async function analyse(file){
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const w=64,h=64,c=document.createElement('canvas');
      c.width=w;c.height=h;
      const g=c.getContext('2d',{willReadFrequently:true});
      g.drawImage(img,0,0,w,h);
      const d=g.getImageData(0,0,w,h).data;
      let sum=0,sum2=0,n=0;
      for(let i=0;i<d.length;i+=4){
        const r=d[i]/255,gg=d[i+1]/255,b=d[i+2]/255;
        const l=.2126*r+.7152*gg+.0722*b;
        sum+=l;sum2+=l*l;n++;
      }
      const brightness=sum/n;
      const variance=Math.max(0,sum2/n-brightness*brightness);
      const contrast=clamp(Math.sqrt(variance)/0.28,0,1);
      resolve({brightness,contrast});
    };
    img.onerror=()=>resolve({brightness:.5,contrast:.3});
    img.src=encodeURI(`./public/images/${file}`);
  });
}

async function analyseAll(){
  await Promise.all(images.map(async f => { features[f]=await analyse(f); }));
  updateNow();
}

function noiseBuffer(context,seconds=4){
  const b=context.createBuffer(1,context.sampleRate*seconds,context.sampleRate);
  const d=b.getChannelData(0);
  for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*.35;
  return b;
}

async function init(){
  if(ctx){ await ctx.resume(); return; }
  ctx=new (window.AudioContext||window.webkitAudioContext)();
  master=ctx.createGain();
  master.gain.value=.26;
  master.connect(ctx.destination);

  oscA=ctx.createOscillator();
  oscB=ctx.createOscillator();
  toneFilter=ctx.createBiquadFilter();
  const toneGain=ctx.createGain();
  oscA.type='sine';oscB.type='sine';
  oscA.frequency.value=110;oscB.frequency.value=110.08;
  toneFilter.type='lowpass';toneFilter.frequency.value=250;toneFilter.Q.value=.5;
  toneGain.gain.value=.025;
  oscA.connect(toneFilter);oscB.connect(toneFilter);toneFilter.connect(toneGain);toneGain.connect(master);

  airNoise=ctx.createBufferSource();
  airNoise.buffer=noiseBuffer(ctx);airNoise.loop=true;
  airFilter=ctx.createBiquadFilter();airFilter.type='highpass';airFilter.frequency.value=4200;
  airGain=ctx.createGain();airGain.gain.value=.004;
  airNoise.connect(airFilter);airFilter.connect(airGain);airGain.connect(master);

  oscA.start();oscB.start();airNoise.start();
  await ctx.resume();
  started=true;
  analyseAll();
  requestAnimationFrame(loop);
}

function blend(a,b,c,p){
  const fa=features[images[idx(a)]]||{brightness:.5,contrast:.3};
  const fb=features[images[idx(b)]]||{brightness:.5,contrast:.3};
  const fc=features[images[idx(c)]]||{brightness:.5,contrast:.3};
  const wa0=.5*(1-p)*(1-p), wb0=.75-(p-.5)*(p-.5), wc0=.5*p*p;
  const s=wa0+wb0+wc0,wa=wa0/s,wb=wb0/s,wc=wc0/s;
  return {
    brightness:fa.brightness*wa+fb.brightness*wb+fc.brightness*wc,
    contrast:fa.contrast*wa+fb.contrast*wb+fc.contrast*wc
  };
}

function blendedHorizon(a,b,c,p){
  const h=horizons();
  const ha=h[images[idx(a)]]??.5,hb=h[images[idx(b)]]??.5,hc=h[images[idx(c)]]??.5;
  const wa0=.5*(1-p)*(1-p), wb0=.75-(p-.5)*(p-.5), wc0=.5*p*p;
  const s=wa0+wb0+wc0;
  return (ha*wa0+hb*wb0+hc*wc0)/s;
}

function apply(a,b,c,p){
  if(!ctx||ctx.state!=='running') return;
  const f=blend(a,b,c,p);
  const horizon=blendedHorizon(a,b,c,p);
  const now=ctx.currentTime;

  // Horizon position: only a tiny ±0.35 Hz drift around 110 Hz.
  const drift=(horizon-.5)*.70;
  const base=110+drift;

  // Contrast: more internal tension and beating, never a melodic interval.
  const beat=lerp(.045,.14,f.contrast);
  oscA.frequency.setTargetAtTime(base,now,1.1);
  oscB.frequency.setTargetAtTime(base+beat,now,1.1);

  // Brightness: opens the spectrum instead of simply getting louder.
  const lpf=lerp(205,350,f.brightness);
  toneFilter.frequency.setTargetAtTime(lpf,now,1.25);
  const airHz=lerp(3600,8200,f.brightness);
  const airLevel=lerp(.0025,.0105,clamp(f.brightness*.82+f.contrast*.18,0,1));
  airFilter.frequency.setTargetAtTime(airHz,now,1.35);
  airGain.gain.setTargetAtTime(airLevel,now,1.35);

  updateMonitor(f,horizon,drift,beat,lpf,airHz);
}

function monitorNode(){
  let box=document.querySelector('#detailMonitor');
  if(box) return box;
  const parent=document.querySelector('#soundMonitor');
  if(!parent) return null;
  box=document.createElement('div');
  box.id='detailMonitor';
  box.innerHTML='<strong>IMAGE → SOUND</strong><br>Brightness <span id="dBrightness">—</span><br>Contrast <span id="dContrast">—</span><br>Horizon <span id="dHorizon">—</span><br>Pitch drift <span id="dDrift">—</span> Hz<br>Beat target <span id="dBeat">—</span> Hz';
  parent.appendChild(box);
  parent.style.gridTemplateColumns='repeat(5,minmax(120px,1fr))';
  return box;
}

function updateMonitor(f,horizon,drift,beat,lpf,airHz){
  monitorNode();
  const set=(id,v)=>{const e=document.querySelector(id);if(e)e.textContent=v;};
  set('#dBrightness',f.brightness.toFixed(3));
  set('#dContrast',f.contrast.toFixed(3));
  set('#dHorizon',horizon.toFixed(3));
  set('#dDrift',(drift>=0?'+':'')+drift.toFixed(3));
  set('#dBeat',beat.toFixed(3));
}

function currentIndex(){
  const name=document.querySelector('#filename')?.textContent?.trim();
  const i=images.indexOf(name);
  return i>=0?i:current;
}

function updateNow(){
  current=currentIndex();
  apply(current,current,current,.5);
}

function loop(t){
  if(started&&playback&&ctx?.state==='running'){
    const progress=((t-playbackStart)/1000%duration)/duration;
    const cycle=progress*images.length;
    const center=Math.floor(cycle)%images.length;
    const p=cycle-Math.floor(cycle);
    apply(center-1,center,center+1,p);
  }
  requestAnimationFrame(loop);
}

const soundBtn=document.querySelector('#soundProxy');
const nextBtn=document.querySelector('#nextBtn');
const prevBtn=document.querySelector('#prevBtn');
const playBtn=document.querySelector('#playBtn');
const exitBtn=document.querySelector('#exitPlayback');
const slider=document.querySelector('#horizonSlider');
const durationInput=document.querySelector('#durationInput');

monitorNode();
soundBtn?.addEventListener('click',async()=>{
  if(!ctx){await init();setTimeout(updateNow,50);return;}
  if(ctx.state==='running') await ctx.suspend(); else {await ctx.resume();updateNow();}
});
nextBtn?.addEventListener('click',()=>setTimeout(updateNow,0));
prevBtn?.addEventListener('click',()=>setTimeout(updateNow,0));
slider?.addEventListener('input',()=>setTimeout(updateNow,0));
playBtn?.addEventListener('click',()=>{playback=true;playbackStart=performance.now();duration=Math.max(12,+durationInput?.value||58);});
exitBtn?.addEventListener('click',()=>{playback=false;setTimeout(updateNow,0);});
