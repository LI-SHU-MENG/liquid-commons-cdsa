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

const TARGET_WIDTH = 7680;
const TARGET_HEIGHT = 856;
const TARGET_ASPECT = TARGET_WIDTH / TARGET_HEIGHT;
const RECORD_WIDTH = 3840;
const RECORD_HEIGHT = 428;
const RECORD_FPS = 24;
const RECORD_BITRATE = 15000000;

const saved = JSON.parse(localStorage.getItem('liquidCommonsHorizons') || '{}');
const horizons = Object.fromEntries(images.map(f => [f, saved[f] ?? 0.5]));

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ------------------------------------------------------------
// IMAGE-REACTIVE SOUND ENGINE
// ------------------------------------------------------------
const DEFAULT_FEATURES = {
  brightness: 0.5,
  saturation: 0.3,
  warmth: 0.5,
  edgeDensity: 0.15,
  horizonContrast: 0.12
};

const imageFeatures = {};
let audioCtx = null;
let soundButton = null;
let masterGain = null;
let toneOscA = null;
let toneOscB = null;
let harmonicOsc = null;
let toneFilter = null;
let toneGain = null;
let harmonicGain = null;
let seaNoise = null;
let seaFilter = null;
let seaGain = null;
let skyNoise = null;
let skyFilter = null;
let skyGain = null;
let skyPan = null;

function createNoiseBuffer(ctx, seconds = 3, brown = false) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;

  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.018 * white) / 1.018;
      data[i] = last * 3.2;
    } else {
      data[i] = white * 0.55;
    }
  }
  return buffer;
}

function createNoiseSource(ctx, buffer) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}

async function analyseImage(fileName) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const w = 64;
      const h = 64;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);

      let brightnessSum = 0;
      let saturationSum = 0;
      let warmthSum = 0;
      let edgeSum = 0;
      let count = 0;
      const rowLum = new Array(h).fill(0);

      function luminance(x, y) {
        const i = (y * w + x) * 4;
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const r = data[i] / 255;
          const g = data[i + 1] / 255;
          const b = data[i + 2] / 255;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const warmth = clamp(0.5 + (r - b) * 0.5, 0, 1);

          brightnessSum += lum;
          saturationSum += sat;
          warmthSum += warmth;
          rowLum[y] += lum;
          count++;

          if (x < w - 1) edgeSum += Math.abs(lum - luminance(x + 1, y));
          if (y < h - 1) edgeSum += Math.abs(lum - luminance(x, y + 1));
        }
      }

      for (let y = 0; y < h; y++) rowLum[y] /= w;
      const hr = clamp(Math.round((horizons[fileName] ?? 0.5) * (h - 1)), 1, h - 2);
      const horizonContrast = Math.abs(rowLum[hr - 1] - rowLum[hr + 1]);

      resolve({
        brightness: brightnessSum / count,
        saturation: saturationSum / count,
        warmth: warmthSum / count,
        edgeDensity: clamp(edgeSum / (count * 0.22), 0, 1),
        horizonContrast: clamp(horizonContrast * 3.5, 0, 1)
      });
    };

    img.onerror = () => resolve({ ...DEFAULT_FEATURES });
    img.src = encodeURI(`./public/images/${fileName}`);
  });
}

async function buildImageFeatures() {
  await Promise.all(images.map(async file => {
    imageFeatures[file] = await analyseImage(file);
  }));
}

async function initSoundEngine() {
  if (audioCtx) return;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await buildImageFeatures();

  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.65;
  masterGain.connect(audioCtx.destination);

  // TONAL HORIZON — one pitch field, not a melody.
  toneOscA = audioCtx.createOscillator();
  toneOscB = audioCtx.createOscillator();
  harmonicOsc = audioCtx.createOscillator();
  toneOscA.type = 'sine';
  toneOscB.type = 'sine';
  harmonicOsc.type = 'sine';

  toneOscA.frequency.value = 110;
  toneOscB.frequency.value = 110.20;
  harmonicOsc.frequency.value = 220.4;

  toneFilter = audioCtx.createBiquadFilter();
  toneFilter.type = 'lowpass';
  toneFilter.frequency.value = 330;
  toneFilter.Q.value = 0.8;

  toneGain = audioCtx.createGain();
  toneGain.gain.value = 0.09;
  harmonicGain = audioCtx.createGain();
  harmonicGain.gain.value = 0.006;

  toneOscA.connect(toneFilter);
  toneOscB.connect(toneFilter);
  toneFilter.connect(toneGain);
  toneGain.connect(masterGain);

  harmonicOsc.connect(harmonicGain);
  harmonicGain.connect(masterGain);

  // SEA — dark, slowly filtered brown noise.
  seaNoise = createNoiseSource(audioCtx, createNoiseBuffer(audioCtx, 3, true));
  seaFilter = audioCtx.createBiquadFilter();
  seaFilter.type = 'bandpass';
  seaFilter.frequency.value = 760;
  seaFilter.Q.value = 0.65;
  seaGain = audioCtx.createGain();
  seaGain.gain.value = 0.035;
  seaNoise.connect(seaFilter);
  seaFilter.connect(seaGain);
  seaGain.connect(masterGain);

  // SKY — thin high-frequency air.
  skyNoise = createNoiseSource(audioCtx, createNoiseBuffer(audioCtx, 3, false));
  skyFilter = audioCtx.createBiquadFilter();
  skyFilter.type = 'highpass';
  skyFilter.frequency.value = 3600;
  skyFilter.Q.value = 0.25;
  skyPan = audioCtx.createStereoPanner();
  skyGain = audioCtx.createGain();
  skyGain.gain.value = 0.008;
  skyNoise.connect(skyFilter);
  skyFilter.connect(skyPan);
  skyPan.connect(skyGain);
  skyGain.connect(masterGain);

  toneOscA.start();
  toneOscB.start();
  harmonicOsc.start();
  seaNoise.start();
  skyNoise.start();
}

function blendFeatures(a, b, c, phase) {
  const fa = imageFeatures[images[idx(a)]] || DEFAULT_FEATURES;
  const fb = imageFeatures[images[idx(b)]] || DEFAULT_FEATURES;
  const fc = imageFeatures[images[idx(c)]] || DEFAULT_FEATURES;

  const wA0 = 0.5 * (1 - phase) * (1 - phase);
  const wB0 = 0.75 - (phase - 0.5) * (phase - 0.5);
  const wC0 = 0.5 * phase * phase;
  const sum = wA0 + wB0 + wC0;
  const wA = wA0 / sum;
  const wB = wB0 / sum;
  const wC = wC0 / sum;

  const mix = key => fa[key] * wA + fb[key] * wB + fc[key] * wC;
  return {
    brightness: mix('brightness'),
    saturation: mix('saturation'),
    warmth: mix('warmth'),
    edgeDensity: mix('edgeDensity'),
    horizonContrast: mix('horizonContrast')
  };
}

function updateSoundFromVisuals(a, b, c, phase, loopProgress) {
  if (!audioCtx || audioCtx.state !== 'running') return;

  const f = blendFeatures(a, b, c, phase);
  const now = audioCtx.currentTime;

  // The center barely moves. Colour/structure mainly change the inside of the sound.
  const baseHz = 110
    + (f.warmth - 0.5) * 0.9
    + (f.brightness - 0.5) * 0.45;

  // More visual structure = slightly faster beating.
  const beatHz = lerp(0.10, 0.30, clamp(f.edgeDensity * 0.7 + f.horizonContrast * 0.3, 0, 1));

  toneOscA.frequency.setTargetAtTime(baseHz, now, 0.45);
  toneOscB.frequency.setTargetAtTime(baseHz + beatHz, now, 0.45);
  harmonicOsc.frequency.setTargetAtTime(baseHz * 2.003, now, 0.55);

  // Brightness and saturation open the spectrum, not the melody.
  toneFilter.frequency.setTargetAtTime(
    lerp(230, 470, clamp(f.brightness * 0.65 + f.saturation * 0.35, 0, 1)),
    now,
    0.6
  );
  harmonicGain.gain.setTargetAtTime(
    lerp(0.002, 0.014, f.saturation),
    now,
    0.7
  );

  // Clearer horizon = purer tonal center; blurrier horizon = more water/noise.
  toneGain.gain.setTargetAtTime(
    lerp(0.075, 0.105, f.horizonContrast),
    now,
    0.6
  );

  seaFilter.frequency.setTargetAtTime(
    lerp(430, 1500, clamp(f.edgeDensity * 0.65 + f.saturation * 0.35, 0, 1)),
    now,
    0.75
  );
  seaFilter.Q.setTargetAtTime(
    lerp(0.45, 1.1, f.horizonContrast),
    now,
    0.8
  );
  seaGain.gain.setTargetAtTime(
    lerp(0.022, 0.055, clamp(f.edgeDensity * 0.75 + (1 - f.horizonContrast) * 0.25, 0, 1)),
    now,
    0.8
  );

  skyFilter.frequency.setTargetAtTime(
    lerp(2800, 7200, clamp(f.brightness * 0.75 + (1 - f.warmth) * 0.25, 0, 1)),
    now,
    1.0
  );
  skyGain.gain.setTargetAtTime(
    lerp(0.004, 0.018, clamp(f.brightness * 0.8 + (1 - f.edgeDensity) * 0.2, 0, 1)),
    now,
    1.0
  );

  // One very slow stereo breath per 58-second visual cycle.
  skyPan.pan.setTargetAtTime(Math.sin(loopProgress * Math.PI * 2) * 0.16, now, 0.9);
}

function ensureSoundButton() {
  if (soundButton) return;
  soundButton = document.createElement('button');
  soundButton.textContent = 'Start sound';
  soundButton.setAttribute('aria-label', 'Toggle sound');

  Object.assign(soundButton.style, {
    position: 'fixed',
    right: '22px',
    bottom: '22px',
    zIndex: '10000',
    padding: '10px 16px',
    border: '1px solid rgba(255,255,255,0.35)',
    borderRadius: '999px',
    background: 'rgba(15,15,15,0.72)',
    color: '#fff',
    font: '14px/1.2 system-ui, sans-serif',
    letterSpacing: '0.02em',
    cursor: 'pointer',
    backdropFilter: 'blur(8px)'
  });

  soundButton.onclick = async () => {
    if (!audioCtx) {
      soundButton.textContent = 'Loading sound…';
      await initSoundEngine();
      await audioCtx.resume();
      soundButton.textContent = 'Sound: on';
      return;
    }

    if (audioCtx.state === 'running') {
      await audioCtx.suspend();
      soundButton.textContent = 'Sound: off';
    } else {
      await audioCtx.resume();
      soundButton.textContent = 'Sound: on';
    }
  };

  document.body.appendChild(soundButton);
}

let current = 0;
let playback = false;
let startTime = performance.now();
let totalDuration = 58;
let morphStrength = 0.030;
let recording = false;

const stage = document.querySelector('#stage');
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
  alpha: false
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x111111, 1);
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

function idx(i) {
  return (i + images.length) % images.length;
}

const material = new THREE.ShaderMaterial({
  uniforms: {
    uA: { value: null },
    uB: { value: null },
    uC: { value: null },
    uPhase: { value: 0.5 },
    uTime: { value: 0 },
    uHorizonA: { value: 0.5 },
    uHorizonB: { value: 0.5 },
    uHorizonC: { value: 0.5 },
    uSourceAspectA: { value: 1.333 },
    uSourceAspectB: { value: 1.333 },
    uSourceAspectC: { value: 1.333 },
    uTargetAspect: { value: TARGET_ASPECT },
    uStrength: { value: morphStrength }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec2 vUv;

    uniform sampler2D uA;
    uniform sampler2D uB;
    uniform sampler2D uC;
    uniform float uPhase;
    uniform float uTime;
    uniform float uHorizonA;
    uniform float uHorizonB;
    uniform float uHorizonC;
    uniform float uSourceAspectA;
    uniform float uSourceAspectB;
    uniform float uSourceAspectC;
    uniform float uTargetAspect;
    uniform float uStrength;

    vec2 sourceUV(vec2 uv, float horizon, float srcAspect, float phase) {
      float visible = srcAspect / uTargetAspect;
      float d = uv.y - 0.5;
      float horizonMask = pow(clamp(abs(d) * 2.0, 0.0, 1.0), 1.55);

      float wave =
          sin(uv.y * 9.0 + uTime + phase)
        + 0.18 * sin(uv.y * 20.0 - 2.0 * uTime + phase * 1.15);

      float x = uv.x + wave * uStrength * 0.010 * horizonMask;
      float y = horizon + d * visible;

      return vec2(clamp(x, 0.002, 0.998), clamp(y, 0.002, 0.998));
    }

    void main() {
      float p = clamp(uPhase, 0.0, 1.0);

      vec4 a = texture2D(uA, sourceUV(vUv, uHorizonA, uSourceAspectA, 0.0));
      vec4 b = texture2D(uB, sourceUV(vUv, uHorizonB, uSourceAspectB, 0.0));
      vec4 c = texture2D(uC, sourceUV(vUv, uHorizonC, uSourceAspectC, 0.0));

      float wA = 0.5 * (1.0 - p) * (1.0 - p);
      float wB = 0.75 - (p - 0.5) * (p - 0.5);
      float wC = 0.5 * p * p;

      float sum = wA + wB + wC;
      vec4 col = (a * wA + b * wB + c * wC) / sum;

      gl_FragColor = vec4(col.rgb, 1.0);
    }
  `
});

scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

const textures = new Array(images.length).fill(null);
const loader = new THREE.TextureLoader();

function prepTexture(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function texAspect(t) {
  return t?.image?.width && t?.image?.height ? t.image.width / t.image.height : 1.333;
}

function setTriple(a, b, c, phase = 0.5) {
  a = idx(a);
  b = idx(b);
  c = idx(c);

  const ta = textures[a];
  const tb = textures[b];
  const tc = textures[c];

  if (!ta || !tb || !tc) return false;

  material.uniforms.uA.value = ta;
  material.uniforms.uB.value = tb;
  material.uniforms.uC.value = tc;
  material.uniforms.uPhase.value = phase;

  material.uniforms.uHorizonA.value = horizons[images[a]];
  material.uniforms.uHorizonB.value = horizons[images[b]];
  material.uniforms.uHorizonC.value = horizons[images[c]];

  material.uniforms.uSourceAspectA.value = texAspect(ta);
  material.uniforms.uSourceAspectB.value = texAspect(tb);
  material.uniforms.uSourceAspectC.value = texAspect(tc);

  return true;
}

function setSingle(i) {
  return setTriple(i, i, i, 0.5);
}

images.forEach((file, i) => {
  loader.load(
    encodeURI(`./public/images/${file}`),
    tex => {
      textures[i] = prepTexture(tex);
      if (typeof renderer.initTexture === 'function') renderer.initTexture(textures[i]);
      if (!playback && i === current) setSingle(current);
    },
    undefined,
    e => console.error('Failed to load', file, e)
  );
});

function resize() {
  if (recording) return;
  const r = stage.getBoundingClientRect();
  renderer.setSize(Math.max(2, r.width), Math.max(2, r.height), false);
}
window.addEventListener('resize', resize);

const slider = document.querySelector('#horizonSlider');
const value = document.querySelector('#horizonValue');
const filename = document.querySelector('#filename');
const counter = document.querySelector('#counter');
const morphInput = document.querySelector('#morphInput');
const morphValue = document.querySelector('#morphValue');
const durationInput = document.querySelector('#durationInput');
const recordBtn = document.querySelector('#recordBtn');
const recordStatus = document.querySelector('#recordStatus');

function updateUI() {
  slider.value = horizons[images[current]];
  value.textContent = (+slider.value).toFixed(3);
  filename.textContent = images[current];
  counter.textContent = `${current + 1} / ${images.length}`;
  setSingle(current);
}

slider.addEventListener('input', () => {
  horizons[images[current]] = +slider.value;
  value.textContent = (+slider.value).toFixed(3);
  localStorage.setItem('liquidCommonsHorizons', JSON.stringify(horizons));
  setSingle(current);
});

document.querySelector('#prevBtn').onclick = () => {
  current = idx(current - 1);
  updateUI();
};

document.querySelector('#nextBtn').onclick = () => {
  current = idx(current + 1);
  updateUI();
};

durationInput.value = totalDuration;
durationInput.oninput = e => {
  totalDuration = Math.max(12, +e.target.value || 58);
  recordBtn.textContent = `Record ${totalDuration}s`;
};

morphInput.value = morphStrength;
morphValue.textContent = morphStrength.toFixed(3);
morphInput.oninput = e => {
  morphStrength = +e.target.value;
  material.uniforms.uStrength.value = morphStrength;
  morphValue.textContent = morphStrength.toFixed(3);
};

document.querySelector('#playBtn').onclick = () => {
  playback = true;
  document.body.classList.add('playback');
  startTime = performance.now();
  resize();
};

document.querySelector('#exitPlayback').onclick = () => {
  if (recording) return;
  playback = false;
  document.body.classList.remove('playback');
  current = 0;
  updateUI();
  resize();
};

function getRecorderMime() {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4'
  ];
  return candidates.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

recordBtn.onclick = async () => {
  if (recording) return;

  if (!renderer.domElement.captureStream || !window.MediaRecorder) {
    alert('This browser cannot record the canvas directly. Use Google Chrome.');
    return;
  }

  if (!textures.every(Boolean)) {
    alert('Images are still loading. Wait a few seconds, then press Record again.');
    return;
  }

  recording = true;
  recordBtn.disabled = true;
  recordStatus.textContent = `Preparing ${RECORD_WIDTH}×${RECORD_HEIGHT}…`;

  const previousPixelRatio = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setSize(RECORD_WIDTH, RECORD_HEIGHT, false);

  playback = true;
  document.body.classList.add('playback');
  startTime = performance.now();
  material.uniforms.uTime.value = 0;
  setTriple(images.length - 1, 0, 1, 0.0);
  renderer.render(scene, camera);

  const stream = renderer.domElement.captureStream(RECORD_FPS);
  const mime = getRecorderMime();
  const options = mime ? { mimeType: mime, videoBitsPerSecond: RECORD_BITRATE } : { videoBitsPerSecond: RECORD_BITRATE };

  let recorder;
  try {
    recorder = new MediaRecorder(stream, options);
  } catch (e) {
    recorder = new MediaRecorder(stream);
  }

  const chunks = [];
  recorder.ondataavailable = e => {
    if (e.data && e.data.size) chunks.push(e.data);
  };

  recorder.onstop = () => {
    const actualType = recorder.mimeType || mime || 'video/webm';
    const blob = new Blob(chunks, { type: actualType });
    const ext = actualType.includes('mp4') ? 'mp4' : 'webm';

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Common_Horizon_${RECORD_WIDTH}x${RECORD_HEIGHT}_${totalDuration}s.${ext}`;
    a.click();

    setTimeout(() => URL.revokeObjectURL(a.href), 5000);

    recording = false;
    playback = false;
    document.body.classList.remove('playback');
    renderer.setPixelRatio(previousPixelRatio);
    resize();
    current = 0;
    updateUI();
    recordBtn.disabled = false;
    recordStatus.textContent = `Exported ${RECORD_WIDTH}×${RECORD_HEIGHT} ${ext.toUpperCase()}`;
  };

  recorder.start(1000);
  recordStatus.textContent = `Recording ${totalDuration}s at ${RECORD_WIDTH}×${RECORD_HEIGHT}, ${RECORD_FPS}fps…`;
  setTimeout(() => {
    if (recorder.state !== 'inactive') recorder.stop();
  }, totalDuration * 1000 + 120);
};

resize();
updateUI();
ensureSoundButton();

function loop(now) {
  const elapsed = (now - startTime) / 1000;
  const loopProgress = playback ? ((elapsed % totalDuration) / totalDuration) : 0;

  material.uniforms.uTime.value = playback
    ? loopProgress * Math.PI * 2
    : (now / 1000) * 0.015;

  if (playback) {
    const cycle = loopProgress * images.length;
    const center = Math.floor(cycle) % images.length;
    const phase = cycle - Math.floor(cycle);

    const a = idx(center - 1);
    const b = center;
    const c = idx(center + 1);

    if (!setTriple(a, b, c, phase)) setSingle(current);
    updateSoundFromVisuals(a, b, c, phase, loopProgress);
  } else {
    if (!material.uniforms.uA.value && textures[current]) setSingle(current);
    updateSoundFromVisuals(current, current, current, 0.5, 0);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
