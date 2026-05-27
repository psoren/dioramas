// Tile palette dashboard. Renders every tile type at every rotation in
// a grid + a "compound pieces" section showing how tiles combine into
// actual layout features (L-spur, bridge).
import * as THREE from 'three';
import {
  CURVE_NE,
  CROSS_NESW,
  Direction,
  ELEVATED_STRAIGHT_NS,
  PlacedTile,
  RAMP_HEIGHT,
  RAMP_NS,
  Rotation,
  STRAIGHT_NS,
  TEE_NES,
  TILE_SIZE,
  TrackTileDef,
  effectivePorts,
  sampleWorldPath,
} from './world/trackTile';
import { MAT } from './world/materials';

const ROTATIONS: Rotation[] = [0, 1, 2, 3];
const CELL_SPACING = TILE_SIZE * 1.7;

// Friendly names + descriptions per tile kind.
const TILE_INFO: Record<string, { name: string; desc: string }> = {
  'straight-ns':            { name: 'STRAIGHT',  desc: '2-port: passes through. Base ports N/S.' },
  'curve-ne':               { name: 'CURVE 90°', desc: '2-port: quarter arc. Base ports N/E.' },
  'tee-nes':                { name: 'TEE / Y',   desc: '3-port: main straight + branch. Our "Y-junction".' },
  'cross-nesw':             { name: 'CROSS',     desc: '4-port: two straight crossings.' },
  'ramp-ns':                { name: 'RAMP',      desc: '2-port: rises 0 → RAMP_HEIGHT linearly.' },
  'elevated-straight-ns':   { name: 'ELEVATED',  desc: '2-port: flat straight at RAMP_HEIGHT.' },
};

// --- Scene setup ---
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0c14');

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(8, 12, 6);
sun.castShadow = true;
scene.add(sun);

// --- Materials ---
const padMat = MAT.grayDark.clone();
const deckMat = MAT.gray.clone();
deckMat.side = THREE.DoubleSide;
const railMat = MAT.grayDark;
const condMat = MAT.yellow;

// --- Section 1: each tile kind × each rotation ---
const allTiles: TrackTileDef[] = [STRAIGHT_NS, CURVE_NE, TEE_NES, CROSS_NESW, RAMP_NS, ELEVATED_STRAIGHT_NS];
const rowCount = allTiles.length;
const colCount = ROTATIONS.length;
const sec1GridZ0 = -(rowCount * CELL_SPACING) / 2 + CELL_SPACING / 2;
const sec1GridX0 = -((colCount + 1) * CELL_SPACING) / 2 + CELL_SPACING / 2;

for (let r = 0; r < rowCount; r++) {
  const def = allTiles[r]!;
  // Row label.
  addHtmlLabel(sec1GridX0 - CELL_SPACING * 0.85, sec1GridZ0 + r * CELL_SPACING, `${TILE_INFO[def.kind]?.name ?? def.kind}\n${def.kind}`, 'left');
  for (let c = 0; c < colCount; c++) {
    const rot = ROTATIONS[c]!;
    const wx = sec1GridX0 + c * CELL_SPACING;
    const wz = sec1GridZ0 + r * CELL_SPACING;
    placeSingleTile(def, rot, wx, wz);
    addHtmlLabel(wx, wz + CELL_SPACING * 0.5, `rot ${rot}`, 'center');
  }
}

// Column header.
for (let c = 0; c < colCount; c++) {
  const wx = sec1GridX0 + c * CELL_SPACING;
  addHtmlLabel(wx, sec1GridZ0 - CELL_SPACING * 0.7, `rotation ${ROTATIONS[c]}`, 'center', true);
}

// --- Section 2: compound pieces (multi-tile macros) ---
// Place to the right of section 1.
const sec2X0 = sec1GridX0 + (colCount + 1) * CELL_SPACING;

// 2a: L-spur (the "Y-switch" macro): TEE + CURVE + STRAIGHT + station.
// Layout (run direction E, branch peels north and curves west):
//
//    [STRAIGHT] [CURVE] [-empty-]
//    [-empty-]  [-empty-] [-empty-]
//    [STRAIGHT] [TEE]   [STRAIGHT]
//
// (Cell centres in tile coords, then scaled to world.)
{
  const cells: Array<{ def: TrackTileDef; rotation: Rotation; cx: number; cz: number; label?: string }> = [
    { def: STRAIGHT_NS,    rotation: 1, cx: 0, cz: 0 },   // main left
    { def: TEE_NES,        rotation: 1, cx: 1, cz: 0, label: 'TEE' }, // teeRot 1 → ports {W,N,E}
    { def: STRAIGHT_NS,    rotation: 1, cx: 2, cz: 0 },   // main right
    { def: CURVE_NE,       rotation: 2, cx: 1, cz: -1, label: 'CURVE' }, // ports {S,W}
    { def: STRAIGHT_NS,    rotation: 1, cx: 0, cz: -1, label: 'station' }, // E-W straight, station end
  ];
  const baseX = sec2X0;
  const baseZ = sec1GridZ0;
  for (const c of cells) {
    placeSingleTile(c.def, c.rotation, baseX + c.cx * TILE_SIZE, baseZ + c.cz * TILE_SIZE);
    if (c.label) addHtmlLabel(baseX + c.cx * TILE_SIZE, baseZ + c.cz * TILE_SIZE + TILE_SIZE * 0.55, c.label, 'center');
  }
  addHtmlLabel(baseX + TILE_SIZE, baseZ - TILE_SIZE * 1.5, 'L-spur ("Y-junction" macro)\nTEE + CURVE + STRAIGHT', 'center', true);
}

// 2b: bridge (RAMP + ELEVATED + RAMP).
{
  const cells: Array<{ def: TrackTileDef; rotation: Rotation; cx: number; cz: number; label?: string }> = [
    { def: STRAIGHT_NS,         rotation: 1, cx: 0, cz: 0 },
    { def: RAMP_NS,             rotation: 1, cx: 1, cz: 0, label: 'RAMP up' },     // east-going ramp up
    { def: ELEVATED_STRAIGHT_NS, rotation: 1, cx: 2, cz: 0, label: 'ELEVATED' },
    { def: RAMP_NS,             rotation: 3, cx: 3, cz: 0, label: 'RAMP down' },
    { def: STRAIGHT_NS,         rotation: 1, cx: 4, cz: 0 },
  ];
  const baseX = sec2X0;
  const baseZ = sec1GridZ0 + CELL_SPACING * 3;
  for (const c of cells) {
    placeSingleTile(c.def, c.rotation, baseX + c.cx * TILE_SIZE, baseZ + c.cz * TILE_SIZE);
    if (c.label) addHtmlLabel(baseX + c.cx * TILE_SIZE, baseZ + c.cz * TILE_SIZE + TILE_SIZE * 0.55, c.label, 'center');
  }
  addHtmlLabel(baseX + TILE_SIZE * 2, baseZ - TILE_SIZE * 1.2, 'Bridge (RAMP + ELEVATED + RAMP)', 'center', true);
}

// 2c: a single CROSS-NESW with both crossings highlighted.
{
  placeSingleTile(CROSS_NESW, 0, sec2X0 + TILE_SIZE * 2, sec1GridZ0 + CELL_SPACING * 5);
  addHtmlLabel(sec2X0 + TILE_SIZE * 2, sec1GridZ0 + CELL_SPACING * 5 + TILE_SIZE * 0.55, '4-way CROSS', 'center');
  addHtmlLabel(sec2X0 + TILE_SIZE * 2, sec1GridZ0 + CELL_SPACING * 5 - TILE_SIZE * 0.8, 'CROSS_NESW (perpendicular 90°)', 'center', true);
}

// --- Camera covers both sections ---
const totalW = (sec2X0 - sec1GridX0) + CELL_SPACING * 5.5;
const totalH = rowCount * CELL_SPACING + CELL_SPACING * 1.5;
const camHalfX = totalW / 2;
const camHalfZ = totalH / 2;
const camCenter = { x: (sec1GridX0 - CELL_SPACING * 0.9 + sec2X0 + CELL_SPACING * 5) / 2, z: 0 };

const aspect = window.innerWidth / Math.max(window.innerHeight - 100, 1);
const ortho = Math.max(camHalfX / aspect, camHalfZ);
const camera = new THREE.OrthographicCamera(
  -ortho * aspect, ortho * aspect, ortho, -ortho, 0.1, 100,
);
camera.position.set(camCenter.x, 40, camCenter.z);
camera.lookAt(camCenter.x, 0, camCenter.z);

function resize(): void {
  const w = window.innerWidth;
  const h = Math.max(window.innerHeight - 100, 200);
  renderer.setSize(w, h);
  const a = w / h;
  const o = Math.max(camHalfX / a, camHalfZ);
  camera.left = -o * a;
  camera.right = o * a;
  camera.top = o;
  camera.bottom = -o;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function loop(): void {
  renderer.render(scene, camera);
  projectLabels();
  requestAnimationFrame(loop);
}
loop();

// --- Helpers ---
function placeSingleTile(def: TrackTileDef, rotation: Rotation, wx: number, wz: number): void {
  const tile: PlacedTile = { gridX: 0, gridZ: 0, def, rotation };
  const group = new THREE.Group();
  group.position.set(wx, 0, wz);

  // Cell pad.
  const padGeo = new THREE.BoxGeometry(TILE_SIZE * 0.96, 0.02, TILE_SIZE * 0.96);
  const pad = new THREE.Mesh(padGeo, padMat);
  pad.position.y = 0.01;
  group.add(pad);

  // Draw all valid port-pair paths.
  const ports = effectivePorts(tile);
  const drawn = new Set<string>();
  for (let i = 0; i < ports.length; i++) {
    for (let j = i + 1; j < ports.length; j++) {
      const a = ports[i]!;
      const b = ports[j]!;
      if (a === b) continue;
      const key = [a, b].sort().join('');
      if (drawn.has(key)) continue;
      drawn.add(key);
      try {
        const pts = sampleWorldPath(tile, a, b, 24);
        drawTrack(group, pts);
      } catch (err) {
        void err;
      }
    }
  }

  // Port markers (small coloured dots at boundary positions).
  for (const port of ports) {
    const [dx, dz] = dirVec(port);
    const mark = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshStandardMaterial({ color: portColor(port) }),
    );
    mark.position.set(dx * TILE_SIZE / 2, 0.2 + (def.kind === 'elevated-straight-ns' ? RAMP_HEIGHT : 0), dz * TILE_SIZE / 2);
    group.add(mark);
  }

  scene.add(group);
}

function drawTrack(group: THREE.Group, pts: THREE.Vector3[]): void {
  if (pts.length < 2) return;
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const samples = Math.max(48, pts.length * 4);
  buildStrip(group, curve, samples, 0.45, 0, 0.04, deckMat);
  for (const lateral of [-0.4, 0.4]) buildStrip(group, curve, samples, 0.04, lateral, 0.085, railMat);
  buildStrip(group, curve, samples, 0.05, 0, 0.075, condMat);
}

function buildStrip(
  group: THREE.Group,
  curve: THREE.CatmullRomCurve3,
  samples: number,
  halfWidth: number,
  lateral: number,
  y: number,
  mat: THREE.Material,
): void {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const nx = -tan.z;
    const nz = tan.x;
    const len = Math.sqrt(nx * nx + nz * nz) || 1;
    const lx = nx / len;
    const lz = nz / len;
    const cx = p.x + lx * lateral;
    const cz = p.z + lz * lateral;
    const py = p.y + y;
    positions.push(cx + lx * halfWidth, py, cz + lz * halfWidth);
    positions.push(cx - lx * halfWidth, py, cz - lz * halfWidth);
  }
  for (let i = 0; i < samples; i++) {
    const a = i * 2; const b = a + 1; const c = a + 2; const d = a + 3;
    indices.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, mat));
}

function addHtmlLabel(
  wx: number,
  wz: number,
  text: string,
  align: 'left' | 'center' | 'right',
  header: boolean = false,
): void {
  const label = document.createElement('div');
  label.style.position = 'absolute';
  label.style.color = header ? '#9ce' : '#ddd';
  label.style.fontSize = header ? '13px' : '11px';
  label.style.fontWeight = header ? 'bold' : 'normal';
  label.style.pointerEvents = 'none';
  label.style.whiteSpace = 'pre';
  label.style.textAlign = align;
  const transformX = align === 'left' ? '0' : align === 'right' ? '-100%' : '-50%';
  label.style.transform = `translate(${transformX}, 0)`;
  label.dataset.wx = String(wx);
  label.dataset.wz = String(wz);
  label.textContent = text;
  document.body.appendChild(label);
}

function projectLabels(): void {
  const rect = canvas.getBoundingClientRect();
  for (const node of document.querySelectorAll<HTMLDivElement>('div[data-wx]')) {
    const wx = Number(node.dataset.wx);
    const wz = Number(node.dataset.wz);
    const v = new THREE.Vector3(wx, 0, wz).project(camera);
    const sx = (v.x * 0.5 + 0.5) * rect.width + rect.left;
    const sy = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
    node.style.left = `${sx}px`;
    node.style.top = `${sy}px`;
  }
}

function dirVec(d: Direction): readonly [number, number] {
  switch (d) {
    case 'N': return [0, -1];
    case 'E': return [1, 0];
    case 'S': return [0, 1];
    case 'W': return [-1, 0];
  }
}

function portColor(d: Direction): number {
  switch (d) {
    case 'N': return 0x33ff66;
    case 'E': return 0x3399ff;
    case 'S': return 0xff5555;
    case 'W': return 0xffcc33;
  }
}
