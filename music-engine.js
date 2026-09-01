const IMAGES=['North Atlantic.jpeg','North Atlantic_3.JPG','Bell Island.jpeg','Portugal Cove.jpeg','Fai Haven.jpeg','Etretat.jpeg','Poch Cove.jpeg','Poch Cove_2.jpeg','Portbou.jpeg','North Atlantic_3 2.jpeg','Cereal.jpeg','North Atlantic_2.jpeg'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const idx=i=>(i+IMAGES.length)%IMAGES.length;
const feat={};
let ctx=null,master=null;
let oboeOsc=null,oboeGain=null,oboeFilter=null;
let sopranoOsc=null,sopranoGain=null,sopranoFilter=null;
let tenorOsc=null,tenorGain=null,tenorFilter=null;
let tromboneOsc=null,tromboneGain=null,tromboneFilter=null,subOsc=null,subGain=null;
let breath=null,breathFilter=null,breathGain=null;
let vibrato=null,vibratoDepth=null,swell=null,swellDepth=null;
let dryGain=null,wetGain=null,delay=null,convolver=null,wetFilter=null,stereoDelay=null,stereoMerge=null;
let running=false,playback=false,startMs=0,current=0;

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

function noiseBuffer(context,seconds=4){
  const b=context.createBuffer(1,Math.floor(context.sampleRate*seconds),context.sampleRate);
  const d=b.getChannelData(0);let prev=0;
  for(let i=0;i<d.length;i++){const white=Math.random()*2-1;prev=prev*.94+white*.06;d[i]=prev*.040;}
  return b;
}

function reverbBuffer(context,seconds=7.2,decay=3.45){
  const length=Math.floor(context.sampleRate*seconds);
  const b=context.createBuffer(2,length,context.sampleRate);
  for(let ch=0;ch<2;ch++){
    const d=b.getChannelData(ch);
    for(let i=0;i<length;i++){
      const t=i/length;
      d[i]=(Math.random()*2-1)*Math.pow(1-t,decay)*(0.68+Math.random()*.30);
    }
  }
  return b;
}

function timbreWeights(strength,contrast){
  const x=clamp(strength*.62+contrast*.38,0,1);
  const bell=(center,width)=>Math.exp(-Math.pow((x-center)/width,2));
  let o=bell(.10,.25),s=bell(.38,.24),t=bell(.66,.25),r=bell(.92,.25);
  const sum=o+s+t+r;
  return {oboe:o/sum,soprano:s/sum,tenor:t/sum,trombone:r/sum};
}

function apply(a,b,c,p){
  if(!ctx||ctx.state!=='running')return;
  const h=blendedHorizon(a,b,c,p);
  const strength=blendedFeature(a,b,c,p,'strength');
  const contrast=blendedFeature(a,b,c,p,'contrast');
  const now=ctx.currentTime;

  const normalized=clamp((.85-h)/.70,0,1);
  const base=lerp(190,380,Math.pow(normalized,.80));
  const tw=timbreWeights(strength,contrast);
  const energy=clamp(contrast*.72+strength*.28,0,1);
  const openness=clamp(strength*.75+contrast*.25,0,1);

  oboeOsc.frequency.setTargetAtTime(base*1.004,now,.55);
  sopranoOsc.frequency.setTargetAtTime(base*1.002,now,.55);
  tenorOsc.frequency.setTargetAtTime(base*.997,now,.55);
  tromboneOsc.frequency.setTargetAtTime(base*.995,now,.55);
  subOsc.frequency.setTargetAtTime(base*.50,now,.68);

  oboeGain.gain.setTargetAtTime(tw.oboe*lerp(.018,.034,energy),now,.9);
  sopranoGain.gain.setTargetAtTime(tw.soprano*lerp(.020,.038,energy),now,.9);
  tenorGain.gain.setTargetAtTime(tw.tenor*lerp(.023,.044,energy),now,.9);
  tromboneGain.gain.setTargetAtTime(tw.trombone*lerp(.028,.054,energy),now,.9);
  subGain.gain.setTargetAtTime(tw.trombone*lerp(.008,.050,energy),now,1.0);

  oboeFilter.frequency.setTargetAtTime(lerp(1250,2700,openness),now,1.0);
  sopranoFilter.frequency.setTargetAtTime(lerp(1500,3300,openness),now,1.0);
  tenorFilter.frequency.setTargetAtTime(lerp(900,2200,openness),now,1.0);
  tromboneFilter.frequency.setTargetAtTime(lerp(650,1800,openness),now,1.0);

  breathGain.gain.setTargetAtTime(lerp(.00005,.00032,1-tw.trombone),now,1.2);
  breathFilter.frequency.setTargetAtTime(lerp(700,1500,tw.oboe+tw.soprano),now,1.2);

  const wet=lerp(.52,.86,clamp((1-strength)*.42+contrast*.58,0,1));
  wetGain.gain.setTargetAtTime(wet,now,1.2);
  dryGain.gain.setTargetAtTime(lerp(.48,.20,wet),now,1.2);
  wetFilter.frequency.setTargetAtTime(lerp(850,1900,openness),now,1.2);
  stereoDelay.delayTime.setTargetAtTime(lerp(.012,.050,energy),now,1.2);
  vibratoDepth.gain.setTargetAtTime(lerp(.04,.34,contrast),now,1.2);
  swellDepth.gain.setTargetAtTime(lerp(.015,.13,energy),now,1.2);

  updateMonitor({h,base,strength,contrast,tw,wet});
}

function updateMonitor(q){
  const parent=document.querySelector('#soundMonitor');if(!parent)return;
  const dominant=Object.entries(q.tw).sort((a,b)=>b[1]-a[1])[0][0];
  parent.style.gridTemplateColumns='1fr';
  parent.innerHTML=`<div><strong>HORIZON — BOLÉRO-INSPIRED TIMBRE MORPH</strong><br>Frequency ${q.base.toFixed(1)} Hz<br>Horizon ${q.h.toFixed(3)}<br>Line strength ${q.strength.toFixed(3)}<br>Contrast ${q.contrast.toFixed(3)}<br>Dominant colour: ${dominant}<br>Oboe ${q.tw.oboe.toFixed(2)} · Soprano sax ${q.tw.soprano.toFixed(2)} · Tenor sax ${q.tw.tenor.toFixed(2)} · Trombone ${q.tw.trombone.toFixed(2)}<br>Distance / reverb ${q.wet.toFixed(2)}</div>`;
}

async function analyseAll(){const entries=await Promise.all(IMAGES.map(async f=>[f,await analyse(f)]));entries.forEach(([k,v])=>feat[k]=v);}

async function init(){
  if(ctx){await ctx.resume();running=true;return;}
  ctx=new (window.AudioContext||window.webkitAudioContext)();
  master=ctx.createGain();master.gain.value=.62;master.connect(ctx.destination);

  oboeOsc=ctx.createOscillator();sopranoOsc=ctx.createOscillator();tenorOsc=ctx.createOscillator();tromboneOsc=ctx.createOscillator();subOsc=ctx.createOscillator();
  oboeGain=ctx.createGain();sopranoGain=ctx.createGain();tenorGain=ctx.createGain();tromboneGain=ctx.createGain();subGain=ctx.createGain();
  oboeFilter=ctx.createBiquadFilter();sopranoFilter=ctx.createBiquadFilter();tenorFilter=ctx.createBiquadFilter();tromboneFilter=ctx.createBiquadFilter();

  oboeOsc.type='sawtooth';sopranoOsc.type='triangle';tenorOsc.type='triangle';tromboneOsc.type='sine';subOsc.type='sine';
  [oboeOsc,sopranoOsc,tenorOsc,tromboneOsc].forEach(o=>o.frequency.value=270);subOsc.frequency.value=135;
  oboeGain.gain.value=sopranoGain.gain.value=tenorGain.gain.value=tromboneGain.gain.value=.0001;subGain.gain.value=.0001;

  oboeFilter.type='bandpass';oboeFilter.frequency.value=1900;oboeFilter.Q.value=1.4;
  sopranoFilter.type='lowpass';sopranoFilter.frequency.value=2400;sopranoFilter.Q.value=.55;
  tenorFilter.type='lowpass';tenorFilter.frequency.value=1600;tenorFilter.Q.value=.70;
  tromboneFilter.type='lowpass';tromboneFilter.frequency.value=1100;tromboneFilter.Q.value=.45;

  oboeOsc.connect(oboeFilter);oboeFilter.connect(oboeGain);
  sopranoOsc.connect(sopranoFilter);sopranoFilter.connect(sopranoGain);
  tenorOsc.connect(tenorFilter);tenorFilter.connect(tenorGain);
  tromboneOsc.connect(tromboneFilter);tromboneFilter.connect(tromboneGain);
  subOsc.connect(subGain);

  dryGain=ctx.createGain();wetGain=ctx.createGain();delay=ctx.createDelay(.7);convolver=ctx.createConvolver();wetFilter=ctx.createBiquadFilter();
  stereoDelay=ctx.createDelay(.09);stereoMerge=ctx.createChannelMerger(2);
  dryGain.gain.value=.32;wetGain.gain.value=.70;delay.delayTime.value=.17;convolver.buffer=reverbBuffer(ctx);
  wetFilter.type='lowpass';wetFilter.frequency.value=1350;wetFilter.Q.value=.28;
  stereoDelay.delayTime.value=.025;

  [oboeGain,sopranoGain,tenorGain,tromboneGain,subGain].forEach(g=>{g.connect(dryGain);g.connect(delay);});
  dryGain.connect(stereoMerge,0,0);dryGain.connect(stereoDelay);stereoDelay.connect(stereoMerge,0,1);stereoMerge.connect(master);
  delay.connect(convolver);convolver.connect(wetFilter);wetFilter.connect(wetGain);wetGain.connect(master);

  breath=ctx.createBufferSource();breath.buffer=noiseBuffer(ctx);breath.loop=true;
  breathFilter=ctx.createBiquadFilter();breathFilter.type='bandpass';breathFilter.frequency.value=950;breathFilter.Q.value=.55;
  breathGain=ctx.createGain();breathGain.gain.value=.00015;
  breath.connect(breathFilter);breathFilter.connect(breathGain);breathGain.connect(delay);

  vibrato=ctx.createOscillator();vibrato.type='sine';vibrato.frequency.value=2.7;
  vibratoDepth=ctx.createGain();vibratoDepth.gain.value=.12;
  vibrato.connect(vibratoDepth);
  [oboeOsc,sopranoOsc,tenorOsc,tromboneOsc].forEach(o=>vibratoDepth.connect(o.frequency));

  swell=ctx.createOscillator();swell.type='sine';swell.frequency.value=.085;
  swellDepth=ctx.createGain();swellDepth.gain.value=.045;
  swell.connect(swellDepth);swellDepth.connect(master.gain);

  oboeOsc.start();sopranoOsc.start();tenorOsc.start();tromboneOsc.start();subOsc.start();breath.start();vibrato.start();swell.start();
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
  const clone=oldBtn.cloneNode(true);oldBtn.replaceWith(clone);clone.textContent='Start Boléro horizon';
  clone.addEventListener('click',async()=>{
    if(!ctx){await init();clone.textContent='Boléro horizon: on';}
    else if(ctx.state==='running'){await ctx.suspend();clone.textContent='Boléro horizon: off';}
    else{await ctx.resume();clone.textContent='Boléro horizon: on';applyCurrent();}
  });
}

document.querySelector('#nextBtn')?.addEventListener('click',()=>setTimeout(applyCurrent,0));
document.querySelector('#prevBtn')?.addEventListener('click',()=>setTimeout(applyCurrent,0));
document.querySelector('#horizonSlider')?.addEventListener('change',async()=>{const f=IMAGES[currentIndex()];feat[f]=await analyse(f);applyCurrent();});
document.querySelector('#playBtn')?.addEventListener('click',()=>{playback=true;startMs=performance.now();});
document.querySelector('#exitPlayback')?.addEventListener('click',()=>{playback=false;setTimeout(applyCurrent,0);});
requestAnimationFrame(loop);
