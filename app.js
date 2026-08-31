import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

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

const TARGET_WIDTH=7680;
const TARGET_HEIGHT=856;
const TARGET_ASPECT=TARGET_WIDTH/TARGET_HEIGHT;
const saved=JSON.parse(localStorage.getItem('liquidCommonsHorizons')||'{}');
const horizons=Object.fromEntries(images.map(f=>[f,saved[f]??0.5]));
let current=0, playback=false, startTime=performance.now();
let totalDuration=150, morphStrength=0.050;
let recording=false;

const stage=document.querySelector('#stage');
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,alpha:false});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.setClearColor(0x111111,1);
stage.appendChild(renderer.domElement);
const scene=new THREE.Scene();
const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);

const material=new THREE.ShaderMaterial({
  uniforms:{uA:{value:null},uB:{value:null},uMix:{value:0},uTime:{value:0},uHorizonA:{value:.5},uHorizonB:{value:.5},uSourceAspectA:{value:1.333},uSourceAspectB:{value:1.333},uTargetAspect:{value:TARGET_ASPECT},uStrength:{value:morphStrength}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.0);}`,
  fragmentShader:`
    precision highp float;varying vec2 vUv;
    uniform sampler2D uA,uB;uniform float uMix,uTime,uHorizonA,uHorizonB,uSourceAspectA,uSourceAspectB,uTargetAspect,uStrength;

    vec2 sourceUV(vec2 uv,float horizon,float srcAspect,float phase){
      float visible=srcAspect/uTargetAspect;
      float d=uv.y-.5;
      float horizonMask=pow(clamp(abs(d)*2.0,0.0,1.0),1.55);

      // A restrained horizontal current only. The calibrated horizon never moves vertically.
      float wave=sin(uv.y*12.0+uTime*.055+phase)
               +0.30*sin(uv.y*27.0-uTime*.035+phase*1.35);
      float x=uv.x + wave*uStrength*.022*horizonMask;
      float y=horizon+d*visible;
      return vec2(clamp(x,0.002,.998),clamp(y,0.002,.998));
    }

    void main(){
      float m=clamp(uMix,0.0,1.0);
      float horizonDist=abs(vUv.y-.5);

      // One continuous transition: it starts immediately and only finishes
      // on the exact last frame of the segment, so there is no hold between images.
      float soft=0.34;
      float front=mix(-0.42,1.42,m);
      float organic=(0.014*sin(vUv.y*15.0+uTime*.045)
                    +0.008*sin(vUv.y*31.0-uTime*.028)
                    +0.004*sin(vUv.x*5.0+vUv.y*11.0));
      organic*=smoothstep(0.025,0.44,horizonDist);

      float localMix=1.0-smoothstep(front-soft,front+soft,vUv.x+organic);
      localMix=clamp(localMix,0.0,1.0);

      vec2 uvA=sourceUV(vUv,uHorizonA,uSourceAspectA,0.0);
      vec2 uvB=sourceUV(vUv,uHorizonB,uSourceAspectB,0.9);
      vec4 a=texture2D(uA,uvA);
      vec4 b=texture2D(uB,uvB);

      // Pure two-image interpolation: no dark overlay, no empty gap, no edge push.
      gl_FragColor=mix(a,b,localMix);
    }`
});
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));

const textures=new Array(images.length).fill(null);
const loader=new THREE.TextureLoader();
function prepTexture(tex){
  tex.colorSpace=THREE.SRGBColorSpace;
  tex.minFilter=THREE.LinearFilter;
  tex.magFilter=THREE.LinearFilter;
  tex.wrapS=THREE.ClampToEdgeWrapping;
  tex.wrapT=THREE.ClampToEdgeWrapping;
  return tex;
}
function texAspect(t){return t?.image?.width&&t?.image?.height?t.image.width/t.image.height:1.333}
function setPair(a,b,m=0){
  const ta=textures[a];
  const tb=textures[b]||ta;
  if(!ta) return false;
  material.uniforms.uA.value=ta;
  material.uniforms.uB.value=tb;
  material.uniforms.uMix.value=m;
  material.uniforms.uHorizonA.value=horizons[images[a]];
  material.uniforms.uHorizonB.value=horizons[images[b]];
  material.uniforms.uSourceAspectA.value=texAspect(ta);
  material.uniforms.uSourceAspectB.value=texAspect(tb);
  return true;
}

images.forEach((file,i)=>loader.load(encodeURI(`./public/images/${file}`),tex=>{
  textures[i]=prepTexture(tex);
  if(typeof renderer.initTexture==='function') renderer.initTexture(textures[i]);
  if(i===current && !playback) setPair(i,i,0);
},undefined,e=>console.error('Failed to load',file,e)));

function resize(){
  if(recording) return;
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

function updateUI(){
  slider.value=horizons[images[current]];
  value.textContent=(+slider.value).toFixed(3);
  filename.textContent=images[current];
  counter.textContent=`${current+1} / ${images.length}`;
  setPair(current,current,0);
}
slider.addEventListener('input',()=>{
  horizons[images[current]]=+slider.value;
  value.textContent=(+slider.value).toFixed(3);
  localStorage.setItem('liquidCommonsHorizons',JSON.stringify(horizons));
  setPair(current,current,0);
});
document.querySelector('#prevBtn').onclick=()=>{current=(current-1+images.length)%images.length;updateUI()};
document.querySelector('#nextBtn').onclick=()=>{current=(current+1)%images.length;updateUI()};
durationInput.value=totalDuration;
durationInput.oninput=e=>{
  totalDuration=Math.max(12,+e.target.value||150);
  recordBtn.textContent=`Record ${totalDuration}s`;
};
morphInput.value=morphStrength;
morphValue.textContent=morphStrength.toFixed(3);
morphInput.oninput=e=>{
  morphStrength=+e.target.value;
  material.uniforms.uStrength.value=morphStrength;
  morphValue.textContent=morphStrength.toFixed(3);
};
document.querySelector('#playBtn').onclick=()=>{
  playback=true;
  document.body.classList.add('playback');
  startTime=performance.now();
  resize();
};
document.querySelector('#exitPlayback').onclick=()=>{
  if(recording)return;
  playback=false;
  document.body.classList.remove('playback');
  current=0;
  updateUI();
  resize();
};

function getRecorderMime(){
  const candidates=[
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  return candidates.find(t=>window.MediaRecorder?.isTypeSupported?.(t))||'';
}

recordBtn.onclick=async()=>{
  if(recording) return;
  if(!renderer.domElement.captureStream || !window.MediaRecorder){
    alert('This browser cannot record the canvas directly. Try Chrome or Safari 18+.');
    return;
  }
  if(!textures.every(Boolean)){
    alert('Images are still loading. Wait a few seconds, then press Record again.');
    return;
  }

  recording=true;
  recordBtn.disabled=true;
  recordStatus.textContent='Preparing 7680×856…';

  const previousPixelRatio=renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setSize(TARGET_WIDTH,TARGET_HEIGHT,false);

  playback=true;
  document.body.classList.add('playback');
  startTime=performance.now();
  material.uniforms.uTime.value=0;
  setPair(0,1,0);
  renderer.render(scene,camera);

  const stream=renderer.domElement.captureStream(30);
  const mime=getRecorderMime();
  const options=mime?{mimeType:mime,videoBitsPerSecond:50000000}:{videoBitsPerSecond:50000000};
  let recorder;
  try{recorder=new MediaRecorder(stream,options)}catch(e){recorder=new MediaRecorder(stream)}
  const chunks=[];
  recorder.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
  recorder.onstop=()=>{
    const actualType=recorder.mimeType||mime||'video/webm';
    const blob=new Blob(chunks,{type:actualType});
    const ext=actualType.includes('mp4')?'mp4':'webm';
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=`Common_Horizon_7680x856_${totalDuration}s.${ext}`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),5000);

    recording=false;
    playback=false;
    document.body.classList.remove('playback');
    renderer.setPixelRatio(previousPixelRatio);
    resize();
    current=0;
    updateUI();
    recordBtn.disabled=false;
    recordStatus.textContent=`Exported ${TARGET_WIDTH}×${TARGET_HEIGHT} ${ext.toUpperCase()}`;
  };

  recorder.start(1000);
  recordStatus.textContent=`Recording ${totalDuration}s at ${TARGET_WIDTH}×${TARGET_HEIGHT}…`;
  setTimeout(()=>{if(recorder.state!=='inactive')recorder.stop()},totalDuration*1000+120);
};

resize();
updateUI();
function loop(now){
  const elapsed=(now-startTime)/1000;
  material.uniforms.uTime.value=playback?elapsed:now/1000;
  if(playback){
    const t=elapsed%totalDuration;
    const segment=totalDuration/images.length;
    const a=Math.floor(t/segment)%images.length;
    const b=(a+1)%images.length;
    const p=(t-a*segment)/segment;
    const blend=p;
    if(!setPair(a,b,blend)){
      const fallback=textures.findIndex(Boolean);
      if(fallback>=0) setPair(fallback,fallback,0);
    }
  } else if(!material.uniforms.uA.value && textures[current]) {
    setPair(current,current,0);
  }
  renderer.render(scene,camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
