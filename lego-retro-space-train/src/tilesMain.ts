// Tile palette dashboard. Renders every tile type at every rotation in
// a grid so we can see what pieces the layout system has to work with.
import * as THREE from 'three';
import {
  ALL_TILES,
  Direction,
  PlacedTile,
  Rotation,
  TILE_SIZE,
  effectivePorts,
  sampleWorldPath,
} from './world/trackTile';
import { MAT } from './world/materials';

const ROTATIONS: Rotation[] = [0, 1, 2, 3];
const CELL_SPACING = TILE_SIZE * 1.6; // gap between tiles in the grid

// --- Scene setup ---
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0c14');

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(8, 12, 6);
sun.castShadow = true;
scene.add(sun);

// Camera: top-down isometric, looking at the grid.
const aspect = window.innerWidth / Math.max(window.innerHeight - 100, 1);
const camHalf = ROTATIONS.length * CELL_SPACING * 0.7;
const camera = new THREE.OrthographicCamera(
  -camHalf * aspect, camHalf * aspect, camHalf, -camHalf, 0.1, 100,
);
camera.position.set(0, 30, 0);
camera.lookAt(0, 0, 0);

// --- Render each tile kind × each rotation ---
// Layout: rows = tile kinds, cols = rotations.
// Top-down view, so X increases right, Z increases down.
const tileKinds = ALL_TILES;
const rowCount = tileKinds.length;
const colCount = ROTATIONS.length;
const gridW = colCount * CELL_SPACING;
const gridH = rowCount * CELL_SPACING;
const gridX0 = -gridW / 2 + CELL_SPACING / 2;
const gridZ0 = -gridH / 2 + CELL_SPACING / 2;

// Materials
const padMat = MAT.grayDark.clone();
const deckMat = MAT.gray.clone();
deckMat.side = THREE.DoubleSide;
const railMat = MAT.grayDark;
const condMat = MAT.yellow;

for (let r = 0; r < rowCount; r++) {
  const def = tileKinds[r]!;
  for (let c = 0; c < colCount; c++) {
    const rot = ROTATIONS[c]!;
    const wx = gridX0 + c * CELL_SPACING;
    const wz = gridZ0 + r * CELL_SPACING;
    const tile: PlacedTile = { gridX: 0, gridZ: 0, def, rotation: rot };
    const group = new THREE.Group();
    group.position.set(wx, 0, wz);

    // Cell footprint (subtle pad).
    const padGeo = new THREE.BoxGeometry(TILE_SIZE * 0.96, 0.02, TILE_SIZE * 0.96);
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.y = 0.01;
    group.add(pad);

    // Draw every centerline path between every pair of ports.
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
          // Some pairs don't exist (e.g. STRAIGHT N-W); skip.
          void err;
        }
      }
    }

    // Port markers (small colored dots at each port boundary).
    for (const port of ports) {
      const [dx, dz] = dirVec(port);
      const mark = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 6),
        new THREE.MeshStandardMaterial({ color: portColor(port) }),
      );
      mark.position.set(dx * TILE_SIZE / 2, 0.15, dz * TILE_SIZE / 2);
      group.add(mark);
    }

    // Label (HTML overlay — simpler than 3D text).
    const label = document.createElement('div');
    label.style.position = 'absolute';
    label.style.color = '#ddd';
    label.style.fontSize = '10px';
    label.style.pointerEvents = 'none';
    label.style.transform = 'translate(-50%, 0)';
    label.dataset.wx = String(wx);
    label.dataset.wz = String(wz);
    label.textContent = `${def.kind} rot=${rot} ports={${ports.join(',')}}`;
    document.body.appendChild(label);

    scene.add(group);
  }
}

// Resize / project labels each frame so they follow their tiles.
function projectLabels(): void {
  const rect = canvas.getBoundingClientRect();
  for (const node of document.querySelectorAll<HTMLDivElement>('div[data-wx]')) {
    const wx = Number(node.dataset.wx);
    const wz = Number(node.dataset.wz);
    const v = new THREE.Vector3(wx, 0, wz + TILE_SIZE * 0.6).project(camera);
    const sx = (v.x * 0.5 + 0.5) * rect.width + rect.left;
    const sy = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
    node.style.left = `${sx}px`;
    node.style.top = `${sy}px`;
  }
}

function resize(): void {
  const w = window.innerWidth;
  const h = Math.max(window.innerHeight - 100, 200);
  renderer.setSize(w, h);
  const a = w / h;
  camera.left = -camHalf * a;
  camera.right = camHalf * a;
  camera.top = camHalf;
  camera.bottom = -camHalf;
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

// --- helpers ---
function drawTrack(group: THREE.Group, pts: THREE.Vector3[]): void {
  if (pts.length < 2) return;
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const samples = Math.max(48, pts.length * 4);
  const positions: number[] = [];
  const indices: number[] = [];
  const halfWidth = 0.45;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const nx = -tan.z;
    const nz = tan.x;
    const len = Math.sqrt(nx * nx + nz * nz) || 1;
    const lx = nx / len;
    const lz = nz / len;
    positions.push(p.x + lx * halfWidth, p.y + 0.04, p.z + lz * halfWidth);
    positions.push(p.x - lx * halfWidth, p.y + 0.04, p.z - lz * halfWidth);
  }
  for (let i = 0; i < samples; i++) {
    const a = i * 2; const b = a + 1; const c = a + 2; const d = a + 3;
    indices.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const deck = new THREE.Mesh(geo, deckMat);
  group.add(deck);

  // Rails (two thin strips offset perpendicular).
  for (const lateral of [-0.4, 0.4]) {
    const railPos: number[] = [];
    const railIdx: number[] = [];
    const railHalf = 0.04;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const nx = -tan.z;
      const nz = tan.x;
      const llen = Math.sqrt(nx * nx + nz * nz) || 1;
      const lx = nx / llen;
      const lz = nz / llen;
      const cx = p.x + lx * lateral;
      const cz = p.z + lz * lateral;
      railPos.push(cx + lx * railHalf, p.y + 0.085, cz + lz * railHalf);
      railPos.push(cx - lx * railHalf, p.y + 0.085, cz - lz * railHalf);
    }
    for (let i = 0; i < samples; i++) {
      const a = i * 2; const b = a + 1; const c = a + 2; const d = a + 3;
      railIdx.push(a, b, c, b, d, c);
    }
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute('position', new THREE.Float32BufferAttribute(railPos, 3));
    rgeo.setIndex(railIdx);
    rgeo.computeVertexNormals();
    group.add(new THREE.Mesh(rgeo, railMat));
  }

  // Conductor (centre yellow strip).
  const cPos: number[] = [];
  const cIdx: number[] = [];
  const cHalf = 0.05;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const nx = -tan.z;
    const nz = tan.x;
    const ll = Math.sqrt(nx * nx + nz * nz) || 1;
    const lx = nx / ll;
    const lz = nz / ll;
    cPos.push(p.x + lx * cHalf, p.y + 0.075, p.z + lz * cHalf);
    cPos.push(p.x - lx * cHalf, p.y + 0.075, p.z - lz * cHalf);
  }
  for (let i = 0; i < samples; i++) {
    const a = i * 2; const b = a + 1; const c = a + 2; const d = a + 3;
    cIdx.push(a, b, c, b, d, c);
  }
  const cGeo = new THREE.BufferGeometry();
  cGeo.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
  cGeo.setIndex(cIdx);
  cGeo.computeVertexNormals();
  group.add(new THREE.Mesh(cGeo, condMat));
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
  // N green, E blue, S red, W yellow — quick at-a-glance check.
  switch (d) {
    case 'N': return 0x33ff66;
    case 'E': return 0x3399ff;
    case 'S': return 0xff5555;
    case 'W': return 0xffcc33;
  }
}

