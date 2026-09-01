const IMAGES=['North Atlantic.jpeg','North Atlantic_3.JPG','Bell Island.jpeg','Portugal Cove.jpeg','Fai Haven.jpeg','Etretat.jpeg','Poch Cove.jpeg','Poch Cove_2.jpeg','Portbou.jpeg','North Atlantic_3 2.jpeg','Cereal.jpeg','North Atlantic_2.jpeg'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const idx=i=>(i+IMAGES.length)%IMAGES.length;
const feat={};
let ctx=null,master=null,voices=[],breath=null,breathFilter=null,breathGain=null;
let wetGain=null,delay=null,convolver=null,wetFilter=null,swell=null,swellDepth=null;
let sunOsc=null,sunHarm=null,sunGain=null,sunHarmGain=null,sunFilter=null,sunPan=null;
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
      let strength=0,contrast=0;
      for(let x=0;x<w;x++){
        strength+=Math.abs(lumAt(x,hr-1)-lumAt(x,hr+1));
        contrast+=Math.abs(lumAt(x,Math.max(0,hr-4))-lumAt(x,Math.min(h-1,hr+4)));
      }
      strength=clamp((strength/w)/.20,0,1);
      contrast=clamp((contrast/w)/.30,0,1);

      let best=-1,bestY=hr;
      for(let y=3;y<hr-2;y++){
        for(let x=4;x<w-4;x++){
          const center=lumAt(x,y);
          if(center<.62)continue;
          let ring=0,n=0;
          for(let oy=-4;oy<=4;oy+=4){for(let ox=-4;ox<=4;ox+=4){if(ox===0&&oy===0)continue;ring+=lumAt(x+ox,y+oy);n++;}}
          const localAvg=ring/n;
          const compact=Math.max(0,center-localAvg);
          const bright=Math.max(0,center-.62);
          const score=compact*1.65+bright*.72;
          if(score>best){best=score;bestY=y;}
        }
      }
      const sun=clamp((best-.12)/.30,0,1);
      const sunY=clamp(bestY/Math.max(1,hr),0,1);
      resolve({strength,contrast,sun,sunY});
    };
    img.onerror=()=>resolve({strength:.5,contrast:.4,sun:0,sunY:1});
    img.src=encodeURI(`./public/images/${file}`);
  });
}

function weights(a,b,c,p){const A=.5*(1-p)*(1-p),B=.75-(p-.5)*(p-.5),C=.5*p*p,s=A+B+C;return[A/s,B/s,C/s];}
function blendedHorizon(a,b,c,p){const h=horizons(),[wa,wb,wc]=weights(a,b,c,p);return(h[IMAGES[idx(a)]]??.5)*wa+(h[IMAGES[idx(b)]]??.5)*wb+(h[IMAGES[idx(c)]]??.5)*wc;}
function blendedFeature(a,b,c,p,key){const [wa,wb,wc]=weights(a,b,c,p);const def={strength:.5,contrast:.4,sun:0,sunY:1};const fa=feat[IMAGES[idx(a)]]||def,fb=feat[IMAGES[idx(b)]]||def,fc=feat[IMAGES[idx(c)]]||def;return fa[key]*wa+fb[key]*wb+fc[key]*wc;}
function featureAt(i){return feat[IMAGES[idx(i)]]||{strength:.5,contrast:.4,sun:0,sunY:1};}

function noiseBuffer(context,seconds=4){
  const b=context.createBuffer(1,Math.floor(context.sampleRate*seconds),context.sampleRate),d=b.getChannelData(0);let prev=0;
  for(let i=0;i<d.length;i++){const white=Math.random()*2-1;prev=prev*.94+white*.06;d[i]=prev*.035;}
  return b;
}

function reverbBuffer(context,seconds=7.2,decay=3.45){
  const length=Math.floor(context.sampleRate*seconds),b=context.createBuffer(2,length,context.sampleRate);
  for(let ch=0;ch<2;ch++){const d=b.getChannelData(ch);for(let i=0;i<length;i++){const t=i/length;d[i]=(Math.random()*2-1)*Math.pow(1-t,decay)*(0.68+Math.random()*.30);}}
  return b;
}

const voicePlan=[
  {detune:0,pan:0,threshold:0.00},
  {detune:4,pan:-.22,threshold:.16},
  {detune:-5,pan:.22,threshold:.30},
  {detune:9,pan:-.42,threshold:.46},
  {detune:-11,pan:.42,threshold:.62},
  {detune:14,pan:0,threshold:.78}
];

function voiceActivation(clarity,threshold){
  if(threshold===0)return 1;
  return clamp((clarity-threshold)/.18,0,1);
}

function apply(a,b,c,p){
  if(!ctx||ctx.state!=='running')return;
  const h=blendedHorizon(a,b,c,p);
  const strength=blendedFeature(a,b,c,p,'strength');
  const contrast=blendedFeature(a,b,c,p,'contrast');
  const sun=blendedFeature(a,b,c,p,'sun');
  const sunY=blendedFeature(a,b,c,p,'sunY');
  const now=ctx.currentTime;

  const clarity=clamp(strength*.78+contrast*.22,0,1);
  const energy=clamp(contrast*.70+strength*.30,0,1);

  // Horizon pitch is driven by visual character, not vertical position.
  // Contrast lifts the register; blur destabilises it; image-to-image differences create a transition glide.
  const fb=featureAt(b),fc=featureAt(c);
  const clarityB=clamp(fb.strength*.78+fb.contrast*.22,0,1);
  const clarityC=clamp(fc.strength*.78+fc.contrast*.22,0,1);
  const transitionDelta=clamp((clarityC-clarityB)*.58+(fc.contrast-fb.contrast)*.42,-1,1);
  const transitionShape=Math.sin(Math.PI*clamp(p,0,1));
  const transitionGlide=transitionDelta*25*transitionShape;
  const contrastLift=contrast*30;
  const driftAmount=(1-clarity)*8;
  const drift=Math.sin(now*.62)*driftAmount+Math.sin(now*.23+1.7)*driftAmount*.35;
  const base=235+contrastLift+drift+transitionGlide;

  const cutoff=lerp(900,2350,clarity);
  const principalLevel=lerp(.018,.032,energy);

  let activeEquivalent=0;
  voices.forEach((v,i)=>{
    const act=voiceActivation(clarity,voicePlan[i].threshold);
    activeEquivalent+=act;
    const level=i===0?principalLevel:principalLevel*lerp(.48,.78,energy)*act;
    v.osc.frequency.setTargetAtTime(base,now,.48);
    v.osc.detune.setTargetAtTime(voicePlan[i].detune,now,.9);
    v.gain.gain.setTargetAtTime(level,now,.9);
    v.filter.frequency.setTargetAtTime(cutoff*lerp(.90,1.10,i/5),now,1.0);
    v.pan.pan.setTargetAtTime(voicePlan[i].pan*act,now,1.0);
  });

  const sunPresence=clamp((sun-.10)/.90,0,1);
  const height=1-clamp(sunY,0,1);
  const interval=lerp(1.25,lerp(1.50,2.00,height),sunPresence);
  const sunFreq=base*interval;
  const sunLevel=.018*Math.pow(sunPresence,1.25);
  sunOsc.frequency.setTargetAtTime(sunFreq,now,.75);
  sunHarm.frequency.setTargetAtTime(sunFreq*2.01,now,.75);
  sunGain.gain.setTargetAtTime(sunLevel,now,1.0);
  sunHarmGain.gain.setTargetAtTime(sunLevel*.20,now,1.0);
  sunFilter.frequency.setTargetAtTime(lerp(1900,4200,sunPresence),now,1.1);
  sunPan.pan.setTargetAtTime(lerp(-.08,.12,height),now,1.2);

  const wet=lerp(.56,.84,1-clarity*.30+contrast*.30);
  wetGain.gain.setTargetAtTime(wet,now,1.2);
  wetFilter.frequency.setTargetAtTime(lerp(950,1900,clarity+sunPresence*.20),now,1.2);
  breathGain.gain.setTargetAtTime(lerp(.00030,.00006,clarity),now,1.3);
  breathFilter.frequency.setTargetAtTime(lerp(820,1250,clarity),now,1.2);
  swellDepth.gain.setTargetAtTime(lerp(.012,.10,energy),now,1.2);

  updateMonitor({h,base,strength,contrast,clarity,activeEquivalent,wet,sun:sunPresence,sunFreq,interval,contrastLift,drift,transitionGlide});
}

function updateMonitor(q){
  const parent=document.querySelector('#soundMonitor');if(!parent)return;
  parent.style.gridTemplateColumns='1fr';
  parent.innerHTML=`<div><strong>HORIZON + SUN</strong><br>Horn base ${q.base.toFixed(1)} Hz · density ${q.activeEquivalent.toFixed(1)} / 6<br>Pitch: contrast +${q.contrastLift.toFixed(1)} Hz · drift ${q.drift.toFixed(1)} Hz · transition ${q.transitionGlide.toFixed(1)} Hz<br>Horizon clarity ${q.clarity.toFixed(3)}<br>Sun presence ${q.sun.toFixed(3)}${q.sun>.03?` · soprano ${q.sunFreq.toFixed(1)} Hz · ratio ${q.interval.toFixed(2)}×`:''}<br>Line strength ${q.strength.toFixed(3)} · Contrast ${q.contrast.toFixed(3)}<br>Shared space / reverb ${q.wet.toFixed(2)}</div>`;
}

async function analyseAll(){const entries=await Promise.all(IMAGES.map(async f=>[f,await analyse(f)]));entries.forEach(([k,v])=>feat[k]=v);}

async function init(){
  if(ctx){await ctx.resume();running=true;return;}
  ctx=new (window.AudioContext||window.webkitAudioContext)();
  master=ctx.createGain();master.gain.value=.56;master.connect(ctx.destination);

  delay=ctx.createDelay(.7);delay.delayTime.value=.16;
  convolver=ctx.createConvolver();convolver.buffer=reverbBuffer(ctx);
  wetFilter=ctx.createBiquadFilter();wetFilter.type='lowpass';wetFilter.frequency.value=1350;wetFilter.Q.value=.28;
  wetGain=ctx.createGain();wetGain.gain.value=.68;
  delay.connect(convolver);convolver.connect(wetFilter);wetFilter.connect(wetGain);wetGain.connect(master);

  voices=voicePlan.map((plan,i)=>{
    const osc=ctx.createOscillator();osc.type=i===0?'triangle':'sine';osc.frequency.value=250;osc.detune.value=plan.detune;
    const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=1450;filter.Q.value=.45;
    const gain=ctx.createGain();gain.gain.value=i===0?.018:.0001;
    const pan=ctx.createStereoPanner();pan.pan.value=plan.pan;
    osc.connect(filter);filter.connect(gain);gain.connect(pan);pan.connect(master);pan.connect(delay);osc.start();
    return {osc,filter,gain,pan};
  });

  sunOsc=ctx.createOscillator();sunOsc.type='triangle';sunOsc.frequency.value=330;
  sunHarm=ctx.createOscillator();sunHarm.type='sawtooth';sunHarm.frequency.value=660;
  sunGain=ctx.createGain();sunGain.gain.value=.0001;
  sunHarmGain=ctx.createGain();sunHarmGain.gain.value=.0001;
  sunFilter=ctx.createBiquadFilter();sunFilter.type='bandpass';sunFilter.frequency.value=2600;sunFilter.Q.value=.85;
  sunPan=ctx.createStereoPanner();sunPan.pan.value=0;
  sunOsc.connect(sunGain);sunHarm.connect(sunHarmGain);sunGain.connect(sunFilter);sunHarmGain.connect(sunFilter);sunFilter.connect(sunPan);sunPan.connect(master);sunPan.connect(delay);
  sunOsc.start();sunHarm.start();

  breath=ctx.createBufferSource();breath.buffer=noiseBuffer(ctx);breath.loop=true;
  breathFilter=ctx.createBiquadFilter();breathFilter.type='bandpass';breathFilter.frequency.value=900;breathFilter.Q.value=.45;
  breathGain=ctx.createGain();breathGain.gain.value=.00018;
  breath.connect(breathFilter);breathFilter.connect(breathGain);breathGain.connect(delay);breath.start();

  swell=ctx.createOscillator();swell.type='sine';swell.frequency.value=.085;
  swellDepth=ctx.createGain();swellDepth.gain.value=.035;
  swell.connect(swellDepth);swellDepth.connect(master.gain);swell.start();

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
  const clone=oldBtn.cloneNode(true);oldBtn.replaceWith(clone);clone.textContent='Start horizon + sun';
  clone.addEventListener('click',async()=>{
    if(!ctx){await init();clone.textContent='Horizon + sun: on';}
    else if(ctx.state==='running'){await ctx.suspend();clone.textContent='Horizon + sun: off';}
    else{await ctx.resume();clone.textContent='Horizon + sun: on';applyCurrent();}
  });
}

document.querySelector('#nextBtn')?.addEventListener('click',()=>setTimeout(applyCurrent,0));
document.querySelector('#prevBtn')?.addEventListener('click',()=>setTimeout(applyCurrent,0));
document.querySelector('#horizonSlider')?.addEventListener('change',async()=>{const f=IMAGES[currentIndex()];feat[f]=await analyse(f);applyCurrent();});
document.querySelector('#playBtn')?.addEventListener('click',()=>{playback=true;startMs=performance.now();});
document.querySelector('#exitPlayback')?.addEventListener('click',()=>{playback=false;setTimeout(applyCurrent,0);});
requestAnimationFrame(loop);
