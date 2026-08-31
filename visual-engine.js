import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

const images=[
  'North Atlantic.jpeg','North Atlantic_3.JPG','Bell Island.jpeg','Portugal Cove.jpeg',
  'Fai Haven.jpeg','Etretat.jpeg','Poch Cove.jpeg','Poch Cove_2.jpeg',
  'Portbou.jpeg','North Atlantic_3 2.jpeg','Cereal.jpeg','North Atlantic_2.jpeg'
];

const TARGET_WIDTH=7680, TARGET_HEIGHT=856, TARGET_ASPECT=TARGET_WIDTH/TARGET_HEIGHT;
const RECORD_WIDTH=3840, RECORD_HEIGHT=428, RECORD_FPS=24, RECORD_BITRATE=15000000;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const idx=i=>(i+images.length)%images.length;

function loadHorizons(){
  const saved=JSON.parse(localStorage.getItem('liquidCommonsHorizons')||'{}');
  return Object.fromEntries(images.map(f=>[f,saved[f]??0.5]));
}
const horizons=loadHorizons();

let current=0,playback=false,recording=false,startTime=performance.now(),totalDuration=58,morphStrength=.030;

const stage=document.querySelector('#stage');
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,alpha:false});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.setClearColor(0x111111,1);
stage.appendChild(renderer.domElement);

const scene=new THREE.Scene();
const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const material=new THREE.ShaderMaterial({
  uniforms:{
    uA:{value:null},uB:{value:null},uC:{value:null},uPhase:{value:.5},uTime:{value:0},
    uHorizonA:{value:.5},uHorizonB:{value:.5},uHorizonC:{value:.5},
    uSourceAspectA:{value:1.333},uSourceAspectB:{value:1.333},uSourceAspectC:{value:1.333},
    uTargetAspect:{value:TARGET_ASPECT},uStrength:{value:morphStrength}
  },
  vertexShader:`varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.0);}`,
  fragmentShader:`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uA; uniform sampler2D uB; uniform sampler2D uC;
    uniform float uPhase,uTime,uHorizonA,uHorizonB,uHorizonC;
    uniform float uSourceAspectA,uSourceAspectB,uSourceAspectC,uTargetAspect,uStrength;

    vec2 sourceUV(vec2 uv,float horizon,float srcAspect){
      float visible=srcAspect/uTargetAspect;
      float d=uv.y-.5;
      float mask=pow(clamp(abs(d)*2.0,0.0,1.0),1.55);
      float wave=sin(uv.y*9.0+uTime)+.18*sin(uv.y*20.0-2.0*uTime);
      float x=uv.x+wave*uStrength*.010*mask;
      // Calibration values are measured from the TOP of the source image.
      // Three.js texture coordinates are bottom-origin, so invert once here.
      float y=(1.0-horizon)+d*visible;
      return vec2(clamp(x,.002,.998),clamp(y,.002,.998));
    }

    void main(){
      float p=clamp(uPhase,0.0,1.0);
      vec4 a=texture2D(uA,sourceUV(vUv,uHorizonA,uSourceAspectA));
      vec4 b=texture2D(uB,sourceUV(vUv,uHorizonB,uSourceAspectB));
      vec4 c=texture2D(uC,sourceUV(vUv,uHorizonC,uSourceAspectC));
      float wA=.5*(1.0-p)*(1.0-p);
      float wB=.75-(p-.5)*(p-.5);
      float wC=.5*p*p;
      float s=wA+wB+wC;
      gl_FragColor=vec4(((a*wA+b*wB+c*wC)/s).rgb,1.0);
    }
  `
});
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));

const textures=new Array(images.length).fill(null);
const loader=new THREE.TextureLoader();
function prepTexture(t){
  t.colorSpace=THREE.SRGBColorSpace;t.minFilter=THREE.LinearFilter;t.magFilter=THREE.LinearFilter;
  t.wrapS=THREE.ClampToEdgeWrapping;t.wrapT=THREE.ClampToEdgeWrapping;return t;
}
function texAspect(t){return t?.image?.width&&t?.image?.height?t.image.width/t.image.height:1.333;}

function refreshSavedHorizons(){
  const saved=JSON.parse(localStorage.getItem('liquidCommonsHorizons')||'{}');
  images.forEach(f=>{if(saved[f]!=null) horizons[f]=saved[f];});
}

function setTriple(a,b,c,phase=.5){
  refreshSavedHorizons();
  a=idx(a);b=idx(b);c=idx(c);
  const ta=textures[a],tb=textures[b],tc=textures[c];
  if(!ta||!tb||!tc)return false;
  material.uniforms.uA.value=ta;material.uniforms.uB.value=tb;material.uniforms.uC.value=tc;
  material.uniforms.uPhase.value=phase;
  material.uniforms.uHorizonA.value=horizons[images[a]];
  material.uniforms.uHorizonB.value=horizons[images[b]];
  material.uniforms.uHorizonC.value=horizons[images[c]];
  material.uniforms.uSourceAspectA.value=texAspect(ta);
  material.uniforms.uSourceAspectB.value=texAspect(tb);
  material.uniforms.uSourceAspectC.value=texAspect(tc);
  return true;
}
function setSingle(i){return setTriple(i,i,i,.5);}

images.forEach((file,i)=>loader.load(encodeURI(`./public/images/${file}`),t=>{
  textures[i]=prepTexture(t);
  if(typeof renderer.initTexture==='function')renderer.initTexture(textures[i]);
  if(!playback&&i===current)setSingle(current);
},undefined,e=>console.error('Failed to load',file,e)));

function resize(){
  if(recording)return;
  const r=stage.getBoundingClientRect();
  renderer.setSize(Math.max(2,r.width),Math.max(2,r.height),false);
}
window.addEventListener('resize',resize);

const slider=document.querySelector('#horizonSlider');
const value=document.querySelector('#horizonValue');
const filename=document.querySelector('#filename');
const counter=document.querySelector('#counter');
const morphInput=document.querySelector('#morphInput');
const morphValue=document.querySelector('#morphValue');
const durationInput=document.querySelector('#durationInput');
const recordBtn=document.querySelector('#recordBtn');
const recordStatus=document.querySelector('#recordStatus');
const prevBtn=document.querySelector('#prevBtn');
const nextBtn=document.querySelector('#nextBtn');
const playBtn=document.querySelector('#playBtn');
const exitPlayback=document.querySelector('#exitPlayback');

function updateUI(){
  refreshSavedHorizons();
  slider.value=horizons[images[current]];
  value.textContent=(+slider.value).toFixed(3);
  filename.textContent=images[current];
  counter.textContent=`${current+1} / ${images.length}`;
  setSingle(current);
}

slider.addEventListener('input',()=>{
  horizons[images[current]]=+slider.value;
  value.textContent=(+slider.value).toFixed(3);
  localStorage.setItem('liquidCommonsHorizons',JSON.stringify(horizons));
  setSingle(current);
});
prevBtn.addEventListener('click',()=>{playback=false;document.body.classList.remove('playback');current=idx(current-1);updateUI();resize();});
nextBtn.addEventListener('click',()=>{playback=false;document.body.classList.remove('playback');current=idx(current+1);updateUI();resize();});

totalDuration=Math.max(12,+durationInput?.value||58);
recordBtn.textContent=`Record ${totalDuration}s`;
durationInput.addEventListener('input',e=>{totalDuration=Math.max(12,+e.target.value||58);recordBtn.textContent=`Record ${totalDuration}s`;});
morphInput.value=morphStrength;morphValue.textContent=morphStrength.toFixed(3);
morphInput.addEventListener('input',e=>{morphStrength=+e.target.value;material.uniforms.uStrength.value=morphStrength;morphValue.textContent=morphStrength.toFixed(3);});

playBtn.addEventListener('click',()=>{
  refreshSavedHorizons();playback=true;document.body.classList.add('playback');startTime=performance.now();resize();
});
exitPlayback.addEventListener('click',()=>{
  if(recording)return;playback=false;document.body.classList.remove('playback');current=0;updateUI();resize();
});

function recorderMime(){
  return ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4;codecs=avc1.42E01E','video/mp4']
    .find(t=>window.MediaRecorder?.isTypeSupported?.(t))||'';
}
recordBtn.addEventListener('click',async()=>{
  if(recording)return;
  if(!renderer.domElement.captureStream||!window.MediaRecorder){alert('Use Google Chrome to record.');return;}
  if(!textures.every(Boolean)){alert('Images are still loading. Wait a few seconds.');return;}
  refreshSavedHorizons();
  recording=true;recordBtn.disabled=true;recordStatus.textContent=`Preparing ${RECORD_WIDTH}×${RECORD_HEIGHT}…`;
  const oldRatio=renderer.getPixelRatio();renderer.setPixelRatio(1);renderer.setSize(RECORD_WIDTH,RECORD_HEIGHT,false);
  playback=true;document.body.classList.add('playback');startTime=performance.now();material.uniforms.uTime.value=0;
  setTriple(images.length-1,0,1,0);renderer.render(scene,camera);
  const stream=renderer.domElement.captureStream(RECORD_FPS),mime=recorderMime();
  let rec;try{rec=new MediaRecorder(stream,mime?{mimeType:mime,videoBitsPerSecond:RECORD_BITRATE}:{videoBitsPerSecond:RECORD_BITRATE});}catch{rec=new MediaRecorder(stream);}
  const chunks=[];rec.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
  rec.onstop=()=>{
    const type=rec.mimeType||mime||'video/webm',ext=type.includes('mp4')?'mp4':'webm';
    const blob=new Blob(chunks,{type}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`Common_Horizon_${RECORD_WIDTH}x${RECORD_HEIGHT}_${totalDuration}s.${ext}`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    recording=false;playback=false;document.body.classList.remove('playback');renderer.setPixelRatio(oldRatio);resize();current=0;updateUI();recordBtn.disabled=false;recordStatus.textContent=`Exported ${RECORD_WIDTH}×${RECORD_HEIGHT} ${ext.toUpperCase()}`;
  };
  rec.start(1000);recordStatus.textContent=`Recording ${totalDuration}s at ${RECORD_WIDTH}×${RECORD_HEIGHT}, ${RECORD_FPS}fps…`;
  setTimeout(()=>{if(rec.state!=='inactive')rec.stop();},totalDuration*1000+120);
});

resize();updateUI();
function loop(now){
  const elapsed=(now-startTime)/1000;
  const progress=playback?((elapsed%totalDuration)/totalDuration):0;
  material.uniforms.uTime.value=playback?progress*Math.PI*2:(now/1000)*.015;
  if(playback){
    const cycle=progress*images.length,center=Math.floor(cycle)%images.length,phase=cycle-Math.floor(cycle);
    if(!setTriple(center-1,center,center+1,phase))setSingle(current);
  }
  renderer.render(scene,camera);requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
