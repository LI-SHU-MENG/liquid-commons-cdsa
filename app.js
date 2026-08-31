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

const TARGET_ASPECT=7680/856;
const saved=JSON.parse(localStorage.getItem('liquidCommonsHorizons')||'{}');
const horizons=Object.fromEntries(images.map(f=>[f,saved[f]??0.5]));
let current=0, playback=false, startTime=performance.now();
let totalDuration=24, morphStrength=0.070;

const stage=document.querySelector('#stage');
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.setClearColor(0x000000,1);
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
      float mask=pow(clamp(abs(d)*2.0,0.0,1.0),1.35);
      float wave=sin(uv.x*13.0+uTime*.55+phase)+sin(uv.x*29.0-uTime*.31+phase*2.0)*.45;
      float drift=wave*uStrength*mask;
      float y=horizon+(d+drift*sign(d))*visible;
      float x=uv.x+sin((uv.y+phase)*18.0+uTime*.25)*uStrength*.20*mask;
      return vec2(clamp(x,0.001,.999),clamp(y,0.001,.999));
    }
    void main(){
      float m=clamp(uMix,0.0,1.0);
      vec2 uvA=sourceUV(vUv,uHorizonA,uSourceAspectA,0.0);
      vec2 uvB=sourceUV(vUv,uHorizonB,uSourceAspectB,0.0);
      vec4 a=texture2D(uA,uvA); vec4 b=texture2D(uB,uvB);
      float edgeSoft=sin(3.14159*m);
      float ripple=sin((vUv.y-.5)*10.0+uTime*.18)*0.018*edgeSoft*edgeSoft;
      gl_FragColor=mix(a,b,clamp(m+ripple,0.0,1.0));
    }`
});
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));

const textures=new Array(images.length).fill(null);
const loader=new THREE.TextureLoader();
function prepTexture(tex){tex.colorSpace=THREE.SRGBColorSpace;tex.minFilter=THREE.LinearFilter;tex.magFilter=THREE.LinearFilter;return tex}
function texAspect(t){return t?.image?.width&&t?.image?.height?t.image.width/t.image.height:1.333}
function setPair(a,b,m=0){
  const ta=textures[a], tb=textures[b]||ta;
  if(!ta) return false;
  material.uniforms.uA.value=ta; material.uniforms.uB.value=tb;
  material.uniforms.uMix.value=m;
  material.uniforms.uHorizonA.value=horizons[images[a]]; material.uniforms.uHorizonB.value=horizons[images[b]];
  material.uniforms.uSourceAspectA.value=texAspect(ta); material.uniforms.uSourceAspectB.value=texAspect(tb);
  return true;
}

images.forEach((file,i)=>loader.load(encodeURI(`./public/images/${file}`),tex=>{
  textures[i]=prepTexture(tex);
  if(typeof renderer.initTexture==='function') renderer.initTexture(textures[i]);
  if(i===current && !playback) setPair(i,i,0);
},undefined,e=>console.error('Failed to load',file,e)));

function resize(){const r=stage.getBoundingClientRect();renderer.setSize(Math.max(2,r.width),Math.max(2,r.height),false)}
window.addEventListener('resize',resize);

const slider=document.querySelector('#horizonSlider');
const value=document.querySelector('#horizonValue');
const filename=document.querySelector('#filename');
const counter=document.querySelector('#counter');
const morphInput=document.querySelector('#morphInput');
const morphValue=document.querySelector('#morphValue');
const durationInput=document.querySelector('#durationInput');

function updateUI(){
  slider.value=horizons[images[current]]; value.textContent=(+slider.value).toFixed(3);
  filename.textContent=images[current]; counter.textContent=`${current+1} / ${images.length}`;
  setPair(current,current,0);
}
slider.addEventListener('input',()=>{
  horizons[images[current]]=+slider.value; value.textContent=(+slider.value).toFixed(3);
  localStorage.setItem('liquidCommonsHorizons',JSON.stringify(horizons)); setPair(current,current,0);
});
document.querySelector('#prevBtn').onclick=()=>{current=(current-1+images.length)%images.length;updateUI()};
document.querySelector('#nextBtn').onclick=()=>{current=(current+1)%images.length;updateUI()};
durationInput.value=totalDuration;
durationInput.oninput=e=>totalDuration=Math.max(12,+e.target.value||24);
morphInput.value=morphStrength; morphValue.textContent=morphStrength.toFixed(3);
morphInput.oninput=e=>{morphStrength=+e.target.value;material.uniforms.uStrength.value=morphStrength;morphValue.textContent=morphStrength.toFixed(3)};
document.querySelector('#playBtn').onclick=()=>{playback=true;document.body.classList.add('playback');startTime=performance.now();resize()};
document.querySelector('#exitPlayback').onclick=()=>{playback=false;document.body.classList.remove('playback');current=0;updateUI();resize()};

resize(); updateUI();
function loop(now){
  material.uniforms.uTime.value=now/1000;
  if(playback){
    const t=((now-startTime)/1000)%totalDuration;
    const segment=totalDuration/images.length;
    const a=Math.floor(t/segment)%images.length;
    const b=(a+1)%images.length;
    const p=(t-a*segment)/segment;
    const smooth=p*p*(3-2*p);
    const blend=p*0.65+smooth*0.35;
    if(!setPair(a,b,blend)){
      const fallback=textures.findIndex(Boolean);
      if(fallback>=0) setPair(fallback,fallback,0);
    }
  } else if(!material.uniforms.uA.value && textures[current]) setPair(current,current,0);
  renderer.render(scene,camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
