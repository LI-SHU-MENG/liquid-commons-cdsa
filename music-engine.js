const IMAGES=['North Atlantic.jpeg','North Atlantic_3.JPG','Bell Island.jpeg','Portugal Cove.jpeg','Fai Haven.jpeg','Etretat.jpeg','Poch Cove.jpeg','Poch Cove_2.jpeg','Portbou.jpeg','North Atlantic_3 2.jpeg','Cereal.jpeg','North Atlantic_2.jpeg'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const idx=i=>(i+IMAGES.length)%IMAGES.length;
const feat={};
let ctx=null,master=null,osc1=null,osc2=null,osc2Gain=null,subOsc=null,subGain=null,filter=null,gain=null;
let breath=null,breathFilter=null,breathGain=null,vibrato=null,vibratoDepth=null,swell=null,swellDepth=null;
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
  for(let i=0;i<d.length;i++){const white=Math.random()*2-1;prev=prev*.93+white*.07;d[i]=prev*.050;}
  return b;
}

function reverbBuffer(context,seconds=7.4,decay=3.35){
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

function apply(a,b,c,p){
  if(!ctx||ctx.state!=='running')return;
  const h=blendedHorizon(a,b,c,p);
  const strength=blendedFeature(a,b,c,p,'strength');
  const contrast=blendedFeature(a,b,c,p,'contrast');
  const now=ctx.currentTime;

  const normalized=clamp((.85-h)/.70,0,1);
  const shaped=Math.pow(normalized,.80);
  const base=lerp(190,380,shaped);
  const openness=clamp(strength*.78+contrast*.22,0,1);
  const energy=clamp(contrast*.72+strength*.28,0,1);

  const cutoff=lerp(760,2850,openness);
  const level=lerp(.010,.042,energy);
  const harmonicLevel=lerp(.055,.235,openness);
  const subLevel=lerp(.010,.072,energy);
  const breathLevel=lerp(.00007,.00045,openness);
  const vibHz=lerp(2.15,3.25,contrast);
  const vibDepth=lerp(.04,.52,contrast);
  const swellAmount=lerp(.015,.16,energy);
  const wet=lerp(.48,.86,clamp((1-strength)*.42+contrast*.58,0,1));
  const wetCutoff=lerp(760,2100,openness);
  const stereoWidth=lerp(.010,.052,energy);

  osc1.frequency.setTargetAtTime(base,now,.52);
  osc2.frequency.setTargetAtTime(base*2.0025,now,.52);
  subOsc.frequency.setTargetAtTime(base*.5,now,.62);
  osc2Gain.gain.setTargetAtTime(harmonicLevel,now,.85);
  subGain.gain.setTargetAtTime(subLevel,now,.95);
  filter.frequency.setTargetAtTime(cutoff,now,.82);
  gain.gain.setTargetAtTime(level,now,.95);
  breathFilter.frequency.setTargetAtTime(lerp(560,1320,openness),now,1.0);
  breathGain.gain.setTargetAtTime(breathLevel,now,1.2);
  vibrato.frequency.setTargetAtTime(vibHz,now,1.15);
  vibratoDepth.gain.setTargetAtTime(vibDepth,now,1.15);
  swellDepth.gain.setTargetAtTime(swellAmount,now,1.15);
  wetGain.gain.setTargetAtTime(wet,now,1.15);
  dryGain.gain.setTargetAtTime(lerp(.50,.18,wet),now,1.15);
  wetFilter.frequency.setTargetAtTime(wetCutoff,now,1.15);
  stereoDelay.delayTime.setTargetAtTime(stereoWidth,now,1.15);
  updateMonitor({h,base,strength,contrast,cutoff,level,wet,vibHz,vibDepth,breathLevel,subLevel,swellAmount,stereoWidth});
}

function updateMonitor(q){
  const parent=document.querySelector('#soundMonitor');if(!parent)return;
  parent.style.gridTemplateColumns='1fr';
  parent.innerHTML=`<div><strong>HORIZON — GRAND DISTANT HORN / HIGH VARIATION</strong><br>Frequency ${q.base.toFixed(1)} Hz<br>Horizon ${q.h.toFixed(3)}<br>Line strength ${q.strength.toFixed(3)}<br>Contrast ${q.contrast.toFixed(3)}<br>Body / filter ${Math.round(q.cutoff)} Hz<br>Distance / reverb ${q.wet.toFixed(2)}<br>Sub body ${q.subLevel.toFixed(3)}<br>Swell ${q.swellAmount.toFixed(3)}<br>Stereo width ${q.stereoWidth.toFixed(3)} s<br>Breath ${q.breathLevel.toFixed(4)}<br>Vibrato ${q.vibHz.toFixed(1)} Hz / ${q.vibDepth.toFixed(2)} Hz</div>`;
}

async function analyseAll(){const entries=await Promise.all(IMAGES.map(async f=>[f,await analyse(f)]));entries.forEach(([k,v])=>feat[k]=v);}

async function init(){
  if(ctx){await ctx.resume();running=true;return;}
  ctx=new (window.AudioContext||window.webkitAudioContext)();
  master=ctx.createGain();master.gain.value=.56;master.connect(ctx.destination);

  osc1=ctx.createOscillator();osc2=ctx.createOscillator();subOsc=ctx.createOscillator();
  osc2Gain=ctx.createGain();subGain=ctx.createGain();filter=ctx.createBiquadFilter();gain=ctx.createGain();
  osc1.type='triangle';osc2.type='sine';subOsc.type='sine';
  osc1.frequency.value=270;osc2.frequency.value=540.7;subOsc.frequency.value=135;
  osc2Gain.gain.value=.12;subGain.gain.value=.028;
  filter.type='lowpass';filter.frequency.value=1450;filter.Q.value=.40;gain.gain.value=.0001;

  dryGain=ctx.createGain();wetGain=ctx.createGain();delay=ctx.createDelay(.7);convolver=ctx.createConvolver();wetFilter=ctx.createBiquadFilter();
  stereoDelay=ctx.createDelay(.09);stereoMerge=ctx.createChannelMerger(2);
  dryGain.gain.value=.34;wetGain.gain.value=.68;delay.delayTime.value=.17;convolver.buffer=reverbBuffer(ctx);
  wetFilter.type='lowpass';wetFilter.frequency.value=1350;wetFilter.Q.value=.26;
  stereoDelay.delayTime.value=.025;

  osc1.connect(filter);osc2.connect(osc2Gain);osc2Gain.connect(filter);subOsc.connect(subGain);subGain.connect(filter);filter.connect(gain);

  gain.connect(dryGain);
  dryGain.connect(stereoMerge,0,0);
  dryGain.connect(stereoDelay);stereoDelay.connect(stereoMerge,0,1);
  stereoMerge.connect(master);

  gain.connect(delay);delay.connect(convolver);convolver.connect(wetFilter);wetFilter.connect(wetGain);wetGain.connect(master);

  breath=ctx.createBufferSource();breath.buffer=noiseBuffer(ctx);breath.loop=true;
  breathFilter=ctx.createBiquadFilter();breathFilter.type='bandpass';breathFilter.frequency.value=760;breathFilter.Q.value=.40;
  breathGain=ctx.createGain();breathGain.gain.value=.00018;
  breath.connect(breathFilter);breathFilter.connect(breathGain);breathGain.connect(delay);

  vibrato=ctx.createOscillator();vibrato.type='sine';vibrato.frequency.value=2.7;
  vibratoDepth=ctx.createGain();vibratoDepth.gain.value=.14;
  vibrato.connect(vibratoDepth);vibratoDepth.connect(osc1.frequency);

  swell=ctx.createOscillator();swell.type='sine';swell.frequency.value=.095;
  swellDepth=ctx.createGain();swellDepth.gain.value=.05;
  swell.connect(swellDepth);swellDepth.connect(gain.gain);

  osc1.start();osc2.start();subOsc.start();breath.start();vibrato.start();swell.start();
  await ctx.resume();gain.gain.exponentialRampToValueAtTime(.022,ctx.currentTime+3.2);
  running=true;await analyseAll();applyCurrent();
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
  const clone=oldBtn.cloneNode(true);oldBtn.replaceWith(clone);clone.textContent='Start grand distant horn';
  clone.addEventListener('click',async()=>{
    if(!ctx){await init();clone.textContent='Grand horn: on';}
    else if(ctx.state==='running'){await ctx.suspend();clone.textContent='Grand horn: off';}
    else{await ctx.resume();clone.textContent='Grand horn: on';applyCurrent();}
  });
}

document.querySelector('#nextBtn')?.addEventListener('click',()=>setTimeout(applyCurrent,0));
document.querySelector('#prevBtn')?.addEventListener('click',()=>setTimeout(applyCurrent,0));
document.querySelector('#horizonSlider')?.addEventListener('change',async()=>{const f=IMAGES[currentIndex()];feat[f]=await analyse(f);applyCurrent();});
document.querySelector('#playBtn')?.addEventListener('click',()=>{playback=true;startMs=performance.now();});
document.querySelector('#exitPlayback')?.addEventListener('click',()=>{playback=false;setTimeout(applyCurrent,0);});
requestAnimationFrame(loop);
