const IMAGES=['North Atlantic.jpeg','North Atlantic_3.JPG','Bell Island.jpeg','Portugal Cove.jpeg','Fai Haven.jpeg','Etretat.jpeg','Poch Cove.jpeg','Poch Cove_2.jpeg','Portbou.jpeg','North Atlantic_3 2.jpeg','Cereal.jpeg','North Atlantic_2.jpeg'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const idx=i=>(i+IMAGES.length)%IMAGES.length;
const feat={};
let ctx=null,master=null,horns=[],lows=[];
let clarOsc=null,clarGain=null,clarFilter=null,clarPan=null,clarVib=null,clarVibDepth=null;
let fluteOsc=null,fluteAirOsc=null,fluteGain=null,fluteAirGain=null,fluteFilter=null,flutePan=null;
let breath=null,breathFilter=null,breathGain=null;
let wetGain=null,delay=null,convolver=null,wetFilter=null,swell=null,swellDepth=null;
let running=false,playback=false,startMs=0,current=0;

function horizons(){return JSON.parse(localStorage.getItem('liquidCommonsHorizons')||'{}');}

async function analyse(file){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const w=96,h=72,c=document.createElement('canvas');c.width=w;c.height=h;
      const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0,w,h);
      const d=g.getImageData(0,0,w,h).data;
      const hr=clamp(Math.round((horizons()[file]??.5)*(h-1)),5,h-4);
      const lumAt=(x,y)=>{const i=(y*w+x)*4;return .2126*d[i]/255+.7152*d[i+1]/255+.0722*d[i+2]/255;};
      let strength=0,contrast=0,sky=0,sea=0;
      for(let x=0;x<w;x++){
        strength+=Math.abs(lumAt(x,hr-1)-lumAt(x,hr+1));
        contrast+=Math.abs(lumAt(x,Math.max(0,hr-4))-lumAt(x,Math.min(h-1,hr+4)));
        sky+=lumAt(x,Math.max(0,hr-8));
        sea+=lumAt(x,Math.min(h-1,hr+8));
      }
      strength=clamp((strength/w)/.20,0,1);
      contrast=clamp((contrast/w)/.30,0,1);
      sky=clamp(sky/w,0,1); sea=clamp(sea/w,0,1);

      let best=-1,bestY=hr;
      for(let y=3;y<hr-2;y++){
        for(let x=4;x<w-4;x++){
          const center=lumAt(x,y); if(center<.62)continue;
          let ring=0,n=0;
          for(let oy=-4;oy<=4;oy+=4){for(let ox=-4;ox<=4;ox+=4){if(ox===0&&oy===0)continue;ring+=lumAt(x+ox,y+oy);n++;}}
          const score=Math.max(0,center-ring/n)*1.65+Math.max(0,center-.62)*.72;
          if(score>best){best=score;bestY=y;}
        }
      }
      const sun=clamp((best-.12)/.30,0,1);
      const sunY=clamp(bestY/Math.max(1,hr),0,1);
      resolve({strength,contrast,sky,sea,sun,sunY});
    };
    img.onerror=()=>resolve({strength:.5,contrast:.4,sky:.5,sea:.4,sun:0,sunY:1});
    img.src=encodeURI(`./public/images/${file}`);
  });
}

function weights(a,b,c,p){const A=.5*(1-p)*(1-p),B=.75-(p-.5)*(p-.5),C=.5*p*p,s=A+B+C;return[A/s,B/s,C/s];}
function blendedFeature(a,b,c,p,key){const [wa,wb,wc]=weights(a,b,c,p);const def={strength:.5,contrast:.4,sky:.5,sea:.4,sun:0,sunY:1};const fa=feat[IMAGES[idx(a)]]||def,fb=feat[IMAGES[idx(b)]]||def,fc=feat[IMAGES[idx(c)]]||def;return fa[key]*wa+fb[key]*wb+fc[key]*wc;}
function featureAt(i){return feat[IMAGES[idx(i)]]||{strength:.5,contrast:.4,sky:.5,sea:.4,sun:0,sunY:1};}

function noiseBuffer(context,seconds=4){
  const b=context.createBuffer(1,Math.floor(context.sampleRate*seconds),context.sampleRate),d=b.getChannelData(0);let prev=0;
  for(let i=0;i<d.length;i++){const white=Math.random()*2-1;prev=prev*.97+white*.03;d[i]=prev*.018;}
  return b;
}
function reverbBuffer(context,seconds=8.4,decay=4.0){
  const len=Math.floor(context.sampleRate*seconds),b=context.createBuffer(2,len,context.sampleRate);
  for(let ch=0;ch<2;ch++){const d=b.getChannelData(ch);for(let i=0;i<len;i++){const t=i/len;d[i]=(Math.random()*2-1)*Math.pow(1-t,decay)*(0.50+Math.random()*.20);}}
  return b;
}
function wave(context,partials){const real=new Float32Array(partials.length+1),imag=new Float32Array(partials.length+1);partials.forEach((v,i)=>imag[i+1]=v);return context.createPeriodicWave(real,imag,{disableNormalization:false});}

const hornPlan=[
  {detune:0,pan:0,threshold:0},{detune:2,pan:-.16,threshold:.18},{detune:-2.5,pan:.16,threshold:.34},
  {detune:4,pan:-.30,threshold:.50},{detune:-4.5,pan:.30,threshold:.66},{detune:5.5,pan:0,threshold:.82}
];
const lowPlan=[
  {ratio:.50,pan:-.18,threshold:.20},{ratio:.50,pan:.18,threshold:.42},{ratio:.25,pan:0,threshold:.66}
];
function rise(x,t,w=.22){return clamp((x-t)/w,0,1);}

function apply(a,b,c,p){
  if(!ctx||ctx.state!=='running')return;
  const strength=blendedFeature(a,b,c,p,'strength');
  const contrast=blendedFeature(a,b,c,p,'contrast');
  const sky=blendedFeature(a,b,c,p,'sky');
  const sea=blendedFeature(a,b,c,p,'sea');
  const sun=blendedFeature(a,b,c,p,'sun');
  const sunY=blendedFeature(a,b,c,p,'sunY');
  const now=ctx.currentTime;

  const clarity=clamp(strength*.76+contrast*.24,0,1);
  const brightness=clamp(sky*.62+sea*.18+contrast*.20,0,1);
  const darkness=1-brightness;
  const energy=clamp(contrast*.58+strength*.25+darkness*.17,0,1);
  const fb=featureAt(b),fc=featureAt(c);
  const cb=clamp(fb.strength*.76+fb.contrast*.24,0,1),cc=clamp(fc.strength*.76+fc.contrast*.24,0,1);
  const imageDelta=clamp((cc-cb)*.34+(fc.contrast-fb.contrast)*.26+(fc.sky-fb.sky)*.40,-1,1);
  const shape=Math.sin(Math.PI*clamp(p,0,1));

  // Higher, softer horn body.
  const base=262 + brightness*18 + contrast*10 + imageDelta*8*shape + Math.sin(now*.33)*(1-clarity)*1.8;
  const hornCut=lerp(900,1550,clarity*.55+brightness*.45);
  const principal=lerp(.012,.021,energy);
  let hornDensity=0;
  horns.forEach((v,i)=>{
    const act=i===0?1:rise(clarity,hornPlan[i].threshold,.22); hornDensity+=act;
    const level=i===0?principal:principal*lerp(.38,.58,energy)*act;
    v.osc.frequency.setTargetAtTime(base,now,.90);
    v.osc.detune.setTargetAtTime(hornPlan[i].detune,now,1.15);
    v.gain.gain.setTargetAtTime(level,now,1.15);
    v.filter.frequency.setTargetAtTime(hornCut*lerp(.96,1.04,i/5),now,1.25);
    v.pan.pan.setTargetAtTime(hornPlan[i].pan*act,now,1.3);
  });

  // Darkness grows a low orchestral foundation: bassoon / low brass-like layers.
  let lowDensity=0;
  lows.forEach((v,i)=>{
    const act=rise(darkness,lowPlan[i].threshold,.24); lowDensity+=act;
    v.osc.frequency.setTargetAtTime(base*lowPlan[i].ratio,now,1.15);
    v.gain.gain.setTargetAtTime(.012*act*lerp(.60,1.0,darkness),now,1.35);
    v.filter.frequency.setTargetAtTime(lerp(480,850,1-darkness),now,1.45);
    v.pan.pan.setTargetAtTime(lowPlan[i].pan*act,now,1.4);
  });

  // Clarinet: higher, warm, long upward line.
  const morning=clamp(brightness*.72+contrast*.18+(1-sea)*.10,0,1);
  const clarRatio=clamp(lerp(1.28,1.55,Math.pow(morning,.78))+Math.max(0,imageDelta)*.07*shape+Math.min(0,imageDelta)*.025*shape,1.27,1.57);
  const clarFreq=base*clarRatio;
  clarOsc.frequency.setTargetAtTime(clarFreq,now,2.0);
  clarGain.gain.setTargetAtTime(lerp(.0065,.0105,.45+morning*.55)*(1-sun*.15),now,1.6);
  clarFilter.frequency.setTargetAtTime(lerp(1200,1850,brightness),now,1.7);
  clarPan.pan.setTargetAtTime(clamp(imageDelta*.10,-.09,.09),now,1.9);
  clarVibDepth.gain.setTargetAtTime(lerp(.08,.20,1-clarity),now,1.8);

  // Sun = flute. Light, breathy, hopeful; fifth -> major sixth -> soft major seventh region, never piercing.
  const sunPresence=clamp((sun-.10)/.90,0,1);
  const height=1-clamp(sunY,0,1);
  const fluteRatio=lerp(1.50,lerp(1.667,1.875,height),Math.pow(sunPresence,.78));
  const fluteFreq=base*fluteRatio;
  const fluteLevel=.0075*Math.pow(sunPresence,1.30);
  fluteOsc.frequency.setTargetAtTime(fluteFreq,now,1.35);
  fluteAirOsc.frequency.setTargetAtTime(fluteFreq*2.0,now,1.35);
  fluteGain.gain.setTargetAtTime(fluteLevel,now,1.45);
  fluteAirGain.gain.setTargetAtTime(fluteLevel*.045,now,1.45);
  fluteFilter.frequency.setTargetAtTime(lerp(1700,2700,sunPresence),now,1.55);
  flutePan.pan.setTargetAtTime(lerp(-.03,.05,height),now,1.6);

  const wet=lerp(.68,.82,darkness*.30+(1-clarity)*.24+sunPresence*.10);
  wetGain.gain.setTargetAtTime(wet,now,1.5);
  wetFilter.frequency.setTargetAtTime(lerp(900,1550,brightness),now,1.5);
  breathGain.gain.setTargetAtTime(lerp(.00012,.000025,clarity),now,1.6);
  breathFilter.frequency.setTargetAtTime(lerp(700,1000,brightness),now,1.6);
  swellDepth.gain.setTargetAtTime(lerp(.006,.035,energy),now,1.7);

  updateMonitor({base,clarFreq,fluteFreq,sun:sunPresence,hornDensity,lowDensity,brightness,darkness,clarity,contrast});
}

function updateMonitor(q){
  const el=document.querySelector('#soundMonitor'); if(!el)return;
  el.style.gridTemplateColumns='1fr';
  el.innerHTML=`<div><strong>HORIZON ORCHESTRA — SOFT MORNING</strong><br>Horn ${q.base.toFixed(1)} Hz · ${q.hornDensity.toFixed(1)} / 6<br>Low orchestra ${q.lowDensity.toFixed(1)} / 3 · darkness ${q.darkness.toFixed(2)}<br>Clarinet ${q.clarFreq.toFixed(1)} Hz<br>Sun flute ${q.sun.toFixed(2)}${q.sun>.03?` · ${q.fluteFreq.toFixed(1)} Hz`:''}<br>Brightness ${q.brightness.toFixed(2)} · clarity ${q.clarity.toFixed(2)} · contrast ${q.contrast.toFixed(2)}</div>`;
}

async function analyseAll(){const entries=await Promise.all(IMAGES.map(async f=>[f,await analyse(f)]));entries.forEach(([k,v])=>feat[k]=v);}

async function init(){
  if(ctx){await ctx.resume();running=true;return;}
  ctx=new (window.AudioContext||window.webkitAudioContext)();
  master=ctx.createGain();master.gain.value=.46;master.connect(ctx.destination);

  delay=ctx.createDelay(.9);delay.delayTime.value=.20;
  convolver=ctx.createConvolver();convolver.buffer=reverbBuffer(ctx);
  wetFilter=ctx.createBiquadFilter();wetFilter.type='lowpass';wetFilter.frequency.value=1250;wetFilter.Q.value=.18;
  wetGain=ctx.createGain();wetGain.gain.value=.72;
  delay.connect(convolver);convolver.connect(wetFilter);wetFilter.connect(wetGain);wetGain.connect(master);

  const hornWave=wave(ctx,[1,.26,.13,.065,.030,.014,.007]);
  horns=hornPlan.map((plan,i)=>{
    const osc=ctx.createOscillator();osc.setPeriodicWave(hornWave);osc.frequency.value=270;osc.detune.value=plan.detune;
    const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=1250;filter.Q.value=.20;
    const gain=ctx.createGain();gain.gain.value=i===0?.012:.0001;
    const pan=ctx.createStereoPanner();pan.pan.value=plan.pan;
    osc.connect(filter);filter.connect(gain);gain.connect(pan);pan.connect(master);pan.connect(delay);osc.start();
    return {osc,filter,gain,pan};
  });

  const lowWave=wave(ctx,[1,.34,.18,.09,.04,.018]);
  lows=lowPlan.map(plan=>{
    const osc=ctx.createOscillator();osc.setPeriodicWave(lowWave);osc.frequency.value=132;
    const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=620;filter.Q.value=.18;
    const gain=ctx.createGain();gain.gain.value=.0001;
    const pan=ctx.createStereoPanner();pan.pan.value=plan.pan;
    osc.connect(filter);filter.connect(gain);gain.connect(pan);pan.connect(master);pan.connect(delay);osc.start();
    return {osc,filter,gain,pan};
  });

  clarOsc=ctx.createOscillator();clarOsc.setPeriodicWave(wave(ctx,[1,0,.30,0,.11,0,.04,0,.015]));clarOsc.frequency.value=370;
  clarGain=ctx.createGain();clarGain.gain.value=.0001;
  clarFilter=ctx.createBiquadFilter();clarFilter.type='lowpass';clarFilter.frequency.value=1550;clarFilter.Q.value=.28;
  clarPan=ctx.createStereoPanner();
  clarOsc.connect(clarFilter);clarFilter.connect(clarGain);clarGain.connect(clarPan);clarPan.connect(master);clarPan.connect(delay);
  clarVib=ctx.createOscillator();clarVib.type='sine';clarVib.frequency.value=4.0;
  clarVibDepth=ctx.createGain();clarVibDepth.gain.value=.12;clarVib.connect(clarVibDepth);clarVibDepth.connect(clarOsc.frequency);
  clarOsc.start();clarVib.start();

  // Flute-like: strong fundamental, very restrained upper partials + a tiny airy layer.
  fluteOsc=ctx.createOscillator();fluteOsc.setPeriodicWave(wave(ctx,[1,.10,.035,.012,.005]));fluteOsc.frequency.value=440;
  fluteAirOsc=ctx.createOscillator();fluteAirOsc.type='sine';fluteAirOsc.frequency.value=880;
  fluteGain=ctx.createGain();fluteGain.gain.value=.0001;
  fluteAirGain=ctx.createGain();fluteAirGain.gain.value=.0001;
  fluteFilter=ctx.createBiquadFilter();fluteFilter.type='lowpass';fluteFilter.frequency.value=2200;fluteFilter.Q.value=.16;
  flutePan=ctx.createStereoPanner();
  fluteOsc.connect(fluteGain);fluteAirOsc.connect(fluteAirGain);fluteGain.connect(fluteFilter);fluteAirGain.connect(fluteFilter);fluteFilter.connect(flutePan);flutePan.connect(master);flutePan.connect(delay);
  fluteOsc.start();fluteAirOsc.start();

  breath=ctx.createBufferSource();breath.buffer=noiseBuffer(ctx);breath.loop=true;
  breathFilter=ctx.createBiquadFilter();breathFilter.type='bandpass';breathFilter.frequency.value=820;breathFilter.Q.value=.30;
  breathGain=ctx.createGain();breathGain.gain.value=.00006;
  breath.connect(breathFilter);breathFilter.connect(breathGain);breathGain.connect(delay);breath.start();

  swell=ctx.createOscillator();swell.type='sine';swell.frequency.value=.070;
  swellDepth=ctx.createGain();swellDepth.gain.value=.018;swell.connect(swellDepth);swellDepth.connect(master.gain);swell.start();

  await ctx.resume();running=true;await analyseAll();applyCurrent();
}

function currentIndex(){const name=document.querySelector('#filename')?.textContent?.trim();const i=IMAGES.indexOf(name);return i>=0?i:current;}
function applyCurrent(){current=currentIndex();apply(current,current,current,.5);}
function loop(t){
  if(running&&playback&&ctx?.state==='running'){
    const dur=Math.max(12,+document.querySelector('#durationInput')?.value||58);
    const prog=(((t-startMs)/1000)%dur)/dur,cycle=prog*IMAGES.length,center=Math.floor(cycle)%IMAGES.length,p=cycle-Math.floor(cycle);
    apply(center-1,center,center+1,p);
  }
  requestAnimationFrame(loop);
}

const oldBtn=document.querySelector('#soundProxy');
if(oldBtn){
  const clone=oldBtn.cloneNode(true);oldBtn.replaceWith(clone);clone.textContent='Start soft horizon orchestra';
  clone.addEventListener('click',async()=>{
    if(!ctx){await init();clone.textContent='Soft orchestra: on';}
    else if(ctx.state==='running'){await ctx.suspend();clone.textContent='Soft orchestra: off';}
    else{await ctx.resume();clone.textContent='Soft orchestra: on';applyCurrent();}
  });
}
document.querySelector('#nextBtn')?.addEventListener('click',()=>setTimeout(applyCurrent,0));
document.querySelector('#prevBtn')?.addEventListener('click',()=>setTimeout(applyCurrent,0));
document.querySelector('#horizonSlider')?.addEventListener('change',async()=>{const f=IMAGES[currentIndex()];feat[f]=await analyse(f);applyCurrent();});
document.querySelector('#playBtn')?.addEventListener('click',()=>{playback=true;startMs=performance.now();});
document.querySelector('#exitPlayback')?.addEventListener('click',()=>{playback=false;setTimeout(applyCurrent,0);});
requestAnimationFrame(loop);
