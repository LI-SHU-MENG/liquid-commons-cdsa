import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

const images=[
  'North Atlantic.jpeg',
  'North Atlantic_3.JPG',
  'Portugal Cove.jpeg',
  'Bell Island.jpeg',
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
let totalDuration=36, morphStrength=0.045;

const stage=document.querySelector('#stage');
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);
const scene=new THREE.Scene();
const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);

const loader=new THREE.TextureLoader();
const textures=[];
let loaded=0;
images.forEach((file,i)=>loader.load(encodeURI(`./public/images/${file}`),tex=>{
  tex.colorSpace=THREE.SRGBColorSpace;
  tex.minFilter=THREE.LinearFilter; tex.magFilter=THREE.LinearFilter;
  textures[i]=tex; loaded++; if(loaded===images.length) ready();
},undefined,e=>console.error('Failed',file,e)));

const material=new THREE.ShaderMaterial({
  uniforms:{uA:{value:null},uB:{value:null},uMix:{value:0},uTime:{value:0},uHorizonA:{value:.5},uHorizonB:{value:.5},uSourceAspectA:{value:1.333},uSourceAspectB:{value:1.333},uTargetAspect:{value:TARGET_ASPECT},uStrength:{value:morphStrength}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.0);}`,
  fragmentShader:`
    precision highp float;varying vec2 vUv;
    uniform sampler2D uA,uB;uniform float uMix,uTime,uHorizonA,uHorizonB,uSourceAspectA,uSourceAspectB,uTargetAspect,uStrength;
    vec2 sourceUV(vec2 uv,float horizon,float srcAspect,float phase){
      float visible=srcAspect/uTargetAspect;
      float d=uv.y-.5;
      float mask=pow(clamp(abs(d)*2.0,0.0,1.0),1.4);
      float wave=(sin(uv.x*13.0+uTime*.45+phase)+sin(uv.x*29.0-uTime*.23+phase*2.0)*.45);
      float drift=wave*uStrength*mask;
      float skyOceanSign=sign(d);
      float y=horizon+(d+drift*skyOceanSign)*visible;
      float x=uv.x+sin((uv.y+phase)*18.0+uTime*.18)*uStrength*.18*mask;
      return vec2(clamp(x,0.001,.999),clamp(y,0.001,.999));
    }
    float ease(float t){return t*t*(3.0-2.0*t);}
    void main(){
      float m=ease(clamp(uMix,0.0,1.0));
      vec2 uvA=sourceUV(vUv,uHorizonA,uSourceAspectA,0.0);
      vec2 uvB=sourceUV(vUv,uHorizonB,uSourceAspectB,2.7);
      vec4 a=texture2D(uA,uvA); vec4 b=texture2D(uB,uvB);
      float local=m + sin((vUv.y-.5)*9.0+uTime*.1)*0.025*sin(3.14159*m);
      gl_FragColor=mix(a,b,clamp(local,0.0,1.0));
    }`
});
const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);scene.add(mesh);

function texAspect(t){return t.image.width/t.image.height}
function setPair(a,b,m=0){
  material.uniforms.uA.value=textures[a];material.uniforms.uB.value=textures[b];material.uniforms.uMix.value=m;
  material.uniforms.uHorizonA.value=horizons[images[a]];material.uniforms.uHorizonB.value=horizons[images[b]];
  material.uniforms.uSourceAspectA.value=texAspect(textures[a]);material.uniforms.uSourceAspectB.value=texAspect(textures[b]);
}
function resize(){const r=stage.getBoundingClientRect();renderer.setSize(Math.max(2,r.width),Math.max(2,r.height),false)}
window.addEventListener('resize',resize);

const slider=document.querySelector('#horizonSlider'), value=document.querySelector('#horizonValue'), filename=document.querySelector('#filename'), counter=document.querySelector('#counter');
function updateUI(){slider.value=horizons[images[current]];value.textContent=(+slider.value).toFixed(3);filename.textContent=images[current];counter.textContent=`${current+1} / ${images.length}`;if(textures[current])setPair(current,current,0)}
slider.addEventListener('input',()=>{horizons[images[current]]=+slider.value;value.textContent=(+slider.value).toFixed(3);localStorage.setItem('liquidCommonsHorizons',JSON.stringify(horizons));if(textures[current])setPair(current,current,0)});
document.querySelector('#prevBtn').onclick=()=>{current=(current-1+images.length)%images.length;updateUI()};
document.querySelector('#nextBtn').onclick=()=>{current=(current+1)%images.length;updateUI()};
document.querySelector('#durationInput').oninput=e=>totalDuration=Math.max(12,+e.target.value||36);
document.querySelector('#morphInput').oninput=e=>{morphStrength=+e.target.value;material.uniforms.uStrength.value=morphStrength};
document.querySelector('#playBtn').onclick=()=>{playback=true;document.body.classList.add('playback');startTime=performance.now();resize()};
document.querySelector('#exitPlayback').onclick=()=>{playback=false;document.body.classList.remove('playback');current=0;updateUI();resize()};

function ready(){updateUI();resize();requestAnimationFrame(loop)}
function loop(now){
  material.uniforms.uTime.value=now/1000;
  if(playback){
    const t=((now-startTime)/1000)%totalDuration;
    const segment=totalDuration/images.length;
    const a=Math.floor(t/segment)%images.length,b=(a+1)%images.length;
    const p=(t-a*segment)/segment;
    setPair(a,b,p);
  }
  renderer.render(scene,camera);requestAnimationFrame(loop);
}
