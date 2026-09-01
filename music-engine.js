const IMAGES=['North Atlantic.jpeg','North Atlantic_3.JPG','Bell Island.jpeg','Portugal Cove.jpeg','Fai Haven.jpeg','Etretat.jpeg','Poch Cove.jpeg','Poch Cove_2.jpeg','Portbou.jpeg','North Atlantic_3 2.jpeg','Cereal.jpeg','North Atlantic_2.jpeg'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const idx=i=>(i+IMAGES.length)%IMAGES.length;
const feat={};
let ctx=null,master=null,horns=[],lows=[];
let clarOsc=null,clarGain=null,clarFilter=null,clarPan=null,clarVib=null,clarVibDepth=null;
let fluteOsc=null,fluteAirOsc=null,fluteGain=null,fluteAirGain=null,fluteFilter=null,flutePan=null;
let breath=null,breathFilter=null,breathGain=null;
let dryBus=null,wetBus=null,delay=null,convolver=null,wetFilter=null,swell=null,swellDepth=null;
let running=false,playback=false,startMs=0,current=0;

function horizons(){return JSON.parse(localStorage.getItem('liquidCommonsHorizons')||'{}');}
function weights(a,b,c,p){const A=.5*(1-p)*(1-p),B=.75-(p-.5)*(p-.5),C=.5*p*p,s=A+B+C;return[A/s,B/s,C/s];}
function wave(context,partials){const real=new Float32Array(partials.length+1),imag=new Float32Array(partials.length+1);partials.forEach((v,i)=>imag[i+1]=v);return context.createPeriodicWave(real,imag,{disableNormalization:false});}
function rise(x,t,w=.22){return clamp((x-t)/w,0,1);}
function nearestConsonantRatio(target,choices){return choices.reduce((best,r)=>Math.abs(r-target)<Math.abs(best-target)?r:best,choices[0]);}

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
        sky+=lumAt(x,Math.max(0,hr-8));sea+=lumAt(x,Math.min(h-1,hr+8));
      }
      strength=clamp((strength/w)/.20,0,1);contrast=clamp((contrast/w)/.30,0,1);sky=clamp(sky/w,0,1);sea=clamp(sea/w,0,1);
      let best=-1,bestY=hr;
      for(let y=3;y<hr-2;y++)for(let x=4;x<w-4;x++){
        const center=lumAt(x,y);if(center<.62)continue;
        let ring=0,n=0;for(let oy=-4;oy<=4;oy+=4)for(let ox=-4;ox<=4;ox+=4){if(ox===0&&oy===0)continue;ring+=lumAt(x+ox,y+oy);n++;}
        const score=Math.max(0,center-ring/n)*1.65+Math.max(0,center-.62)*.72;if(score>best){best=score;bestY=y;}
      }
      resolve({strength,contrast,sky,sea,sun:clamp((best-.12)/.30,0,1),sunY:clamp(bestY/Math.max(1,hr),0,1)});
    };
    img.onerror=()=>resolve({strength:.5,contrast:.4,sky:.5,sea:.4,sun:0,sunY:1});
    img.src=encodeURI(`./public/images/${file}`);
  });
}
function blendedFeature(a,b,c,p,key){const [wa,wb,wc]=weights(a,b,c,p);const def={strength:.5,contrast:.4,sky:.5,sea:.4,sun:0,sunY:1};const fa=feat[IMAGES[idx(a)]]||def,fb=feat[IMAGES[idx(b)]]||def,fc=feat[IMAGES[idx(c)]]||def;return fa[key]*wa+fb[key]*wb+fc[key]*wc;}
function featureAt(i){return feat[IMAGES[idx(i)]]||{strength:.5,contrast:.4,sky:.5,sea:.4,sun:0,sunY:1};}
function noiseBuffer(context,seconds=4){const b=context.createBuffer(1,Math.floor(context.sampleRate*seconds),context.sampleRate),d=b.getChannelData(0);let prev=0;for(let i=0;i<d.length;i++){const white=Math.random()*2-1;prev=prev*.97+white*.03;d[i]=prev*.016;}return b;}
function reverbBuffer(context,seconds=8.4,decay=4.2){const len=Math.floor(context.sampleRate*seconds),b=context.createBuffer(2,len,context.sampleRate);for(let ch=0;ch<2;ch++){const d=b.getChannelData(ch);for(let i=0;i<len;i++){const t=i/len;d[i]=(Math.random()*2-1)*Math.pow(1-t,decay)*(0.40+Math.random()*.16);}}return b;}

const hornPlan=[{detune:0,pan:0,threshold:0},{detune:1.5,pan:-.14,threshold:.22},{detune:-2,pan:.14,threshold:.38},{detune:3,pan:-.27,threshold:.54},{detune:-3.5,pan:.27,threshold:.70},{detune:4.5,pan:0,threshold:.84}];
const lowPlan=[
  {ratio:.50,pan:-.30,threshold:.10},{ratio:.50,pan:.30,threshold:.22},{ratio:.50,pan:-.12,threshold:.34},
  {ratio:.50,pan:.12,threshold:.46},{ratio:.25,pan:-.06,threshold:.60},{ratio:.25,pan:.06,threshold:.74}
];

function apply(a,b,c,p){
  if(!ctx||ctx.state!=='running')return;
  const strength=blendedFeature(a,b,c,p,'strength'),contrast=blendedFeature(a,b,c,p,'contrast'),sky=blendedFeature(a,b,c,p,'sky'),sea=blendedFeature(a,b,c,p,'sea'),sun=blendedFeature(a,b,c,p,'sun'),sunY=blendedFeature(a,b,c,p,'sunY');
  const now=ctx.currentTime,clarity=clamp(strength*.76+contrast*.24,0,1),brightness=clamp(sky*.62+sea*.18+contrast*.20,0,1),darkness=1-brightness,energy=clamp(contrast*.56+strength*.24+darkness*.20,0,1);
  const fb=featureAt(b),fc=featureAt(c),cb=clamp(fb.strength*.76+fb.contrast*.24,0,1),cc=clamp(fc.strength*.76+fc.contrast*.24,0,1);
  const horizonDelta=clamp((cc-cb)*.58+(fc.contrast-fb.contrast)*.42,-1,1);
  const imageDelta=clamp(horizonDelta*.82+(fc.sky-fb.sky)*.18,-1,1),shape=Math.sin(Math.PI*clamp(p,0,1));

  // C4 is only the register centre. Every image has its own horizon pitch state,
  // while transitions add a much larger signed movement around that centre.
  const C4=261.63;
  const horizonState=clamp((clarity-.50)*1.15+(contrast-.50)*.85,-.75,.75);
  const stateOffset=horizonState*46;
  const pitchMotion=horizonDelta*68*shape;
  const microDrift=Math.sin(now*.20)*(1-clarity)*1.1;
  const base=C4+stateOffset+pitchMotion+microDrift;
  const hornCut=lerp(900,1650,clarity*.50+brightness*.50),principalBase=lerp(.015,.026,energy);

  const hornMass=clamp(darkness*.72+(1-clarity)*.28,0,1);let hornDensity=0;
  horns.forEach((v,i)=>{
    const act=i===0?1:rise(hornMass,1-hornPlan[i].threshold,.13);hornDensity+=act;
    const soloBoost=i===0?lerp(1.65,1.05,hornMass):1;
    const level=i===0?principalBase*soloBoost:principalBase*lerp(.28,.52,hornMass)*act;
    v.osc.frequency.setTargetAtTime(base,now,.48);v.osc.detune.setTargetAtTime(hornPlan[i].detune,now,1.25);v.gain.gain.setTargetAtTime(level,now,.90);v.filter.frequency.setTargetAtTime(hornCut*lerp(.97,1.03,i/5),now,1.2);v.pan.pan.setTargetAtTime(hornPlan[i].pan*act,now,1.25);
  });

  let lowDensity=0;
  lows.forEach((v,i)=>{
    const act=rise(darkness,lowPlan[i].threshold,.17);lowDensity+=act;
    v.osc.frequency.setTargetAtTime(base*lowPlan[i].ratio,now,.65);
    v.gain.gain.setTargetAtTime(.0068*act*lerp(.50,.86,darkness),now,1.15);
    v.filter.frequency.setTargetAtTime(lerp(430,820,brightness),now,1.3);v.pan.pan.setTargetAtTime(lowPlan[i].pan*act,now,1.3);
  });

  const morning=clamp(brightness*.72+contrast*.18+(1-sea)*.10,0,1),rawClar=lerp(1.25,1.50,Math.pow(morning,.80))+horizonDelta*.070*shape,clarAnchor=nearestConsonantRatio(rawClar,[1.25,1.333,1.50]),clarRatio=lerp(rawClar,clarAnchor,.78),clarFreq=base*clarRatio;
  clarOsc.frequency.setTargetAtTime(clarFreq,now,1.05);clarGain.gain.setTargetAtTime(lerp(.0075,.0125,.40+morning*.60)*(1-sun*.12),now,1.35);clarFilter.frequency.setTargetAtTime(lerp(1150,1850,brightness),now,1.5);clarPan.pan.setTargetAtTime(clamp(horizonDelta*.08,-.07,.07),now,1.7);clarVibDepth.gain.setTargetAtTime(lerp(.04,.11,1-clarity),now,1.6);

  const sunPresence=clamp((sun-.10)/.90,0,1),height=1-clamp(sunY,0,1),fluteRatio=lerp(1.50,1.667,Math.pow(clamp(height*.65+sunPresence*.35,0,1),.85)),fluteFreq=base*fluteRatio,fluteLevel=.0086*Math.pow(sunPresence,1.35);
  fluteOsc.frequency.setTargetAtTime(fluteFreq,now,.85);fluteAirOsc.frequency.setTargetAtTime(fluteFreq*2,now,.85);fluteGain.gain.setTargetAtTime(fluteLevel,now,1.3);fluteAirGain.gain.setTargetAtTime(fluteLevel*.024,now,1.3);fluteFilter.frequency.setTargetAtTime(lerp(1600,2350,sunPresence),now,1.4);flutePan.pan.setTargetAtTime(lerp(-.02,.04,height),now,1.5);

  // Much drier baseline. Reverb only blooms on strong horizon changes.
  const distance=clamp(darkness*.78+(1-clarity)*.22,0,1);
  const change=clamp(Math.abs(horizonDelta)*2.4+Math.abs(cc-cb)*1.25,0,1);
  const transitionBloom=Math.pow(shape,1.5)*change;
  const dry=clamp(lerp(1.12,.72,distance)-transitionBloom*.08,.62,1.15);
  const wetBase=lerp(.004,.035,distance);
  const wet=clamp(wetBase+transitionBloom*.42,0,.48);
  const distanceGain=lerp(1.10,.76,distance);
  dryBus.gain.setTargetAtTime(dry*distanceGain,now,.42);wetBus.gain.setTargetAtTime(wet*distanceGain,now,.35);
  wetFilter.frequency.setTargetAtTime(lerp(2800,900,clamp(distance*.55+transitionBloom*.45,0,1)),now,.50);
  delay.delayTime.setTargetAtTime(lerp(.09,.27,transitionBloom),now,.40);
  breathGain.gain.setTargetAtTime(lerp(.000050,.000008,clarity),now,1.0);breathFilter.frequency.setTargetAtTime(lerp(1050,650,distance),now,1.0);swellDepth.gain.setTargetAtTime(lerp(.002,.013,energy),now,1.15);

  updateMonitor({base,stateOffset,pitchMotion,clarFreq,fluteFreq,sun:sunPresence,hornDensity,lowDensity,brightness,darkness,clarity,distance,dry,wet,change,transitionBloom,horizonDelta});
}

function updateMonitor(q){const el=document.querySelector('#soundMonitor');if(!el)return;el.style.gridTemplateColumns='1fr';el.innerHTML=`<div><strong>HORIZON ORCHESTRA — C4 REGISTER / 2× MOTION</strong><br>Horn ${q.base.toFixed(1)} Hz · image offset ${q.stateOffset.toFixed(1)} Hz · transition ${q.pitchMotion.toFixed(1)} Hz<br>Horn density ${q.hornDensity.toFixed(1)} / 6 · Low orchestra ${q.lowDensity.toFixed(1)} / 6<br>Clarinet ${q.clarFreq.toFixed(1)} Hz · Sun flute ${q.sun.toFixed(2)}${q.sun>.03?` · ${q.fluteFreq.toFixed(1)} Hz`:''}<br>Dry ${q.dry.toFixed(2)} · wet ${q.wet.toFixed(2)} · distance ${q.distance.toFixed(2)}<br>Horizon Δ ${q.horizonDelta.toFixed(2)} · reverb bloom ${q.transitionBloom.toFixed(2)}</div>`;}
async function analyseAll(){const entries=await Promise.all(IMAGES.map(async f=>[f,await analyse(f)]));entries.forEach(([k,v])=>feat[k]=v);}

async function init(){
  if(ctx){await ctx.resume();running=true;return;}
  ctx=new (window.AudioContext||window.webkitAudioContext)();
  master=ctx.createGain();master.gain.value=.78;master.connect(ctx.destination);
  dryBus=ctx.createGain();wetBus=ctx.createGain();dryBus.gain.value=1.0;wetBus.gain.value=.01;dryBus.connect(master);
  delay=ctx.createDelay(.9);delay.delayTime.value=.12;convolver=ctx.createConvolver();convolver.buffer=reverbBuffer(ctx);wetFilter=ctx.createBiquadFilter();wetFilter.type='lowpass';wetFilter.frequency.value=1600;wetFilter.Q.value=.14;wetBus.connect(delay);delay.connect(convolver);convolver.connect(wetFilter);wetFilter.connect(master);
  const hornWave=wave(ctx,[1,.24,.11,.052,.024,.011,.005]);
  horns=hornPlan.map((plan,i)=>{const osc=ctx.createOscillator();osc.setPeriodicWave(hornWave);osc.frequency.value=261.63;osc.detune.value=plan.detune;const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=1300;filter.Q.value=.16;const gain=ctx.createGain();gain.gain.value=.0001;const pan=ctx.createStereoPanner();pan.pan.value=plan.pan;osc.connect(filter);filter.connect(gain);gain.connect(pan);pan.connect(dryBus);pan.connect(wetBus);osc.start();return{osc,filter,gain,pan};});
  const lowWave=wave(ctx,[1,.30,.14,.065,.028,.012]);
  lows=lowPlan.map(plan=>{const osc=ctx.createOscillator();osc.setPeriodicWave(lowWave);osc.frequency.value=130.81;const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=600;filter.Q.value=.14;const gain=ctx.createGain();gain.gain.value=.0001;const pan=ctx.createStereoPanner();pan.pan.value=plan.pan;osc.connect(filter);filter.connect(gain);gain.connect(pan);pan.connect(dryBus);pan.connect(wetBus);osc.start();return{osc,filter,gain,pan};});
  clarOsc=ctx.createOscillator();clarOsc.setPeriodicWave(wave(ctx,[1,0,.27,0,.095,0,.032,0,.012]));clarOsc.frequency.value=392;clarGain=ctx.createGain();clarGain.gain.value=.0001;clarFilter=ctx.createBiquadFilter();clarFilter.type='lowpass';clarFilter.frequency.value=1600;clarFilter.Q.value=.22;clarPan=ctx.createStereoPanner();clarPan.pan.value=0;clarOsc.connect(clarFilter);clarFilter.connect(clarGain);clarGain.connect(clarPan);clarPan.connect(dryBus);clarPan.connect(wetBus);clarVib=ctx.createOscillator();clarVib.type='sine';clarVib.frequency.value=4.0;clarVibDepth=ctx.createGain();clarVibDepth.gain.value=.08;clarVib.connect(clarVibDepth);clarVibDepth.connect(clarOsc.frequency);clarOsc.start();clarVib.start();
  fluteOsc=ctx.createOscillator();fluteOsc.setPeriodicWave(wave(ctx,[1,.07,.025,.010,.004]));fluteOsc.frequency.value=392.45;fluteAirOsc=ctx.createOscillator();fluteAirOsc.type='sine';fluteAirOsc.frequency.value=784.9;fluteGain=ctx.createGain();fluteGain.gain.value=.0001;fluteAirGain=ctx.createGain();fluteAirGain.gain.value=.0001;fluteFilter=ctx.createBiquadFilter();fluteFilter.type='lowpass';fluteFilter.frequency.value=2000;fluteFilter.Q.value=.14;flutePan=ctx.createStereoPanner();flutePan.pan.value=0;fluteOsc.connect(fluteGain);fluteAirOsc.connect(fluteAirGain);fluteGain.connect(fluteFilter);fluteAirGain.connect(fluteFilter);fluteFilter.connect(flutePan);flutePan.connect(dryBus);flutePan.connect(wetBus);fluteOsc.start();fluteAirOsc.start();
  breath=ctx.createBufferSource();breath.buffer=noiseBuffer(ctx);breath.loop=true;breathFilter=ctx.createBiquadFilter();breathFilter.type='bandpass';breathFilter.frequency.value=800;breathFilter.Q.value=.32;breathGain=ctx.createGain();breathGain.gain.value=.000025;breath.connect(breathFilter);breathFilter.connect(breathGain);breathGain.connect(wetBus);breath.start();
  swell=ctx.createOscillator();swell.type='sine';swell.frequency.value=.065;swellDepth=ctx.createGain();swellDepth.gain.value=.006;swell.connect(swellDepth);swellDepth.connect(master.gain);swell.start();
  await ctx.resume();running=true;await analyseAll();applyCurrent();
}
function currentIndex(){const name=document.querySelector('#filename')?.textContent?.trim();const i=IMAGES.indexOf(name);return i>=0?i:current;}
function applyCurrent(){current=currentIndex();apply(current,current,current,.5);}
function loop(t){if(running&&playback&&ctx?.state==='running'){const dur=Math.max(12,+document.querySelector('#durationInput')?.value||58);const prog=(((t-startMs)/1000)%dur)/dur,cycle=prog*IMAGES.length,center=Math.floor(cycle)%IMAGES.length,p=cycle-Math.floor(cycle);apply(center-1,center,center+1,p);}requestAnimationFrame(loop);}
const oldBtn=document.querySelector('#soundProxy');if(oldBtn){const clone=oldBtn.cloneNode(true);oldBtn.replaceWith(clone);clone.textContent='Start horizon orchestra';clone.addEventListener('click',async()=>{if(!ctx){await init();clone.textContent='Horizon orchestra: on';}else if(ctx.state==='running'){await ctx.suspend();clone.textContent='Horizon orchestra: off';}else{await ctx.resume();clone.textContent='Horizon orchestra: on';applyCurrent();}});}
document.querySelector('#nextBtn')?.addEventListener('click',()=>setTimeout(applyCurrent,0));document.querySelector('#prevBtn')?.addEventListener('click',()=>setTimeout(applyCurrent,0));document.querySelector('#horizonSlider')?.addEventListener('change',async()=>{const f=IMAGES[currentIndex()];feat[f]=await analyse(f);applyCurrent();});document.querySelector('#playBtn')?.addEventListener('click',()=>{playback=true;startMs=performance.now();});document.querySelector('#exitPlayback')?.addEventListener('click',()=>{playback=false;setTimeout(applyCurrent,0);});requestAnimationFrame(loop);