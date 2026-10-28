/* =========================================================
   MISSION 3D — wireframe  ->  final render
   Impact card me ek chhoti Three.js scene: building pehle sirf lines (drawing)
   hoti hai, phir neeche se upar "render" ban jati hai (scan-line ke saath).
   Yehi Axys3D ka kaam hai: drawing -> render.

   Install:  npm i three
   (optional types)  npm i -D @types/three
   File ki jagah:    src/scripts/mission-3d.ts
   ========================================================= */

import type * as ThreeNS from "three";

type T = typeof ThreeNS;

export interface Mission3DOptions {
  card: HTMLElement;
  canvas: HTMLCanvasElement;
  tag?: HTMLElement | null;
  onReady?: () => void;
  onFail?: () => void;
}

export const FLOORS = 22;
export const PITCH = 0.2;
export const CYCLE = 9.4; // seconds: draw 1.0 | build 3.2 | hold 4.0 | reset 1.2

const ease = (x: number) => 1 - Math.pow(1 - x, 3);
const easeIO = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** Timeline: t (seconds) -> { p: build progress 0..1, lineA: wireframe visibility 0..1 } */
export function timeline(time: number) {
  const tt = time % CYCLE;
  // pehle round me lines fade-in hoti hain; baad ke rounds me seedha lines se shuru (flicker nahi)
  if (tt < 1.0) return { p: 0, lineA: time < CYCLE ? ease(tt / 1.0) : 1, phase: time < CYCLE ? ("draw" as const) : ("build" as const) };
  if (tt < 4.2) return { p: easeIO((tt - 1.0) / 3.2), lineA: 1, phase: "build" as const };
  if (tt < 8.2) return { p: 1, lineA: 1, phase: "hold" as const };
  return { p: 1 - easeIO((tt - 8.2) / 1.2), lineA: 1, phase: "reset" as const };
}

/** Twisted tower: har floor ek slab + ek glass box. Return: group + wireframe lines + height */
export function buildTower(THREE: T) {
  const tower = new THREE.Group();

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x4a3d62,
    metalness: 0.35,
    roughness: 0.35,
    emissive: 0x1a1430,
    emissiveIntensity: 0.6,
  });
  const slabMat = new THREE.MeshStandardMaterial({
    color: 0xd2cbc6,
    metalness: 0.1,
    roughness: 0.6,
  });

  const edgePositions: number[] = [];
  const v = new THREE.Vector3();

  const addBox = (w: number, h: number, d: number, y: number, rot: number, mat: ThreeNS.Material) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = y;
    mesh.rotation.y = rot;
    mesh.updateMatrix();
    tower.add(mesh);

    const edges = new THREE.EdgesGeometry(geo);
    const pos = edges.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix);
      edgePositions.push(v.x, v.y, v.z);
    }
    edges.dispose();
  };

  for (let i = 0; i < FLOORS; i++) {
    const t = i / (FLOORS - 1);
    const w = 1.0 + 0.16 * Math.sin(t * Math.PI) - 0.28 * t; // beech me thora bulge, upar patla
    const rot = t * Math.PI * 0.55; // twist
    const y0 = i * PITCH;
    addBox(w * 1.05, 0.035, w * 1.05, y0 + 0.0175, rot, slabMat);
    addBox(w, 0.15, w, y0 + 0.035 + 0.075, rot, glassMat);
  }
  const topW = 1.0 - 0.28 + 0.0;
  addBox(topW * 0.5, 0.12, topW * 0.5, (FLOORS - 1) * PITCH + 0.26, Math.PI * 0.55, slabMat);

  const height = (FLOORS - 1) * PITCH + 0.32;

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0xededec, transparent: true, opacity: 0 });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  tower.add(lines);

  tower.position.y = -height / 2; // building center ke aas paas

  return { tower, lines, lineMat, glassMat, slabMat, height };
}

export async function initMission3D(opts: Mission3DOptions) {
  const { card, canvas, tag, onReady, onFail } = opts;

  // WebGL hai ya nahi
  const probe = document.createElement("canvas");
  if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) {
    onFail?.();
    return { destroy() {} };
  }

  const THREE = (await import("three")) as unknown as T;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const camBase = new THREE.Vector3(5.6, 3.6, 12.3);
  const camDir = camBase.clone().normalize();
  camera.position.copy(camBase);
  camera.lookAt(0, 0, 0);

  // lights
  scene.add(new THREE.AmbientLight(0x927f95, 0.75));
  const key = new THREE.DirectionalLight(0xededec, 1.4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x927f95, 0.8);
  rim.position.set(-4, 2, -2);
  scene.add(rim);

  const { tower, lineMat, glassMat, slabMat, height } = buildTower(THREE);
  const holder = new THREE.Group();
  holder.add(tower);
  scene.add(holder);

  // clipping plane: y <= constant dikhta hai
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  glassMat.clippingPlanes = [plane];
  slabMat.clippingPlanes = [plane];

  // scan-line glow
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x927f95,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1.35, 48).rotateX(-Math.PI / 2), glowMat);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xededec,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.35, 64).rotateX(-Math.PI / 2), ringMat);
  holder.add(glow, ring);

  // ground ring
  const groundMat = new THREE.MeshBasicMaterial({
    color: 0xededec,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ground = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.57, 80).rotateX(-Math.PI / 2), groundMat);
  ground.position.y = -height / 2 - 0.02;
  holder.add(ground);

  // size
  const resize = () => {
    // canvas ka apna size (right strip) — card ka nahi
    const w = Math.max(canvas.clientWidth, 1);
    const h = Math.max(canvas.clientHeight, 1);
    const dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.5 : 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Building hamesha poori fit ho: patli strip me camera thora door chala jata hai
    const tanH = Math.tan((camera.fov * Math.PI) / 360);
    const visH = Math.max(7.6, 4.0 / camera.aspect);
    camBase.copy(camDir).multiplyScalar(visH / (2 * tanH));
    if (reduce) draw(CYCLE * 0.62);
  };

  // pointer parallax
  let mx = 0;
  let my = 0;
  let smx = 0;
  let smy = 0;
  const onMove = (e: PointerEvent) => {
    const r = card.getBoundingClientRect();
    mx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    my = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  const onLeave = () => {
    mx = 0;
    my = 0;
  };
  if (!reduce) {
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", onLeave);
  }

  let rotY = 0.6;
  let lastLabel = "";

  function draw(time: number) {
    const { p, lineA, phase } = timeline(time);

    lineMat.opacity = lineA * (0.85 - 0.45 * p);

    const c = -height / 2 + p * (height + 0.05);
    plane.constant = c;
    glow.position.y = c;
    ring.position.y = c;
    const g = Math.min(p * 8, 1) * Math.min((1 - p) * 8, 1);
    glowMat.opacity = g * 0.34;
    ringMat.opacity = g * 0.85;

    smx += (mx - smx) * 0.06;
    smy += (my - smy) * 0.06;
    tower.rotation.y = rotY + smx * 0.45;
    camera.position.set(camBase.x, camBase.y + smy * -0.7, camBase.z);
    camera.lookAt(0, 0, 0);

    if (tag) {
      const label =
        phase === "draw" ? "Drawing" : p >= 1 ? "Final render" : `Rendering ${Math.round(p * 100)}%`;
      if (label !== lastLabel) {
        lastLabel = label;
        const span = tag.querySelector("span");
        if (span) span.textContent = label;
      }
    }
    renderer.render(scene, camera);
  }

  // loop
  let raf = 0;
  let running = false;
  let last = 0;
  let time = 0;

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    time += dt;
    rotY += dt * 0.22;
    draw(time);
  };
  const start = () => {
    if (running || reduce) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  if (reduce) draw(CYCLE * 0.62); // static final render

  const io = new IntersectionObserver(
    ([entry]) => (entry.isIntersecting && !document.hidden ? start() : stop()),
    { threshold: 0.05 },
  );
  io.observe(card);
  const onVis = () => (document.hidden ? stop() : undefined);
  document.addEventListener("visibilitychange", onVis);

  const onLost = (e: Event) => {
    e.preventDefault();
    stop();
    onFail?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  onReady?.();

  return {
    destroy() {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("webglcontextlost", onLost);
      scene.traverse((o) => {
        const m = o as ThreeNS.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      [glassMat, slabMat, lineMat, glowMat, ringMat, groundMat].forEach((x) => x.dispose());
      renderer.dispose();
    },
  };
}