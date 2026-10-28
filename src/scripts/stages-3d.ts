/* =========================================================
   STAGES 3D — "layers" viewer  (Three.js)
   4 stage images (Sketch / Massing / BIM / Render) ek hi building ki
   4 glass layers ki tarah 3D me khulti hain, phir band ho kar agli stage
   dikhati hain.  Axonometric (architect-style) look + halka parallax.

   Install:   npm i three
   File:      src/scripts/stages-3d.ts
   ========================================================= */

import type * as ThreeNS from "three";

type T = typeof ThreeNS;

export const PLANE_H = 2;
export const PLANE_W = (PLANE_H * 16) / 9.5; // card ka aspect-ratio
export const GAP = 0.55; // layers ke darmiyan depth
export const STAGGER = 0.26; // peechhe wali layer thori upar (labels overlap na hon)
export const OPEN_DIST = 1.85; // khulne par camera kitna peechhe jaye
export const OPEN_YAW = -0.52;
export const OPEN_PITCH = 0.2;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* ---------- Sequencer: kab khule, kab stage badle, kab band ho (pure logic) ---------- */
export class Sequencer {
  active = 0;
  e = 0; // 0 = band (sirf active layer), 1 = poora khula
  hold = false;
  private pending: number | null = null;
  private seqT = 0;
  private seqOn = false;

  constructor(private reduce = false) {}

  setActive(i: number) {
    this.active = i;
    this.pending = null;
  }

  goTo(i: number) {
    if (this.reduce) {
      this.active = i;
      return;
    }
    if (i === this.active && !this.seqOn) return;
    this.seqT = this.seqOn ? Math.min(this.seqT, 0.55) : 0;
    this.pending = i;
    this.seqOn = true;
  }

  setHold(on: boolean) {
    this.hold = this.reduce ? false : on;
  }

  update(dt: number) {
    if (this.seqOn) {
      this.seqT += dt;
      if (this.seqT >= 0.55 && this.pending !== null) {
        this.active = this.pending;
        this.pending = null;
      }
      if (this.seqT >= 1.0) {
        this.seqOn = false;
        this.seqT = 0;
      }
    }
    const target = this.seqOn || this.hold ? 1 : 0;
    this.e += (target - this.e) * (1 - Math.exp(-dt * 7));
    if (Math.abs(target - this.e) < 0.001) this.e = target;
    return { e: this.e, active: this.active };
  }
}

/* ---------- Layers: planes + edges + construction lines ---------- */
export function buildLayers(THREE: T, textures: ThreeNS.Texture[]) {
  const n = textures.length;
  const group = new THREE.Group();
  const planes: ThreeNS.Mesh[] = [];
  const mats: ThreeNS.MeshBasicMaterial[] = [];
  const edgeMats: ThreeNS.LineBasicMaterial[] = [];

  const geo = new THREE.PlaneGeometry(PLANE_W, PLANE_H);
  const hw = PLANE_W / 2;
  const hh = PLANE_H / 2;
  const edgeGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-hw, -hh, 0.002),
    new THREE.Vector3(hw, -hh, 0.002),
    new THREE.Vector3(hw, hh, 0.002),
    new THREE.Vector3(-hw, hh, 0.002),
  ]);

  textures.forEach((tex, i) => {
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: i === 0 ? 1 : 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = i;

    const em = new THREE.LineBasicMaterial({ color: 0x927f95, transparent: true, opacity: 0, depthWrite: false });
    const edge = new THREE.LineLoop(edgeGeo, em);
    edge.renderOrder = i + 0.5;
    mesh.add(edge);

    group.add(mesh);
    planes.push(mesh);
    mats.push(mat);
    edgeMats.push(em);
  });

  // construction lines: har corner par layers ko jodti hui patli lines
  const segs = Math.max(n - 1, 0) * 4;
  const linePos = new Float32Array(segs * 2 * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0xededec, transparent: true, opacity: 0, depthWrite: false });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  lines.frustumCulled = false;
  lines.renderOrder = 0.25;
  group.add(lines);

  // dust (halke chamakte zarray)
  const DUST = 60;
  const dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 7;
    dustPos[i * 3 + 1] = (Math.random() - 0.5) * 4.2;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 4 - 0.8;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0x927f95,
    size: 0.035,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  dust.renderOrder = 0.1;
  group.add(dust);

  return { group, planes, mats, edgeMats, lines, lineMat, lineGeo, dust, dustGeo, dustMat, geo, edgeGeo };
}

export type Layers = ReturnType<typeof buildLayers>;

/** Layers ki jagah: e=0 sab ek jagah, e=1 depth me khuli hui */
export function layout(L: Layers, e: number) {
  const n = L.planes.length;
  const hw = PLANE_W / 2;
  const hh = PLANE_H / 2;
  const pos = L.lineGeo.getAttribute("position") as ThreeNS.BufferAttribute;
  const corners: Array<[number, number]> = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  const ys: number[] = [];
  const zs: number[] = [];

  L.planes.forEach((p, i) => {
    const k = n - 1 - i; // front layer (last) k=0
    const y = k * STAGGER * e;
    const z = -k * GAP * e;
    p.position.set(0, y, z);
    ys.push(y);
    zs.push(z);
  });

  let w = 0;
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < n - 1; i++) {
      pos.setXYZ(w++, corners[c][0], corners[c][1] + ys[i], zs[i]);
      pos.setXYZ(w++, corners[c][0], corners[c][1] + ys[i + 1], zs[i + 1]);
    }
  }
  pos.needsUpdate = true;
  L.group.position.y = (-((n - 1) * STAGGER) / 2) * e;
}

export interface Stages3DOptions {
  card: HTMLElement;
  canvas: HTMLCanvasElement;
  sources: string[];
  labels: HTMLElement[];
  reduce: boolean;
  onReady?: () => void;
  onFail?: () => void;
}

export interface Stages3DViewer {
  goTo(i: number): void;
  setActive(i: number): void;
  setHold(on: boolean): void;
  pick(clientX: number, clientY: number): number;
  destroy(): void;
}

export async function initStages3D(o: Stages3DOptions): Promise<Stages3DViewer | null> {
  const { card, canvas, sources, labels, reduce, onReady, onFail } = o;

  const probe = document.createElement("canvas");
  if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) {
    onFail?.();
    return null;
  }

  const THREE = (await import("three")) as unknown as T;

  let renderer: ThreeNS.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    onFail?.();
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // textures
  const loader = new THREE.TextureLoader();
  let textures: ThreeNS.Texture[];
  try {
    textures = await Promise.all(
      sources.map(
        (src) =>
          new Promise<ThreeNS.Texture>((res, rej) =>
            loader.load(
              src,
              (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
                // object-fit: cover jaisa
                const img = tex.image as { width: number; height: number };
                const pa = PLANE_W / PLANE_H;
                const ia = img.width / img.height;
                if (ia > pa) {
                  tex.repeat.set(pa / ia, 1);
                  tex.offset.set((1 - pa / ia) / 2, 0);
                } else {
                  tex.repeat.set(1, ia / pa);
                  tex.offset.set(0, (1 - ia / pa) / 2);
                }
                res(tex);
              },
              undefined,
              () => rej(new Error("texture load failed: " + src)),
            ),
          ),
      ),
    );
  } catch {
    renderer.dispose();
    onFail?.();
    return null;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 16 / 9.5, 0.1, 100);
  const tanH = Math.tan((camera.fov * Math.PI) / 360);

  const L = buildLayers(THREE, textures);
  scene.add(L.group);

  const seq = new Sequencer(reduce);
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  let baseDist = 4;
  let w = 1;
  let h = 1;

  const resize = () => {
    w = Math.max(card.clientWidth, 1);
    h = Math.max(card.clientHeight, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.5 : 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // front layer poore card ko bhare (height ya width, jo bhi tang ho)
    baseDist = Math.max(PLANE_H / (2 * tanH), PLANE_W / (2 * tanH * camera.aspect));
    if (reduce) draw(0);
  };

  // pointer + (phone) gyro parallax
  let px = 0;
  let py = 0;
  let spx = 0;
  let spy = 0;
  let hovered = -1;
  let lastHoverCheck = 0;

  const onMove = (ev: PointerEvent) => {
    const r = card.getBoundingClientRect();
    px = ((ev.clientX - r.left) / r.width - 0.5) * 2;
    py = ((ev.clientY - r.top) / r.height - 0.5) * 2;
  };
  const onLeave = () => {
    px = 0;
    py = 0;
    hovered = -1;
    canvas.style.cursor = "";
  };
  const onOri = (ev: DeviceOrientationEvent) => {
    if (ev.gamma == null || ev.beta == null) return;
    px = clamp(ev.gamma / 35, -1, 1);
    py = clamp((ev.beta - 50) / 35, -1, 1);
  };
  if (!reduce) {
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", onLeave);
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const needsPermission =
      typeof (window as unknown as { DeviceOrientationEvent?: { requestPermission?: unknown } }).DeviceOrientationEvent
        ?.requestPermission === "function";
    if (coarse && !needsPermission) window.addEventListener("deviceorientation", onOri);
  }

  function pick(clientX: number, clientY: number) {
    const r = card.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    L.group.updateMatrixWorld(true);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(L.planes, false);
    for (const hit of hits) {
      const idx = L.planes.indexOf(hit.object as ThreeNS.Mesh);
      if (idx >= 0 && L.mats[idx].opacity > 0.05) return idx;
    }
    return -1;
  }

  const labelW = labels.map(() => 80);
  const tmp = new THREE.Vector3();
  let lastEx = -1;

  function draw(dt: number) {
    const { e, active } = seq.update(dt);

    // opacity: band = sirf active, khula = sab (active sab se roshan)
    L.mats.forEach((m, i) => {
      const openOp = i === active ? 1 : i === hovered ? 0.9 : 0.6;
      const closedOp = i === active ? 1 : 0;
      const target = lerp(closedOp, openOp, e);
      m.opacity += (target - m.opacity) * (1 - Math.exp(-dt * 10));
      if (dt === 0) m.opacity = target;
      L.edgeMats[i].opacity = e * (i === active ? 0.95 : 0.45);
      L.edgeMats[i].color.setHex(i === active ? 0xd2cbc6 : 0x927f95);
    });
    L.lineMat.opacity = e * 0.32;
    L.dustMat.opacity = reduce ? 0 : e * 0.75;

    layout(L, e);

    // dust upar ki taraf behta hai
    if (!reduce && dt > 0 && e > 0.02) {
      const arr = L.dustGeo.getAttribute("position") as ThreeNS.BufferAttribute;
      for (let i = 0; i < arr.count; i++) {
        let y = arr.getY(i) + dt * 0.12;
        if (y > 2.2) y = -2.2;
        arr.setY(i, y);
      }
      arr.needsUpdate = true;
    }

    // rotation + camera
    spx += (px - spx) * (1 - Math.exp(-dt * 5));
    spy += (py - spy) * (1 - Math.exp(-dt * 5));
    const par = 0.03 + 0.22 * e;
    L.group.rotation.y = lerp(0, OPEN_YAW, e) + spx * par;
    L.group.rotation.x = lerp(0, OPEN_PITCH, e) + spy * par * 0.7;
    camera.position.set(0, 0, baseDist * lerp(1, OPEN_DIST, e));
    camera.lookAt(0, 0, 0);

    // hover on layer (khula ho tab)
    const now = performance.now();
    if (e > 0.6 && now - lastHoverCheck > 60 && (px !== 0 || py !== 0)) {
      lastHoverCheck = now;
      ndc.set(px, -py);
      L.group.updateMatrixWorld(true);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(L.planes, false);
      hovered = hits.length ? L.planes.indexOf(hits[0].object as ThreeNS.Mesh) : -1;
      canvas.style.cursor = hovered >= 0 ? "pointer" : "";
    } else if (e <= 0.6 && hovered !== -1) {
      hovered = -1;
      canvas.style.cursor = "";
    }

    renderer.render(scene, camera);

    // css: chips/badges khulne par chup, layer labels aayen
    if (Math.abs(e - lastEx) > 0.004) {
      lastEx = e;
      card.style.setProperty("--ex", e.toFixed(3));
    }
    labels.forEach((el, i) => {
      el.classList.toggle("is-active", i === active);
      if (e < 0.03) return;
      L.planes[i].localToWorld(tmp.set(PLANE_W / 2, PLANE_H / 2, 0));
      tmp.project(camera);
      if (!labelW[i] || labelW[i] === 80) labelW[i] = el.offsetWidth || 80;
      const x = clamp((tmp.x * 0.5 + 0.5) * w + 8, 6, w - labelW[i] - 6);
      const y = clamp((-tmp.y * 0.5 + 0.5) * h, 24, h - 8);
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translateY(-110%)`;
    });
  }

  // loop (sirf screen par hone par)
  let raf = 0;
  let running = false;
  let last = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    draw(dt);
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
  ro.observe(card);
  resize();
  if (reduce) draw(0);

  const io = new IntersectionObserver(([en]) => (en.isIntersecting && !document.hidden ? start() : stop()), {
    threshold: 0.05,
  });
  io.observe(card);
  const onVis = () => (document.hidden ? stop() : undefined);
  document.addEventListener("visibilitychange", onVis);

  const onLost = (ev: Event) => {
    ev.preventDefault();
    stop();
    onFail?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  onReady?.();

  return {
    goTo(i) {
      seq.goTo(i);
      if (reduce) draw(0);
    },
    setActive(i) {
      seq.setActive(i);
      if (reduce) draw(0);
    },
    setHold(on) {
      seq.setHold(on);
    },
    pick,
    destroy() {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("deviceorientation", onOri);
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("webglcontextlost", onLost);
      [L.geo, L.edgeGeo, L.lineGeo, L.dustGeo].forEach((g) => g.dispose());
      L.mats.forEach((m) => m.dispose());
      [...L.edgeMats, L.lineMat, L.dustMat].forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      renderer.dispose();
    },
  };
}