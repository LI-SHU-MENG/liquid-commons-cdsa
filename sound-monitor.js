const images = [
  'North Atlantic.jpeg',
  'North Atlantic_3.JPG',
  'Bell Island.jpeg',
  'Portugal Cove.jpeg',
  'Fai Haven.jpeg',
  'Etretat.jpeg',
  'Poch Cove.jpeg',
  'Poch Cove_2.jpeg',
  'Portbou.jpeg',
  'North Atlantic_3 2.jpeg',
  'Cereal.jpeg',
  'North Atlantic_2.jpeg'
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const idx = i => (i + images.length) % images.length;

const defaults = {
  skyBrightness: 0.6, skySaturation: 0.25, skyWarmth: 0.5, skyEdgeDensity: 0.08,
  seaBrightness: 0.4, seaSaturation: 0.35, seaWarmth: 0.5, seaEdgeDensity: 0.18,
  horizonContrast: 0.12
};

const features = {};
let playbackStart = null;

function horizons() {
  const saved = JSON.parse(localStorage.getItem('liquidCommonsHorizons') || '{}');
  return Object.fromEntries(images.map(f => [f, saved[f] ?? 0.5]));
}

async function analyse(fileName) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const w = 72, h = 72;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, w, h);
      const { data } = x.getImageData(0, 0, w, h);
      const hr = clamp(Math.round((horizons()[fileName] ?? 0.5) * (h - 1)), 2, h - 3);
      const rowLum = new Array(h).fill(0);
      const sky = { brightness:0, saturation:0, warmth:0, edges:0, count:0 };
      const sea = { brightness:0, saturation:0, warmth:0, edges:0, count:0 };
      const lumAt = (px, py) => {
        const i = (py * w + px) * 4;
        const r = data[i]/255, g = data[i+1]/255, b = data[i+2]/255;
        return 0.2126*r + 0.7152*g + 0.0722*b;
      };
      for (let y=0; y<h; y++) {
        for (let px=0; px<w; px++) {
          const i = (y*w+px)*4;
          const r=data[i]/255, g=data[i+1]/255, b=data[i+2]/255;
          const max=Math.max(r,g,b), min=Math.min(r,g,b);
          const sat=max===0?0:(max-min)/max;
          const lum=0.2126*r+0.7152*g+0.0722*b;
          const warmth=clamp(0.5+(r-b)*0.5,0,1);
          const reg=y<hr?sky:sea;
          reg.brightness+=lum; reg.saturation+=sat; reg.warmth+=warmth; reg.count++;
          rowLum[y]+=lum;
          if(px<w-1) reg.edges+=Math.abs(lum-lumAt(px+1,y));
          if(y<h-1) reg.edges+=Math.abs(lum-lumAt(px,y+1));
        }
      }
      for(let y=0;y<h;y++) rowLum[y]/=w;
      const avg=(r,k,f)=>r.count?r[k]/r.count:f;
      resolve({
        skyBrightness:avg(sky,'brightness',defaults.skyBrightness),
        skySaturation:avg(sky,'saturation',defaults.skySaturation),
        skyWarmth:avg(sky,'warmth',defaults.skyWarmth),
        skyEdgeDensity:clamp(sky.edges/Math.max(1,sky.count*0.20),0,1),
        seaBrightness:avg(sea,'brightness',defaults.seaBrightness),
        seaSaturation:avg(sea,'saturation',defaults.seaSaturation),
        seaWarmth:avg(sea,'warmth',defaults.seaWarmth),
        seaEdgeDensity:clamp(sea.edges/Math.max(1,sea.count*0.20),0,1),
        horizonContrast:clamp(Math.abs(rowLum[hr-1]-rowLum[hr+1])*4.0,0,1)
      });
    };
    img.onerror = () => resolve({...defaults});
    img.src = encodeURI(`./public/images/${fileName}`);
  });
}

function blend(a,b,c,phase){
  const fa=features[images[idx(a)]]||defaults;
  const fb=features[images[idx(b)]]||defaults;
  const fc=features[images[idx(c)]]||defaults;
  const wa0=0.5*(1-phase)*(1-phase);
  const wb0=0.75-(phase-0.5)*(phase-0.5);
  const wc0=0.5*phase*phase;
  const sum=wa0+wb0+wc0;
  const wa=wa0/sum, wb=wb0/sum, wc=wc0/sum;
  const mix=k=>fa[k]*wa+fb[k]*wb+fc[k]*wc;
  return Object.fromEntries(Object.keys(defaults).map(k=>[k,mix(k)]));
}

function derive(f){
  const meanWarmth=(f.skyWarmth+f.seaWarmth)*0.5;
  const meanBrightness=(f.skyBrightness+f.seaBrightness)*0.5;
  const baseHz=110+(meanWarmth-0.5)*0.55+(meanBrightness-0.5)*0.22;
  const structuralEnergy=clamp(f.seaEdgeDensity*0.55+f.skyEdgeDensity*0.15+f.horizonContrast*0.30,0,1);
  const beatHz=lerp(0.08,0.18,structuralEnergy);
  const toneFilterHz=lerp(185,315,clamp(meanBrightness*0.65+f.horizonContrast*0.35,0,1));
  const seaActivity=clamp(f.seaEdgeDensity*0.65+f.seaSaturation*0.25+(1-f.seaBrightness)*0.10,0,1);
  const seaFilterHz=lerp(360,1120,seaActivity);
  const seaGain=lerp(0.036,0.068,clamp(f.seaEdgeDensity*0.65+f.seaSaturation*0.20+(1-f.horizonContrast)*0.15,0,1));
  const skyAir=clamp(f.skyBrightness*0.72+(1-f.skyEdgeDensity)*0.18+(1-f.skyWarmth)*0.10,0,1);
  const skyFilterHz=lerp(4200,7800,skyAir);
  const skyGain=lerp(0.0035,0.0135,clamp(f.skyBrightness*0.75+f.skySaturation*0.15+(1-f.skyEdgeDensity)*0.10,0,1));
  return {baseHz,beatHz,toneFilterHz,seaFilterHz,seaGain,skyFilterHz,skyGain};
}

function set(id, value){ const el=document.getElementById(id); if(el) el.textContent=value; }

function render(f, d){
  set('mBaseHz', d.baseHz.toFixed(2));
  set('mBeatHz', d.beatHz.toFixed(3));
  set('mToneFilter', Math.round(d.toneFilterHz));
  set('mHorizonContrast', f.horizonContrast.toFixed(3));
  set('mSeaBrightness', f.seaBrightness.toFixed(3));
  set('mSeaTexture', f.seaEdgeDensity.toFixed(3));
  set('mSeaFilter', Math.round(d.seaFilterHz));
  set('mSeaGain', d.seaGain.toFixed(4));
  set('mSkyBrightness', f.skyBrightness.toFixed(3));
  set('mSkyTexture', f.skyEdgeDensity.toFixed(3));
  set('mSkyFilter', Math.round(d.skyFilterHz));
  set('mSkyGain', d.skyGain.toFixed(4));
}

function currentManualIndex(){
  const name=(document.getElementById('filename')?.textContent||'').trim();
  const i=images.indexOf(name);
  return i>=0?i:0;
}

function tick(now){
  let f;
  if(document.body.classList.contains('playback') && playbackStart!==null){
    const duration=Math.max(12,Number(document.getElementById('durationInput')?.value||58));
    const progress=(((now-playbackStart)/1000)%duration)/duration;
    const cycle=progress*images.length;
    const center=Math.floor(cycle)%images.length;
    const phase=cycle-Math.floor(cycle);
    f=blend(center-1,center,center+1,phase);
  }else{
    const i=currentManualIndex();
    f=features[images[i]]||defaults;
  }
  render(f,derive(f));
  requestAnimationFrame(tick);
}

async function boot(){
  const entries=await Promise.all(images.map(async f=>[f,await analyse(f)]));
  for(const [f,v] of entries) features[f]=v;
  document.getElementById('playBtn')?.addEventListener('click',()=>{playbackStart=performance.now();});
  document.getElementById('exitPlayback')?.addEventListener('click',()=>{playbackStart=null;});
  requestAnimationFrame(tick);
}

boot();
