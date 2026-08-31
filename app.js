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
  uniforms:{
    uA:{value:null},uB:{value:null},uC:{value:null},
    uPhase:{value:0},uTime:{value:0},
    uHorizonA:{value:.5},uHorizonB:{value:.5},uHorizonC:{value:.5},
    uSourceAspectA:{value:1.333},uSourceAspectB:{value:1.333},uSourceAspectC:{value:1.333},
    uTargetAspect:{value:TARGET_ASPECT},uStrength:{value:morphStrength}
  },
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.0);}`,
  fragmentShader:`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uA,uB,uC;
    uniform float uPhase,uTime;
    uniform float uHorizonA,uHorizonB,uHorizonC;
    uniform float uSourceAspectA,uSourceAspectB,uSourceAspectC,uTargetAspect,uStrength;

    vec2 sourceUV(vec2 uv,float horizon,float srcAspect,float phase){
      float visible=srcAspect/uTargetAspect;
      float d=uv.y-.5;
      float horizonMask=pow(clamp(abs(d)*2.0,0.0,1.0),1.65);

      // Extremely slow horizontal current only. The horizon remains vertically locked.
      float wave=sin(uv.y*10.0+uTime*.030+phase)
               +0.24*sin(uv.y*23.0-uTime*.018+phase*1.21);
      float x=uv.x + wave*uStrength*.016*horizonMask;
      float y=horizon+d*visible;
      return vec2(clamp(x,0.002,.998),clamp(y,0.002,.998));
    }

    void main(){
      float p=clamp(uPhase,0.0,1.0);

      vec4 a=texture2D(uA,sourceUV(vUv,uHorizonA,uSourceAspectA,0.0));
      vec4 b=texture2D(uB,sourceUV(vUv,uHorizonB,uSourceAspectB,0.7));
      vec4 c=texture2D(uC,sourceUV(vUv,uHorizonC,uSourceAspectC,1.4));

      // Quadratic B-spline weights. Three neighbouring photographs are always
      // present and the weights remain continuous across every image boundary.
      float wA=0.5*(1.0-p)*(1.0-p);
      float wB=0.75-(p-0.5)*(p-0.5);
      float wC=0.5*p*p;
      float sum=wA+wB+wC;

      vec4 col=(a*wA+b*wB+c*wC)/sum;
      gl_FragColor=vec4(col.rgb,1.0);
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
function idx(i){return (i+images.length)%images.length}
function setTriple(a,b,c,p=0){
  a=idx(a);b=idx(b);c=idx(c);
  const ta=textures[a],tb=textures[b],tc=textures[c];
  if(!ta||!tb||!tc) return false;
  material.uniforms.uA.value=ta;
  material.uniforms.uB.value=tb;
  material.uniforms.uC.value=tc;
  material.uniforms.uPhase.value=p;
  material.uniforms.uHorizonA.value=horizons[images[a]];
  material.uniforms.uHorizonB.value=horizons[images[b]];
  material.uniforms.uHorizonC.value=horizons[images[c]];
  material.uniforms.uSourceAspectA.value=texAspect(ta);
  material.uniforms.uSourceAspectB.value=texAspect(tb);
  material.uniforms.uSourceAspectC.value=texAspect(tc);
  return true;
}

images.forEach((file,i)=>loader.load(encodeURI(`./public/images/${file}`),tex=>{
  textures[i]=prepTexture(tex);
  if(typeof renderer.initTexture==='function') renderer.initTexture(textures[i]);
  if(!playback && textures[idx(current-1)] && textures[current] && textures[idx(current+1)]) {
    setTriple(current-1,current,current+1,0.5);
  }
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
  setTriple(current-1,current,current+1,0.5);
}
slider.addEventListener('input',()=>{
  horizons[images[current]]=+slider.value;
  value.textContent=(+slider.value).toFixed(3);
  localStorage.setItem('liquidCommonsHorizons',JSON.stringify(horizons));
  setTriple(current-1,current,current+1,0.5);
});
document.querySelector('#prevBtn').onclick=()=>{current=idx(current-1);updateUI()};
document.querySelector('#nextBtn').onclick=()=>{current=idx(current+1);updateUI()};
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
  setTriple(images.length-1,0,1,0.0);
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
    const cycle=(elapsed%totalDuration)/totalDuration*images.length;
    const b=Math.floor(cycle)%images.length;
    const p=cycle-Math.floor(cycle);
    const a=idx(b-1);
    const c=idx(b+1);
    if(!setTriple(a,b,c,p)){
      const ready=textures.findIndex(Boolean);
      if(ready>=0 && textures[idx(ready-1)] && textures[idx(ready+1)]) setTriple(ready-1,ready,ready+1,0.5);
    }
  }
  renderer.render(scene,camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
