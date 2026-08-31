const images = [
  'North Atlantic.jpeg','North Atlantic_3.JPG','Bell Island.jpeg','Portugal Cove.jpeg','Fai Haven.jpeg','Etretat.jpeg','Poch Cove.jpeg','Poch Cove_2.jpeg','Portbou.jpeg','North Atlantic_3 2.jpeg','Cereal.jpeg','North Atlantic_2.jpeg'
];

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const idx=i=>(i+images.length)%images.length;
const features={};

let ctx, master;
let oscA, oscB, harmonicOsc, toneFilter, toneGain, harmonicGain;
let seaNoise, seaFilter, seaGain;
let skyNoise, skyFilter, skyGain, skyPan;
let started=false, playback=false, playbackStart=0, duration=58, current=0;

function horizons(){ return JSON.parse(localStorage.getItem('liquidCommonsHorizons')||'{}'); }

async function analyse(file){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const w=72,h=72,c=document.createElement('canvas');
      c.width=w;c.height=h;
      const g=c.getContext('2d',{willReadFrequently:true});
      g.drawImage(img,0,0,w,h);
      const d=g.getImageData(0,0,w,h).data;
      const hr=clamp(Math.round((horizons()[file]??.5)*(h-1)),2,h-3);
      let sum=0,sum2=0,n=0,skySum=0,skyN=0,seaSum=0,seaN=0,edge=0;
      const lum=(x,y)=>{const i=(y*w+x)*4;const r=d[i]/255,gg=d[i+1]/255,b=d[i+2]/255;return .2126*r+.7152*gg+.0722*b;};
      for(let y=0;y<h;y++){
        for(let x=0;x<w;x++){
          const l=lum(x,y);sum+=l;sum2+=l*l;n++;
          if(y<hr){skySum+=l;skyN++;}else{seaSum+=l;seaN++;}
          if(x<w-1)edge+=Math.abs(l-lum(x+1,y));
          if(y<h-1)edge+=Math.abs(l-lum(x,y+1));
        }
      }
      const brightness=sum/n;
      const contrast=clamp(Math.sqrt(Math.max(0,sum2/n-brightness*brightness))/.24,0,1);
      const texture=clamp(edge/(n*.16),0,1);
      resolve({brightness,contrast,texture,skyBrightness:skyN?skySum/skyN:brightness,seaBrightness:seaN?seaSum/seaN:brightness});
    };
    img.onerror=()=>resolve({brightness:.5,contrast:.3,texture:.25,skyBrightness:.55,seaBrightness:.4});
    img.src=encodeURI(`./public/images/${file}`);
  });
}

async function analyseAll(){
  await Promise.all(images.map(async f=>{features[f]=await analyse(f);}));
  updateNow();
}

function noiseBuffer(context,seconds=4,brown=false){
  const b=context.createBuffer(1,context.sampleRate*seconds,context.sampleRate);
  const d=b.getChannelData(0);let last=0;
  for(let i=0;i<d.length;i++){
    const white=Math.random()*2-1;
    if(brown){last=(last+.018*white)/1.018;d[i]=last*2.4;}else d[i]=white*.35;
  }
  return b;
}

function loopNoise(context,brown=false){const s=context.createBufferSource();s.buffer=noiseBuffer(context,4,brown);s.loop=true;return s;}

async function init(){
  if(ctx){await ctx.resume();return;}
  ctx=new (window.AudioContext||window.webkitAudioContext)();
  master=ctx.createGain();master.gain.value=.42;master.connect(ctx.destination);

  oscA=ctx.createOscillator();oscB=ctx.createOscillator();harmonicOsc=ctx.createOscillator();
  oscA.type='sine';oscB.type='sine';harmonicOsc.type='sine';
  oscA.frequency.value=220;oscB.frequency.value=220.08;harmonicOsc.frequency.value=440.4;
  toneFilter=ctx.createBiquadFilter();toneFilter.type='lowpass';toneFilter.frequency.value=520;toneFilter.Q.value=.5;
  toneGain=ctx.createGain();toneGain.gain.value=.012;
  harmonicGain=ctx.createGain();harmonicGain.gain.value=.0015;
  oscA.connect(toneFilter);oscB.connect(toneFilter);toneFilter.connect(toneGain);toneGain.connect(master);
  harmonicOsc.connect(harmonicGain);harmonicGain.connect(master);

  seaNoise=loopNoise(ctx,true);seaFilter=ctx.createBiquadFilter();seaFilter.type='bandpass';seaFilter.frequency.value=650;seaFilter.Q.value=.65;
  seaGain=ctx.createGain();seaGain.gain.value=.026;seaNoise.connect(seaFilter);seaFilter.connect(seaGain);seaGain.connect(master);

  skyNoise=loopNoise(ctx,false);skyFilter=ctx.createBiquadFilter();skyFilter.type='highpass';skyFilter.frequency.value=4300;skyFilter.Q.value=.2;
  skyGain=ctx.createGain();skyGain.gain.value=.006;skyPan=ctx.createStereoPanner();skyNoise.connect(skyFilter);skyFilter.connect(skyPan);skyPan.connect(skyGain);skyGain.connect(master);

  oscA.start();oscB.start();harmonicOsc.start();seaNoise.start();skyNoise.start();
  await ctx.resume();started=true;analyseAll();requestAnimationFrame(loop);
}

function blend(a,b,c,p){
  const fallback={brightness:.5,contrast:.3,texture:.25,skyBrightness:.55,seaBrightness:.4};
  const fa=features[images[idx(a)]]||fallback,fb=features[images[idx(b)]]||fallback,fc=features[images[idx(c)]]||fallback;
  const wa0=.5*(1-p)*(1-p),wb0=.75-(p-.5)*(p-.5),wc0=.5*p*p,s=wa0+wb0+wc0;
  const wa=wa0/s,wb=wb0/s,wc=wc0/s;
  const mix=k=>fa[k]*wa+fb[k]*wb+fc[k]*wc;
  return {brightness:mix('brightness'),contrast:mix('contrast'),texture:mix('texture'),skyBrightness:mix('skyBrightness'),seaBrightness:mix('seaBrightness')};
}

function blendedHorizon(a,b,c,p){
  const h=horizons();const ha=h[images[idx(a)]]??.5,hb=h[images[idx(b)]]??.5,hc=h[images[idx(c)]]??.5;
  const wa0=.5*(1-p)*(1-p),wb0=.75-(p-.5)*(p-.5),wc0=.5*p*p,s=wa0+wb0+wc0;
  return (ha*wa0+hb*wb0+hc*wc0)/s;
}

function apply(a,b,c,p,progress=0){
  if(!ctx||ctx.state!=='running')return;
  const f=blend(a,b,c,p),horizon=blendedHorizon(a,b,c,p),now=ctx.currentTime;

  const drift=(horizon-.5)*.70;
  const base=220+drift;
  const beat=lerp(.035,.26,Math.pow(f.contrast,.9));
  oscA.frequency.setTargetAtTime(base,now,1.0);
  oscB.frequency.setTargetAtTime(base+beat,now,1.0);
  harmonicOsc.frequency.setTargetAtTime(base*2.002,now,1.1);

  const toneLPF=lerp(300,1250,Math.pow(f.brightness,.85));
  toneFilter.frequency.setTargetAtTime(toneLPF,now,1.15);
  toneGain.gain.setTargetAtTime(lerp(.007,.015,1-f.contrast*.45),now,1.2);
  harmonicGain.gain.setTargetAtTime(lerp(.0004,.0075,Math.pow(f.contrast,1.25)),now,1.15);

  const seaActivity=clamp(f.texture*.55+f.contrast*.30+(1-f.seaBrightness)*.15,0,1);
  const seaHz=lerp(260,1750,seaActivity);
  const seaLevel=lerp(.010,.060,clamp(f.texture*.45+f.contrast*.35+(1-f.seaBrightness)*.20,0,1));
  seaFilter.frequency.setTargetAtTime(seaHz,now,1.2);
  seaFilter.Q.setTargetAtTime(lerp(.45,1.15,f.contrast),now,1.2);
  seaGain.gain.setTargetAtTime(seaLevel,now,1.25);

  const skyOpen=clamp(f.skyBrightness*.82+f.brightness*.18,0,1);
  const skyHz=lerp(2600,9200,skyOpen);
  const skyLevel=lerp(.0015,.026,Math.pow(skyOpen,1.1));
  skyFilter.frequency.setTargetAtTime(skyHz,now,1.25);
  skyGain.gain.setTargetAtTime(skyLevel,now,1.25);
  skyPan.pan.setTargetAtTime(Math.sin(progress*Math.PI*2)*.25,now,1.2);

  updateMonitor(f,horizon,drift,beat,toneLPF,seaHz,seaLevel,skyHz,skyLevel,base);
}

function monitorNode(){
  let box=document.querySelector('#detailMonitor');if(box)return box;
  const parent=document.querySelector('#soundMonitor');if(!parent)return null;
  box=document.createElement('div');box.id='detailMonitor';
  box.innerHTML='<strong>IMAGE → SOUND</strong><br>Brightness <span id="dBrightness">—</span><br>Contrast <span id="dContrast">—</span><br>Texture <span id="dTexture">—</span><br>Horizon <span id="dHorizon">—</span><br>Pitch <span id="dBase">—</span> Hz<br>Beat <span id="dBeat">—</span> Hz';
  parent.appendChild(box);parent.style.gridTemplateColumns='repeat(5,minmax(120px,1fr))';return box;
}

function updateMonitor(f,horizon,drift,beat,toneLPF,seaHz,seaLevel,skyHz,skyLevel,base){
  monitorNode();const set=(id,v)=>{const e=document.querySelector(id);if(e)e.textContent=v;};
  set('#dBrightness',f.brightness.toFixed(3));set('#dContrast',f.contrast.toFixed(3));set('#dTexture',f.texture.toFixed(3));set('#dHorizon',horizon.toFixed(3));set('#dBase',base.toFixed(2));set('#dBeat',beat.toFixed(3));
  set('#mBaseHz',base.toFixed(2));set('#mBeatHz',beat.toFixed(3));set('#mToneFilter',Math.round(toneLPF));
  set('#mSeaFilter',Math.round(seaHz));set('#mSeaGain',seaLevel.toFixed(4));set('#mSkyFilter',Math.round(skyHz));set('#mSkyGain',skyLevel.toFixed(4));
}

function currentIndex(){const name=document.querySelector('#filename')?.textContent?.trim();const i=images.indexOf(name);return i>=0?i:current;}
function updateNow(){current=currentIndex();apply(current,current,current,.5,0);}
function loop(t){if(started&&playback&&ctx?.state==='running'){const progress=((t-playbackStart)/1000%duration)/duration;const cycle=progress*images.length,center=Math.floor(cycle)%images.length,p=cycle-Math.floor(cycle);apply(center-1,center,center+1,p,progress);}requestAnimationFrame(loop);}

// Replace the original sound button AFTER app.js attached its listener.
// The clone has no app.js audio listener, so only this engine will sound.
const originalSoundBtn=document.querySelector('#soundProxy');
const soundBtn=originalSoundBtn?.cloneNode(true);
if(originalSoundBtn&&soundBtn)originalSoundBtn.replaceWith(soundBtn);
const nextBtn=document.querySelector('#nextBtn'),prevBtn=document.querySelector('#prevBtn'),playBtn=document.querySelector('#playBtn'),exitBtn=document.querySelector('#exitPlayback'),slider=document.querySelector('#horizonSlider'),durationInput=document.querySelector('#durationInput');

monitorNode();
soundBtn?.addEventListener('click',async()=>{
  if(!ctx){soundBtn.textContent='Loading sound…';await init();soundBtn.textContent='Sound: on';setTimeout(updateNow,50);return;}
  if(ctx.state==='running'){await ctx.suspend();soundBtn.textContent='Sound: off';}
  else{await ctx.resume();soundBtn.textContent='Sound: on';updateNow();}
});
nextBtn?.addEventListener('click',()=>setTimeout(updateNow,0));prevBtn?.addEventListener('click',()=>setTimeout(updateNow,0));slider?.addEventListener('input',()=>setTimeout(updateNow,0));
playBtn?.addEventListener('click',()=>{playback=true;playbackStart=performance.now();duration=Math.max(12,+durationInput?.value||58);});
exitBtn?.addEventListener('click',()=>{playback=false;setTimeout(updateNow,0);});
