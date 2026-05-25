import * as THREE from 'three';
import { MAT } from './materials';

const CONTAINER_GEO = new THREE.BoxGeometry(0.55, 0.4, 0.4);

/** Build a single cargo container. Material picked by caller. */
export function buildContainer(material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(CONTAINER_GEO, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Shared mesh builders for "figure" entities — currently just the micro
 * astronaut, but the convention is that anything humanoid lives here so
 * pedestrian / stationary / animated variants share geometry.
 *
 * Each builder returns the root group plus references to animatable parts
 * (e.g. arms) so callers can drive their motion without crawling the tree.
 */

export interface AstronautMesh {
  group: THREE.Group;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
}

/**
 * Standard micro astronaut. Legs are separate so a walking variant can swing
 * them. Forward direction: +Z (so a heading rotation around Y aligns the
 * astronaut to a walking direction in the standard way).
 */
export function buildAstronautMesh(): AstronautMesh {
  const g = new THREE.Group();

  const legGeo = new THREE.BoxGeometry(0.08, 0.26, 0.1);
  legGeo.translate(0, -0.13, 0); // pivot at hip so swinging rotates around the top
  const legL = new THREE.Mesh(legGeo, MAT.white);
  legL.position.set(-0.05, 0.26, 0);
  legL.castShadow = true;
  g.add(legL);

  const legR = new THREE.Mesh(legGeo, MAT.white);
  legR.position.set(0.05, 0.26, 0);
  legR.castShadow = true;
  g.add(legR);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.18), MAT.white);
  torso.position.y = 0.42;
  torso.castShadow = true;
  g.add(torso);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.04), MAT.blueTrans);
  visor.position.set(0, 0.67, 0.11);
  g.add(visor);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 10), MAT.white);
  helmet.position.y = 0.68;
  helmet.castShadow = true;
  g.add(helmet);

  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 0.08), MAT.gray);
  pack.position.set(0, 0.45, -0.14);
  pack.castShadow = true;
  g.add(pack);

  const armGeo = new THREE.BoxGeometry(0.08, 0.28, 0.08);
  armGeo.translate(0, -0.14, 0); // pivot at shoulder
  const armL = new THREE.Mesh(armGeo, MAT.white);
  armL.position.set(-0.2, 0.57, 0);
  armL.castShadow = true;
  g.add(armL);

  const armR = new THREE.Mesh(armGeo, MAT.white);
  armR.position.set(0.2, 0.57, 0);
  armR.castShadow = true;
  g.add(armR);

  const logo = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), MAT.redLED);
  logo.position.set(0, 0.45, 0.1);
  g.add(logo);

  return { group: g, armL, armR, legL, legR };
}
