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

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const idx = i => (i + images.length) % images.length;

let current = 0;
let playback = false;
let startTime = performance.now();
let totalDuration = 58;
let morphStrength = 0.030;
let recording = false;

// ------------------------------------------------------------
// VISUAL
// ------------------------------------------------------------
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

    vec2 sourceUV(vec2 uv, float horizon, float srcAspect) {
      float visible = srcAspect / uTargetAspect;
      float d = uv.y - 0.5;
      float horizonMask = pow(clamp(abs(d) * 2.0, 0.0, 1.0), 1.55);
      float wave =
          sin(uv.y * 9.0 + uTime)
        + 0.18 * sin(uv.y * 20.0 - 2.0 * uTime);
      float x = uv.x + wave * uStrength * 0.010 * horizonMask;
      float y = horizon + d * visible;
      return vec2(clamp(x, 0.002, 0.998), clamp(y, 0.002, 0.998));
    }

    void main() {
      float p = clamp(uPhase, 0.0, 1.0);
      vec4 a = texture2D(uA, sourceUV(vUv, uHorizonA, uSourceAspectA));
      vec4 b = texture2D(uB, sourceUV(vUv, uHorizonB, uSourceAspectB));
      vec4 c = texture2D(uC, sourceUV(vUv, uHorizonC, uSourceAspectC));

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
  a = idx(a); b = idx(b); c = idx(c);
  const ta = textures[a], tb = textures[b], tc = textures[c];
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

// ------------------------------------------------------------
// IMAGE ANALYSIS + SOUND
// ------------------------------------------------------------
const DEFAULT_FEATURES = {
  skyBrightness: 0.6,
  skySaturation: 0.25,
  skyWarmth: 0.5,
  skyEdgeDensity: 0.08,
  seaBrightness: 0.4,
  seaSaturation: 0.35,
  seaWarmth: 0.5,
  seaEdgeDensity: 0.18,
  horizonContrast: 0.12
};
const imageFeatures = {};

let audioCtx = null;
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
let seaSwellGain = null;
let seaSwellOsc = null;
let seaSwellDepth = null;
let skyNoise = null;
let skyFilter = null;
let skyGain = null;
let skyPan = null;

function createNoiseBuffer(ctx, seconds = 4, brown = false) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.018 * white) / 1.018;
      data[i] = last * 3.0;
    } else {
      data[i] = white * 0.45;
    }
  }
  return buffer;
}

async function analyseImage(fileName) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const w = 72, h = 72;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const hr = clamp(Math.round((horizons[fileName] ?? 0.5) * (h - 1)), 2, h - 3);
      const rowLum = new Array(h).fill(0);

      const sky = { brightness: 0, saturation: 0, warmth: 0, edges: 0, count: 0 };
      const sea = { brightness: 0, saturation: 0, warmth: 0, edges: 0, count: 0 };

      const lumAt = (x, y) => {
        const i = (y * w + x) * 4;
        const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const warmth = clamp(0.5 + (r - b) * 0.5, 0, 1);
          const region = y < hr ? sky : sea;

          region.brightness += lum;
          region.saturation += sat;
          region.warmth += warmth;
          region.count++;
          rowLum[y] += lum;

          if (x < w - 1) region.edges += Math.abs(lum - lumAt(x + 1, y));
          if (y < h - 1) region.edges += Math.abs(lum - lumAt(x, y + 1));
        }
      }

      for (let y = 0; y < h; y++) rowLum[y] /= w;

      const safeAvg = (region, key, fallback) => region.count ? region[key] / region.count : fallback;
      resolve({
        skyBrightness: safeAvg(sky, 'brightness', DEFAULT_FEATURES.skyBrightness),
        skySaturation: safeAvg(sky, 'saturation', DEFAULT_FEATURES.skySaturation),
        skyWarmth: safeAvg(sky, 'warmth', DEFAULT_FEATURES.skyWarmth),
        skyEdgeDensity: clamp(sky.edges / Math.max(1, sky.count * 0.20), 0, 1),
        seaBrightness: safeAvg(sea, 'brightness', DEFAULT_FEATURES.seaBrightness),
        seaSaturation: safeAvg(sea, 'saturation', DEFAULT_FEATURES.seaSaturation),
        seaWarmth: safeAvg(sea, 'warmth', DEFAULT_FEATURES.seaWarmth),
        seaEdgeDensity: clamp(sea.edges / Math.max(1, sea.count * 0.20), 0, 1),
        horizonContrast: clamp(Math.abs(rowLum[hr - 1] - rowLum[hr + 1]) * 4.0, 0, 1)
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

function createLoopNoise(ctx, brown) {
  const src = ctx.createBufferSource();
  src.buffer = createNoiseBuffer(ctx, 4, brown);
  src.loop = true;
  return src;
}

async function initSoundEngine() {
  if (audioCtx) {
    if (audioCtx.state !== 'running') await audioCtx.resume();
    return;
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.72;
  masterGain.connect(audioCtx.destination);

  // TONAL HORIZON: deliberately narrow, dark and almost immobile.
  toneOscA = audioCtx.createOscillator();
  toneOscB = audioCtx.createOscillator();
  harmonicOsc = audioCtx.createOscillator();
  toneOscA.type = 'sine';
  toneOscB.type = 'sine';
  harmonicOsc.type = 'sine';
  toneOscA.frequency.value = 110;
  toneOscB.frequency.value = 110.12;
  harmonicOsc.frequency.value = 220.25;

  toneFilter = audioCtx.createBiquadFilter();
  toneFilter.type = 'lowpass';
  toneFilter.frequency.value = 250;
  toneFilter.Q.value = 0.55;
  toneGain = audioCtx.createGain();
  toneGain.gain.value = 0.095;
  harmonicGain = audioCtx.createGain();
  harmonicGain.gain.value = 0.003;

  toneOscA.connect(toneFilter);
  toneOscB.connect(toneFilter);
  toneFilter.connect(toneGain);
  toneGain.connect(masterGain);
  harmonicOsc.connect(harmonicGain);
  harmonicGain.connect(masterGain);

  // SEA: brown noise, kept in the low-mid body, with one very slow swell.
  seaNoise = createLoopNoise(audioCtx, true);
  seaFilter = audioCtx.createBiquadFilter();
  seaFilter.type = 'bandpass';
  seaFilter.frequency.value = 620;
  seaFilter.Q.value = 0.58;
  seaGain = audioCtx.createGain();
  seaGain.gain.value = 0.048;
  seaSwellGain = audioCtx.createGain();
  seaSwellGain.gain.value = 0.88;
  seaSwellOsc = audioCtx.createOscillator();
  seaSwellDepth = audioCtx.createGain();
  seaSwellOsc.type = 'sine';
  seaSwellOsc.frequency.value = 0.035;
  seaSwellDepth.gain.value = 0.11;

  seaNoise.connect(seaFilter);
  seaFilter.connect(seaGain);
  seaGain.connect(seaSwellGain);
  seaSwellGain.connect(masterGain);
  seaSwellOsc.connect(seaSwellDepth);
  seaSwellDepth.connect(seaSwellGain.gain);

  // SKY: thin air, high and quiet, never a literal wind sample.
  skyNoise = createLoopNoise(audioCtx, false);
  skyFilter = audioCtx.createBiquadFilter();
  skyFilter.type = 'highpass';
  skyFilter.frequency.value = 4800;
  skyFilter.Q.value = 0.2;
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
  seaSwellOsc.start();
  skyNoise.start();

  await audioCtx.resume();

  // Start immediately; image analysis continues in the background.
  buildImageFeatures().then(() => {
    updateSoundFromVisuals(current, current, current, 0.5, 0);
  });
}

function blendFeatures(a, b, c, phase) {
  const fa = imageFeatures[images[idx(a)]] || DEFAULT_FEATURES;
  const fb = imageFeatures[images[idx(b)]] || DEFAULT_FEATURES;
  const fc = imageFeatures[images[idx(c)]] || DEFAULT_FEATURES;
  const wA0 = 0.5 * (1 - phase) * (1 - phase);
  const wB0 = 0.75 - (phase - 0.5) * (phase - 0.5);
  const wC0 = 0.5 * phase * phase;
  const sum = wA0 + wB0 + wC0;
  const wA = wA0 / sum, wB = wB0 / sum, wC = wC0 / sum;
  const mix = key => fa[key] * wA + fb[key] * wB + fc[key] * wC;
  return {
    skyBrightness: mix('skyBrightness'),
    skySaturation: mix('skySaturation'),
    skyWarmth: mix('skyWarmth'),
    skyEdgeDensity: mix('skyEdgeDensity'),
    seaBrightness: mix('seaBrightness'),
    seaSaturation: mix('seaSaturation'),
    seaWarmth: mix('seaWarmth'),
    seaEdgeDensity: mix('seaEdgeDensity'),
    horizonContrast: mix('horizonContrast')
  };
}

function updateSoundFromVisuals(a, b, c, phase, loopProgress = 0) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const f = blendFeatures(a, b, c, phase);
  const now = audioCtx.currentTime;

  // Horizon stays almost fixed. Overall colour only bends it by fractions of a hertz.
  const meanWarmth = (f.skyWarmth + f.seaWarmth) * 0.5;
  const meanBrightness = (f.skyBrightness + f.seaBrightness) * 0.5;
  const baseHz = 110
    + (meanWarmth - 0.5) * 0.55
    + (meanBrightness - 0.5) * 0.22;

  const structuralEnergy = clamp(
    f.seaEdgeDensity * 0.55 + f.skyEdgeDensity * 0.15 + f.horizonContrast * 0.30,
    0,
    1
  );
  const beatHz = lerp(0.08, 0.18, structuralEnergy);

  toneOscA.frequency.setTargetAtTime(baseHz, now, 1.2);
  toneOscB.frequency.setTargetAtTime(baseHz + beatHz, now, 1.2);
  harmonicOsc.frequency.setTargetAtTime(baseHz * 2.002, now, 1.35);
  toneFilter.frequency.setTargetAtTime(
    lerp(185, 315, clamp(meanBrightness * 0.65 + f.horizonContrast * 0.35, 0, 1)),
    now,
    1.25
  );
  harmonicGain.gain.setTargetAtTime(
    lerp(0.0012, 0.0055, clamp((f.skySaturation + f.seaSaturation) * 0.5, 0, 1)),
    now,
    1.4
  );
  toneGain.gain.setTargetAtTime(
    lerp(0.078, 0.108, f.horizonContrast),
    now,
    1.25
  );

  // SEA responds only to the part below the calibrated horizon.
  const seaActivity = clamp(f.seaEdgeDensity * 0.65 + f.seaSaturation * 0.25 + (1 - f.seaBrightness) * 0.10, 0, 1);
  seaFilter.frequency.setTargetAtTime(
    lerp(360, 1120, seaActivity),
    now,
    1.35
  );
  seaFilter.Q.setTargetAtTime(
    lerp(0.42, 0.92, clamp(f.seaSaturation * 0.55 + f.horizonContrast * 0.45, 0, 1)),
    now,
    1.4
  );
  seaGain.gain.setTargetAtTime(
    lerp(0.036, 0.068, clamp(f.seaEdgeDensity * 0.65 + f.seaSaturation * 0.20 + (1 - f.horizonContrast) * 0.15, 0, 1)),
    now,
    1.45
  );

  // SKY responds only to the part above the calibrated horizon.
  const skyAir = clamp(f.skyBrightness * 0.72 + (1 - f.skyEdgeDensity) * 0.18 + (1 - f.skyWarmth) * 0.10, 0, 1);
  skyFilter.frequency.setTargetAtTime(
    lerp(4200, 7800, skyAir),
    now,
    1.5
  );
  skyGain.gain.setTargetAtTime(
    lerp(0.0035, 0.0135, clamp(f.skyBrightness * 0.75 + f.skySaturation * 0.15 + (1 - f.skyEdgeDensity) * 0.10, 0, 1)),
    now,
    1.5
  );

  // One slow spatial breath over the 58-second visual cycle.
  skyPan.pan.setTargetAtTime(Math.sin(loopProgress * Math.PI * 2) * 0.22, now, 1.25);
}

// ------------------------------------------------------------
// CONTROLS
// ------------------------------------------------------------
const slider = document.querySelector('#horizonSlider');
const value = document.querySelector('#horizonValue');
const filename = document.querySelector('#filename');
const counter = document.querySelector('#counter');
const morphInput = document.querySelector('#morphInput');
const morphValue = document.querySelector('#morphValue');
const durationInput = document.querySelector('#durationInput');
const recordBtn = document.querySelector('#recordBtn');
const recordStatus = document.querySelector('#recordStatus');
const prevBtn = document.querySelector('#prevBtn');
const nextBtn = document.querySelector('#nextBtn');
const playBtn = document.querySelector('#playBtn');
const exitPlayback = document.querySelector('#exitPlayback');
const soundBtn = document.querySelector('#soundProxy');

function updateUI() {
  slider.value = horizons[images[current]];
  value.textContent = (+slider.value).toFixed(3);
  filename.textContent = images[current];
  counter.textContent = `${current + 1} / ${images.length}`;
  setSingle(current);
  updateSoundFromVisuals(current, current, current, 0.5, 0);
}

slider.addEventListener('input', () => {
  horizons[images[current]] = +slider.value;
  value.textContent = (+slider.value).toFixed(3);
  localStorage.setItem('liquidCommonsHorizons', JSON.stringify(horizons));
  setSingle(current);
});

prevBtn.addEventListener('click', () => {
  playback = false;
  document.body.classList.remove('playback');
  current = idx(current - 1);
  updateUI();
  resize();
});

nextBtn.addEventListener('click', () => {
  playback = false;
  document.body.classList.remove('playback');
  current = idx(current + 1);
  updateUI();
  resize();
});

soundBtn.addEventListener('click', async () => {
  if (!audioCtx) {
    soundBtn.textContent = 'Loading sound…';
    try {
      await initSoundEngine();
      soundBtn.textContent = 'Sound: on';
      updateSoundFromVisuals(current, current, current, 0.5, 0);
    } catch (e) {
      console.error(e);
      soundBtn.textContent = 'Sound error';
    }
    return;
  }

  if (audioCtx.state === 'running') {
    await audioCtx.suspend();
    soundBtn.textContent = 'Sound: off';
  } else {
    await audioCtx.resume();
    soundBtn.textContent = 'Sound: on';
    updateSoundFromVisuals(current, current, current, 0.5, 0);
  }
});

durationInput.value = totalDuration;
recordBtn.textContent = `Record ${totalDuration}s`;
durationInput.addEventListener('input', e => {
  totalDuration = Math.max(12, +e.target.value || 58);
  recordBtn.textContent = `Record ${totalDuration}s`;
});

morphInput.value = morphStrength;
morphValue.textContent = morphStrength.toFixed(3);
morphInput.addEventListener('input', e => {
  morphStrength = +e.target.value;
  material.uniforms.uStrength.value = morphStrength;
  morphValue.textContent = morphStrength.toFixed(3);
});

playBtn.addEventListener('click', () => {
  playback = true;
  document.body.classList.add('playback');
  startTime = performance.now();
  resize();
});

exitPlayback.addEventListener('click', () => {
  if (recording) return;
  playback = false;
  document.body.classList.remove('playback');
  current = 0;
  updateUI();
  resize();
});

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

recordBtn.addEventListener('click', async () => {
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
  try { recorder = new MediaRecorder(stream, options); }
  catch { recorder = new MediaRecorder(stream); }

  const chunks = [];
  recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
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
});

resize();
updateUI();

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
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);