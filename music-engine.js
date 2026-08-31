const IMAGES=['North Atlantic.jpeg','North Atlantic_3.JPG','Bell Island.jpeg','Portugal Cove.jpeg','Fai Haven.jpeg','Etretat.jpeg','Poch Cove.jpeg','Poch Cove_2.jpeg','Portbou.jpeg','North Atlantic_3 2.jpeg','Cereal.jpeg','North Atlantic_2.jpeg'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const idx=i=>(i+IMAGES.length)%IMAGES.length;
const feat={};
let ctx=null,master=null,running=false,playback=false,startMs=0,lastStep=-1,current=0;

function horizons(){return JSON.parse(localStorage.getItem('liquidCommonsHorizons')||'{}');}
function hzFromMidi(m){return 440*Math.pow(2,(m-69)/12);}

async function analyse(file){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const w=96,h=72,c=document.createElement('canvas');c.width=w;c.height=h;
      const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0,w,h);
      const d=g.getImageData(0,0,w,h).data;
      const hr=clamp(Math.round((horizons()[file]??.5)*(h-1)),7,h-8);
      let lumSum=0,lum2=0,n=0,sky=0,skyN=0,sea=0,seaN=0,seaEdge=0;
      const lumAt=(x,y)=>{const i=(y*w+x)*4;return .2126*d[i]/255+.7152*d[i+1]/255+.0722*d[i+2]/255;};
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const l=lumAt(x,y);lumSum+=l;lum2+=l*l;n++;
        if(y<hr){sky+=l;skyN++;}else{sea+=l;seaN++;if(x<w-1)seaEdge+=Math.abs(l-lumAt(x+1,y));}
      }

      // Trace the strongest local horizontal boundary around the calibrated horizon.
      const trace=[];const strengths=[];
      for(let x=0;x<w;x++){
        let bestY=hr,best=0;
        for(let y=hr-6;y<=hr+6;y++){
          const grad=Math.abs(lumAt(x,y-1)-lumAt(x,y+1));
          if(grad>best){best=grad;bestY=y;}
        }
        trace.push(bestY);strengths.push(best);
      }
      const smooth=trace.map((_,i)=>{
        let s=0,k=0;for(let j=Math.max(0,i-2);j<=Math.min(w-1,i+2);j++){s+=trace[j];k++;}return s/k;
      });
      const slope=clamp((smooth[w-1]-smooth[0])/12,-1,1);
      let rough=0;
      for(let i=1;i<w;i++)rough+=Math.abs(smooth[i]-smooth[i-1]);
      rough=clamp((rough/(w-1))/1.8,0,1);
      const horizonStrength=clamp((strengths.reduce((a,b)=>a+b,0)/w)/.22,0,1);

      const brightness=lumSum/n;
      const contrast=clamp(Math.sqrt(Math.max(0,lum2/n-brightness*brightness))/.28,0,1);
      resolve({brightness,contrast,skyBrightness:sky/Math.max(1,skyN),seaBrightness:sea/Math.max(1,seaN),seaTexture:clamp(seaEdge/Math.max(1,seaN*.12),0,1),horizonSlope:slope,horizonRoughness:rough,horizonStrength});
    };
    img.onerror=()=>resolve({brightness:.5,contrast:.3,skyBrightness:.55,seaBrightness:.4,seaTexture:.25,horizonSlope:0,horizonRoughness:.1,horizonStrength:.5});
    img.src=encodeURI(`./public/images/${file}`);
  });
}

function weights(a,b,c,p){const A=.5*(1-p)*(1-p),B=.75-(p-.5)*(p-.5),C=.5*p*p,s=A+B+C;return[A/s,B/s,C/s];}
function blend(a,b,c,p){const [wa,wb,wc]=weights(a,b,c,p);const fa=feat[IMAGES[idx(a)]]||{},fb=feat[IMAGES[idx(b)]]||{},fc=feat[IMAGES[idx(c)]]||{};const mix=k=>(fa[k]??.5)*wa+(fb[k]??.5)*wb+(fc[k]??.5)*wc;return{brightness:mix('brightness'),contrast:mix('contrast'),skyBrightness:mix('skyBrightness'),seaBrightness:mix('seaBrightness'),seaTexture:mix('seaTexture'),horizonSlope:mix('horizonSlope'),horizonRoughness:mix('horizonRoughness'),horizonStrength:mix('horizonStrength')};}
function blendHorizon(a,b,c,p){const h=horizons(),[wa,wb,wc]=weights(a,b,c,p);return(h[IMAGES[idx(a)]]??.5)*wa+(h[IMAGES[idx(b)]]??.5)*wb+(h[IMAGES[idx(c)]]??.5)*wc;}

function trumpet(freq,when,dur,level,articulation='legato',bend=0,strength=.5){
  const o1=ctx.createOscillator(),o2=ctx.createOscillator(),bp=ctx.createBiquadFilter(),lp=ctx.createBiquadFilter(),g=ctx.createGain();
  o1.type='sawtooth';o2.type='square';
  const endFreq=freq*Math.pow(2,bend/12);
  o1.frequency.setValueAtTime(freq,when);o2.frequency.setValueAtTime(freq*2.002,when);
  if(Math.abs(bend)>.01){o1.frequency.exponentialRampToValueAtTime(endFreq,when+dur*.82);o2.frequency.exponentialRampToValueAtTime(endFreq*2.002,when+dur*.82);}
  bp.type='bandpass';bp.frequency.setValueAtTime(lerp(950,1550,strength),when);bp.Q.value=articulation==='staccato'?1.45:1.0;
  lp.type='lowpass';lp.frequency.setValueAtTime(articulation==='breathy'?2200:3600,when);
  const attack=articulation==='staccato'?0.008:(articulation==='marcato'?0.015:0.045);
  const peak=articulation==='marcato'?level*1.25:level;
  g.gain.setValueAtTime(.0001,when);g.gain.exponentialRampToValueAtTime(peak,when+attack);
  if(articulation==='staccato')g.gain.exponentialRampToValueAtTime(.0001,when+dur*.72);
  else{g.gain.exponentialRampToValueAtTime(level*.48,when+dur*.62);g.gain.exponentialRampToValueAtTime(.0001,when+dur);}
  o1.connect(bp);o2.connect(bp);bp.connect(lp);lp.connect(g);g.connect(master);o1.start(when);o2.start(when);o1.stop(when+dur+.05);o2.stop(when+dur+.05);
}

function strings(freq,when,dur,level,high=false,texture=.2){
  const mix=ctx.createGain(),f=ctx.createBiquadFilter(),g=ctx.createGain();
  f.type='lowpass';f.frequency.setValueAtTime(high?lerp(2600,5200,texture):lerp(900,2400,texture),when);f.Q.value=.35;
  g.gain.setValueAtTime(.0001,when);g.gain.exponentialRampToValueAtTime(level,when+.28);g.gain.setValueAtTime(level,when+Math.max(.3,dur-.35));g.gain.exponentialRampToValueAtTime(.0001,when+dur);
  [-8,0,7].forEach(c=>{const o=ctx.createOscillator();o.type='sawtooth';o.frequency.setValueAtTime(freq*Math.pow(2,c/1200),when);o.connect(mix);o.start(when);o.stop(when+dur+.1);});
  mix.gain.value=.34;mix.connect(f);f.connect(g);g.connect(master);
}

function params(a,b,c,p){
  const f=blend(a,b,c,p),h=blendHorizon(a,b,c,p);
  const scale=[0,2,3,5,7,8,10];
  const degree=clamp(Math.round((1-h)*(scale.length-1)),0,scale.length-1);
  const trumpetMidi=60+scale[degree];
  const skyInterval=f.skyBrightness>.62?12:(f.skyBrightness>.45?9:7);
  const seaInterval=f.seaBrightness<.38?-12:-7;
  const density=f.contrast>.68?4:(f.contrast>.42?3:2);
  let articulation='legato';
  if(f.horizonRoughness>.58)articulation='staccato';
  else if(f.horizonStrength>.72&&f.contrast>.55)articulation='marcato';
  else if(f.horizonStrength<.32)articulation='breathy';
  else if(Math.abs(f.horizonSlope)>.18)articulation='portamento';
  const bend=articulation==='portamento'?clamp(-f.horizonSlope*1.5,-1.2,1.2):clamp(-f.horizonSlope*.28,-.25,.25);
  return{f,h,trumpetMidi,skyMidi:trumpetMidi+skyInterval,seaMidi:trumpetMidi+seaInterval,density,articulation,bend};
}

function scheduleMoment(a,b,c,p,stepIndex){
  if(!ctx||ctx.state!=='running')return;
  const q=params(a,b,c,p),now=ctx.currentTime+.03;
  const accent=(stepIndex%q.density===0);
  const dur=q.articulation==='staccato'?(accent?.22:.14):(q.articulation==='marcato'?.55:(accent?.88:.52));
  trumpet(hzFromMidi(q.trumpetMidi),now,dur,accent?.024:.014,q.articulation,q.bend,q.f.horizonStrength);
  if(accent){
    strings(hzFromMidi(q.skyMidi),now,1.15,lerp(.005,.016,q.f.skyBrightness),true,q.f.brightness);
    strings(hzFromMidi(q.seaMidi),now,1.25,lerp(.008,.021,q.f.seaTexture),false,q.f.seaTexture);
  }
  updateMonitor(q);
}

function updateMonitor(q){
  let box=document.querySelector('#musicMonitor');const parent=document.querySelector('#soundMonitor');
  if(parent&&!box){parent.innerHTML='';box=document.createElement('div');box.id='musicMonitor';parent.appendChild(box);}
  if(!box)return;
  box.innerHTML=`<strong>HORIZON → TRUMPET</strong><br>Articulation ${q.articulation}<br>Pitch MIDI ${q.trumpetMidi}<br>Horizon ${q.h.toFixed(3)}<br>Slope ${q.f.horizonSlope.toFixed(3)}<br>Roughness ${q.f.horizonRoughness.toFixed(3)}<br>Line strength ${q.f.horizonStrength.toFixed(3)}<br>Pitch bend ${q.bend.toFixed(2)} st<br><br><strong>STRINGS</strong><br>Brightness ${q.f.brightness.toFixed(3)}<br>Contrast ${q.f.contrast.toFixed(3)}<br>Rhythm ${q.density} steps`;
}

async function analyseAll(){const entries=await Promise.all(IMAGES.map(async f=>[f,await analyse(f)]));entries.forEach(([k,v])=>feat[k]=v);}
async function init(){
  if(ctx){await ctx.resume();running=true;return;}
  ctx=new (window.AudioContext||window.webkitAudioContext)();master=ctx.createGain();master.gain.value=.48;master.connect(ctx.destination);await ctx.resume();running=true;await analyseAll();scheduleCurrent();
}
function currentIndex(){const name=document.querySelector('#filename')?.textContent?.trim();const i=IMAGES.indexOf(name);return i>=0?i:current;}
function scheduleCurrent(){current=currentIndex();scheduleMoment(current,current,current,.5,0);}

function loop(t){
  if(running&&playback&&ctx?.state==='running'){
    const dur=Math.max(12,+document.querySelector('#durationInput')?.value||58),prog=(((t-startMs)/1000)%dur)/dur,cycle=prog*IMAGES.length,center=Math.floor(cycle)%IMAGES.length,p=cycle-Math.floor(cycle);
    const q=params(center-1,center,center+1,p),step=Math.floor(cycle*q.density);
    if(step!==lastStep){lastStep=step;scheduleMoment(center-1,center,center+1,p,step);}
  }
  requestAnimationFrame(loop);
}

const oldBtn=document.querySelector('#soundProxy');
if(oldBtn){const clone=oldBtn.cloneNode(true);oldBtn.replaceWith(clone);clone.textContent='Start music';clone.addEventListener('click',async()=>{if(!ctx){await init();clone.textContent='Music: on';}else if(ctx.state==='running'){await ctx.suspend();clone.textContent='Music: off';}else{await ctx.resume();clone.textContent='Music: on';scheduleCurrent();}});}
document.querySelector('#nextBtn')?.addEventListener('click',()=>setTimeout(scheduleCurrent,0));
document.querySelector('#prevBtn')?.addEventListener('click',()=>setTimeout(scheduleCurrent,0));
document.querySelector('#horizonSlider')?.addEventListener('change',async()=>{const f=IMAGES[currentIndex()];feat[f]=await analyse(f);scheduleCurrent();});
document.querySelector('#playBtn')?.addEventListener('click',()=>{playback=true;startMs=performance.now();lastStep=-1;});
document.querySelector('#exitPlayback')?.addEventListener('click',()=>{playback=false;lastStep=-1;setTimeout(scheduleCurrent,0);});
requestAnimationFrame(loop);
