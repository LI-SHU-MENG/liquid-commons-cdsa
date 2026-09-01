const IMAGES=['North Atlantic.jpeg','North Atlantic_3.JPG','Bell Island.jpeg','Portugal Cove.jpeg','Fai Haven.jpeg','Etretat.jpeg','Poch Cove.jpeg','Poch Cove_2.jpeg','Portbou.jpeg','North Atlantic_3 2.jpeg','Cereal.jpeg','North Atlantic_2.jpeg'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const idx=i=>(i+IMAGES.length)%IMAGES.length;
const feat={};
let ctx=null,master=null,voices=[],breath=null,breathFilter=null,breathGain=null;
let wetGain=null,delay=null,convolver=null,wetFilter=null,swell=null,swellDepth=null;
let clarOsc=null,clarGain=null,clarFilter=null,clarPan=null,clarVib=null,clarVibDepth=null;
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
      let strength=0,contrast=0,sky=0,sea=0;
      for(let x=0;x<w;x++){
        strength+=Math.abs(lumAt(x,hr-1)-lumAt(x,hr+1));
        contrast+=Math.abs(lumAt(x,Math.max(0,hr-4))-lumAt(x,Math.min(h-1,hr+4)));
        sky+=lumAt(x,Math.max(0,hr-8));
        sea+=lumAt(x,Math.min(h-1,hr+8));
      }
      strength=clamp((strength/w)/.20,0,1);
      contrast=clamp((contrast/w)/.30,0,1);
      sky=clamp(sky/w,0,1);sea=clamp(sea/w,0,1);

      let best=-1,bestY=hr;
      for(let y=3;y<hr-2;y++){
        for(let x=4;x<w-4;x++){
          const center=lumAt(x,y);
          if(center<.62)continue;
          let ring=0,n=0;
          for(let oy=-4;oy<=4;oy+=4){for(let ox=-4;ox<=4;ox+=4){if(ox===0&&oy===0)continue;ring+=lumAt(x+ox,y+oy);n++;}}
          const localAvg=ring/n;
          const score=Math.max(0,center-localAvg)*1.65+Math.max(0,center-.62)*.72;
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
  for(let i=0;i<d.length;i++){const white=Math.random()*2-1;prev=prev*.965+white*.035;d[i]=prev*.024;}
  return b;
}
function reverbBuffer(context,seconds=8.0,decay=3.8){
  const length=Math.floor(context.sampleRate*seconds),b=context.createBuffer(2,length,context.sampleRate);
  for(let ch=0;ch<2;ch++){const d=b.getChannelData(ch);for(let i=0;i<length;i++){const t=i/length;d[i]=(Math.random()*2-1)*Math.pow(1-t,decay)*(0.56+Math.random()*.22);}}
  return b;
}

const voicePlan=[
  {detune:0,pan:0,threshold:0.00},{detune:2.5,pan:-.18,threshold:.16},{detune:-3,pan:.18,threshold:.30},
  {detune:5,pan:-.34,threshold:.46},{detune:-6,pan:.34,threshold:.62},{detune:7,pan:0,threshold:.78}
];
function voiceActivation(clarity,threshold){if(threshold===0)return 1;return clamp((clarity-threshold)/.20,0,1);}
function makeHornWave(context){
  const real=new Float32Array(9),imag=new Float32Array(9);
  imag[1]=1;imag[2]=.30;imag[3]=.16;imag[4]=.085;imag[5]=.045;imag[6]=.025;imag[7]=.014;imag[8]=.008;
  return context.createPeriodicWave(real,imag,{disableNormalization:false});
}
function makeClarinetWave(context){
  const real=new Float32Array(10),imag=new Float32Array(10);
  imag[1]=1;imag[3]=.34;imag[5]=.14;imag[7]=.06;imag[9]=.025;
  return context.createPeriodicWave(real,imag,{disableNormalization:false});
}
function makeSunWave(context){
  const real=new Float32Array(8),imag=new Float32Array(8);
  imag[1]=1;imag[2]=.12;imag[3]=.07;imag[4]=.03;imag[5]=.015;
  return context.createPeriodicWave(real,imag,{disableNormalization:false});
}

function apply(a,b,c,p){
  if(!ctx||ctx.state!=='running')return;
  const strength=blendedFeature(a,b,c,p,'strength');
  const contrast=blendedFeature(a,b,c,p,'contrast');
  const sky=blendedFeature(a,b,c,p,'sky');
  const sea=blendedFeature(a,b,c,p,'sea');
  const sun=blendedFeature(a,b,c,p,'sun');
  const sunY=blendedFeature(a,b,c,p,'sunY');
  const now=ctx.currentTime;

  const clarity=clamp(strength*.78+contrast*.22,0,1);
  const energy=clamp(contrast*.64+strength*.36,0,1);
  const fb=featureAt(b),fc=featureAt(c);
  const clarityB=clamp(fb.strength*.78+fb.contrast*.22,0,1);
  const clarityC=clamp(fc.strength*.78+fc.contrast*.22,0,1);
  const imageDelta=clamp((clarityC-clarityB)*.38+(fc.contrast-fb.contrast)*.28+(fc.sky-fb.sky)*.34,-1,1);
  const transitionShape=Math.sin(Math.PI*clamp(p,0,1));

  // Warm orchestral horn body: lower and steadier, like the ground under the morning light.
  const contrastLift=contrast*12;
  const transitionGlide=imageDelta*10*transitionShape;
  const driftAmount=(1-clarity)*2.8;
  const drift=Math.sin(now*.42)*driftAmount+Math.sin(now*.17+1.7)*driftAmount*.24;
  const base=220+contrastLift+transitionGlide+drift;
  const cutoff=lerp(780,1650,clarity);
  const principalLevel=lerp(.016,.027,energy);

  let activeEquivalent=0;
  voices.forEach((v,i)=>{
    const act=voiceActivation(clarity,voicePlan[i].threshold);
    activeEquivalent+=act;
    const level=i===0?principalLevel:principalLevel*lerp(.42,.66,energy)*act;
    v.osc.frequency.setTargetAtTime(base,now,.80);
    v.osc.detune.setTargetAtTime(voicePlan[i].detune,now,1.0);
    v.gain.gain.setTargetAtTime(level,now,1.0);
    v.filter.frequency.setTargetAtTime(cutoff*lerp(.94,1.06,i/5),now,1.1);
    v.pan.pan.setTargetAtTime(voicePlan[i].pan*act,now,1.1);
  });

  // Clarinet = hopeful upward breath. No borrowed melody; only an ascending, consonant contour.
  // Darker images sit near a major third; brighter / more open images rise toward fourth and fifth.
  const morning=clamp(sky*.62+(1-sea)*.13+contrast*.25,0,1);
  const clarBaseRatio=lerp(1.25,1.50,Math.pow(morning,.82));
  const clarRise=Math.max(0,imageDelta)*.10*transitionShape;
  const clarFall=Math.min(0,imageDelta)*.045*transitionShape;
  const clarRatio=clamp(clarBaseRatio+clarRise+clarFall,1.24,1.52);
  const clarFreq=base*clarRatio;
  const clarLevel=lerp(.008,.0135,clamp(.40+morning*.35+Math.abs(imageDelta)*.25,0,1));
  clarOsc.frequency.setTargetAtTime(clarFreq,now,1.8);
  clarGain.gain.setTargetAtTime(clarLevel*(1-sun*.18),now,1.45);
  clarFilter.frequency.setTargetAtTime(lerp(1150,1900,clarity*.45+sky*.55),now,1.5);
  clarPan.pan.setTargetAtTime(clamp(imageDelta*.14,-.12,.12),now,1.8);
  clarVibDepth.gain.setTargetAtTime(lerp(.10,.30,1-clarity),now,1.6);

  // Sun = soft upper woodwind glow. It rises to a fifth / sixth, not a piercing octave.
  const sunPresence=clamp((sun-.10)/.90,0,1);
  const height=1-clamp(sunY,0,1);
  const sunTarget=lerp(1.50,1.667,height); // fifth -> major sixth
  const interval=lerp(1.34,sunTarget,Math.pow(sunPresence,.75));
  const sunFreq=base*interval;
  const sunLevel=.0105*Math.pow(sunPresence,1.35);
  sunOsc.frequency.setTargetAtTime(sunFreq,now,1.15);
  sunHarm.frequency.setTargetAtTime(sunFreq*2.0,now,1.15);
  sunGain.gain.setTargetAtTime(sunLevel,now,1.2);
  sunHarmGain.gain.setTargetAtTime(sunLevel*.055,now,1.2);
  sunFilter.frequency.setTargetAtTime(lerp(1350,2250,sunPresence),now,1.35);
  sunPan.pan.setTargetAtTime(lerp(-.04,.06,height),now,1.4);

  const wet=lerp(.62,.80,1-clarity*.22+contrast*.22);
  wetGain.gain.setTargetAtTime(wet,now,1.4);
  wetFilter.frequency.setTargetAtTime(lerp(850,1500,clamp(clarity+sunPresence*.12,0,1)),now,1.4);
  breathGain.gain.setTargetAtTime(lerp(.00020,.00004,clarity),now,1.5);
  breathFilter.frequency.setTargetAtTime(lerp(700,1050,clarity),now,1.4);
  swellDepth.gain.setTargetAtTime(lerp(.008,.050,energy),now,1.4);

  updateMonitor({base,clarFreq,clarRatio,sun:sunPresence,sunFreq,interval,activeEquivalent,clarity,contrast,wet,imageDelta});
}

function updateMonitor(q){
  const parent=document.querySelector('#soundMonitor');if(!parent)return;
  parent.style.gridTemplateColumns='1fr';
  parent.innerHTML=`<div><strong>HORIZON ORCHESTRA — WARM MORNING</strong><br>Horn body ${q.base.toFixed(1)} Hz · density ${q.activeEquivalent.toFixed(1)} / 6<br>Clarinet line ${q.clarFreq.toFixed(1)} Hz · ratio ${q.clarRatio.toFixed(2)}× · image Δ ${q.imageDelta.toFixed(2)}<br>Sun ${q.sun.toFixed(3)}${q.sun>.03?` · upper woodwind ${q.sunFreq.toFixed(1)} Hz · ratio ${q.interval.toFixed(2)}×`:''}<br>Horizon clarity ${q.clarity.toFixed(3)} · Contrast ${q.contrast.toFixed(3)} · Reverb ${q.wet.toFixed(2)}</div>`;
}

async function analyseAll(){const entries=await Promise.all(IMAGES.map(async f=>[f,await analyse(f)]));entries.forEach(([k,v])=>feat[k]=v);}

async function init(){
  if(ctx){await ctx.resume();running=true;return;}
  ctx=new (window.AudioContext||window.webkitAudioContext)();
  master=ctx.createGain();master.gain.value=.50;master.connect(ctx.destination);

  delay=ctx.createDelay(.8);delay.delayTime.value=.18;
  convolver=ctx.createConvolver();convolver.buffer=reverbBuffer(ctx);
  wetFilter=ctx.createBiquadFilter();wetFilter.type='lowpass';wetFilter.frequency.value=1200;wetFilter.Q.value=.22;
  wetGain=ctx.createGain();wetGain.gain.value=.70;
  delay.connect(convolver);convolver.connect(wetFilter);wetFilter.connect(wetGain);wetGain.connect(master);

  const hWave=makeHornWave(ctx);
  voices=voicePlan.map((plan,i)=>{
    const osc=ctx.createOscillator();osc.setPeriodicWave(hWave);osc.frequency.value=225;osc.detune.value=plan.detune;
    const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=1200;filter.Q.value=.28;
    const gain=ctx.createGain();gain.gain.value=i===0?.016:.0001;
    const pan=ctx.createStereoPanner();pan.pan.value=plan.pan;
    osc.connect(filter);filter.connect(gain);gain.connect(pan);pan.connect(master);pan.connect(delay);osc.start();
    return {osc,filter,gain,pan};
  });

  clarOsc=ctx.createOscillator();clarOsc.setPeriodicWave(makeClarinetWave(ctx));clarOsc.frequency.value=300;
  clarGain=ctx.createGain();clarGain.gain.value=.0001;
  clarFilter=ctx.createBiquadFilter();clarFilter.type='lowpass';clarFilter.frequency.value=1550;clarFilter.Q.value=.38;
  clarPan=ctx.createStereoPanner();clarPan.pan.value=0;
  clarOsc.connect(clarFilter);clarFilter.connect(clarGain);clarGain.connect(clarPan);clarPan.connect(master);clarPan.connect(delay);
  clarVib=ctx.createOscillator();clarVib.type='sine';clarVib.frequency.value=4.0;
  clarVibDepth=ctx.createGain();clarVibDepth.gain.value=.18;clarVib.connect(clarVibDepth);clarVibDepth.connect(clarOsc.frequency);
  clarOsc.start();clarVib.start();

  sunOsc=ctx.createOscillator();sunOsc.setPeriodicWave(makeSunWave(ctx));sunOsc.frequency.value=350;
  sunHarm=ctx.createOscillator();sunHarm.type='sine';sunHarm.frequency.value=700;
  sunGain=ctx.createGain();sunGain.gain.value=.0001;
  sunHarmGain=ctx.createGain();sunHarmGain.gain.value=.0001;
  sunFilter=ctx.createBiquadFilter();sunFilter.type='lowpass';sunFilter.frequency.value=1800;sunFilter.Q.value=.24;
  sunPan=ctx.createStereoPanner();sunPan.pan.value=0;
  sunOsc.connect(sunGain);sunHarm.connect(sunHarmGain);sunGain.connect(sunFilter);sunHarmGain.connect(sunFilter);sunFilter.connect(sunPan);sunPan.connect(master);sunPan.connect(delay);
  sunOsc.start();sunHarm.start();

  breath=ctx.createBufferSource();breath.buffer=noiseBuffer(ctx);breath.loop=true;
  breathFilter=ctx.createBiquadFilter();breathFilter.type='bandpass';breathFilter.frequency.value=820;breathFilter.Q.value=.40;
  breathGain=ctx.createGain();breathGain.gain.value=.00010;
  breath.connect(breathFilter);breathFilter.connect(breathGain);breathGain.connect(delay);breath.start();

  swell=ctx.createOscillator();swell.type='sine';swell.frequency.value=.070;
  swellDepth=ctx.createGain();swellDepth.gain.value=.024;
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
  const clone=oldBtn.cloneNode(true);oldBtn.replaceWith(clone);clone.textContent='Start warm horizon orchestra';
  clone.addEventListener('click',async()=>{
    if(!ctx){await init();clone.textContent='Warm horizon orchestra: on';}
    else if(ctx.state==='running'){await ctx.suspend();clone.textContent='Warm horizon orchestra: off';}
    else{await ctx.resume();clone.textContent='Warm horizon orchestra: on';applyCurrent();}
  });
}

document.querySelector('#nextBtn')?.addEventListener('click',()=>setTimeout(applyCurrent,0));
document.querySelector('#prevBtn')?.addEventListener('click',()=>setTimeout(applyCurrent,0));
document.querySelector('#horizonSlider')?.addEventListener('change',async()=>{const f=IMAGES[currentIndex()];feat[f]=await analyse(f);applyCurrent();});
document.querySelector('#playBtn')?.addEventListener('click',()=>{playback=true;startMs=performance.now();});
document.querySelector('#exitPlayback')?.addEventListener('click',()=>{playback=false;setTimeout(applyCurrent,0);});
requestAnimationFrame(loop);