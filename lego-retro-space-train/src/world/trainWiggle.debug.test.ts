import { describe, it } from 'vitest';
import { TrackLayout } from './trackLayout';
import { buildGraphFromLayout, GraphNode } from './trackGraph';
import { STRAIGHT_NS, TEE_NES, TILE_SIZE } from './trackTile';
import { GraphTrain } from '../entities/GraphTrain';

/**
 * Trace the train through a TEE for both directions of approach. Dumps a
 * CSV per tick: tick, t-along-edge, edge-id, x, z, heading-rad, |Δpos|.
 *
 * Layout (all on y=0):
 *
 *        (2, 2)  south-end (station, dead-end S of (2, 1))
 *           │
 *        (2, 1)  STRAIGHT_NS R=0     (vertical spur)
 *           │
 *  W═══════TEE═══════E  (gz=0)
 *  (0,0)  (1,0) (2,0) (3,0) (4,0)
 *  west-  STR  TEE_NES STR  east-
 *  end                       end
 *
 * Train cycles west-end → south-end → east-end → south-end → west-end.
 * The two south-end legs exercise BOTH main approaches to the branch.
 */
describe('train trajectory through TEE branch', () => {
  it('dumps per-tick position for wiggle analysis', () => {
    const layout = new TrackLayout();
    // Horizontal mainline: STRAIGHT R=1 → ports {W, E}.
    layout.place(0, 0, STRAIGHT_NS, 1);
    layout.place(1, 0, STRAIGHT_NS, 1);
    // TEE_NES R=3 → ports {E, S, W}. Main pair E-W, lone port S.
    layout.place(2, 0, TEE_NES, 3, new Map([['W', 'E'], ['E', 'W']]));
    layout.place(3, 0, STRAIGHT_NS, 1);
    layout.place(4, 0, STRAIGHT_NS, 1);
    // Branch arm south: STRAIGHT R=0 → ports {N, S}.
    layout.place(2, 1, STRAIGHT_NS, 0);
    layout.place(2, 2, STRAIGHT_NS, 0);

    const graph = buildGraphFromLayout(layout, [
      { gx: 0, gz: 0, kind: 'station', label: 'west-end' },
      { gx: 2, gz: 0, kind: 'junction', label: 'tee' },
      { gx: 4, gz: 0, kind: 'station', label: 'east-end' },
      { gx: 2, gz: 2, kind: 'station', label: 'south-end' },
    ]);

    const stationByLabel = (l: string): GraphNode => {
      const n = graph.nodes.find((x) => x.label === l);
      if (!n) throw new Error(`no node ${l}`);
      return n;
    };
    const west = stationByLabel('west-end');
    const south = stationByLabel('south-end');
    const east = stationByLabel('east-end');

    // Quick edge dump for orientation. Useful when reading the trace.
    // `from` and `to` may include a `:mainSide` suffix on the id when the
    // endpoint is a TEE sub-node.
    console.log('--- edges ---');
    for (const e of graph.edges) {
      const fromTag = `${e.from.label ?? e.from.id}${e.from.mainSide ? `[${e.from.mainSide}]` : ''}`;
      const toTag = `${e.to.label ?? e.to.id}${e.to.mainSide ? `[${e.to.mainSide}]` : ''}`;
      console.log(
        `${e.id}: ${fromTag} (${e.fromExitPort}) ↔ ${toTag} (${e.toEntryPort}) len=${e.length.toFixed(3)}`,
      );
    }
    console.log('--- /edges ---');

    const train = new GraphTrain({
      graph,
      targetCycle: [south, east, south, west],
      startAt: west,
      speed: 1.6,
      dwellTime: 0.3, // short dwell so the trace stays focused on motion
      y: 0,
    });

    // Simulate ~22 seconds at 60 fps. Two W↔south↔east round trips give us
    // both W-approach and E-approach views of the branch.
    const DT = 1 / 60;
    const TICKS = Math.round(22 / DT);
    console.log('tick,t,edge,branchSide,x,z,heading_deg,dxdt,dzdt');
    let prevX = train.object3d.position.x;
    let prevZ = train.object3d.position.z;
    for (let i = 0; i < TICKS; i++) {
      train.update(DT);
      const px = train.object3d.position.x;
      const pz = train.object3d.position.z;
      const rotY = train.object3d.rotation.y;
      // Convert rotation.y (=atan2(tx, tz) - π/2) back to a heading angle in
      // degrees, with 0° = +X (east), 90° = -Z (north). The mesh faces along
      // its local +X by convention, so this matches the train's actual nose
      // direction. Negate to feel right when reading.
      const headingDeg = (((-(rotY + Math.PI / 2)) * 180) / Math.PI) % 360;
      const dxdt = (px - prevX) / DT;
      const dzdt = (pz - prevZ) / DT;
      // Print sparingly: every 6 ticks (~10 Hz) is plenty.
      if (i % 6 === 0) {
        const traini = train as unknown as {
          currentEdge: { id: string };
          t: number;
        };
        const ce = traini.currentEdge;
        console.log(
          `${i},${traini.t.toFixed(3)},${ce.id},` +
          `${px.toFixed(3)},${pz.toFixed(3)},${headingDeg.toFixed(1)},` +
          `${dxdt.toFixed(2)},${dzdt.toFixed(2)}`,
        );
      }
      prevX = px;
      prevZ = pz;
    }

    // Always pass; this test exists to print a trace.
    console.log('--- TEE cell ---');
    console.log(`TEE centre world: (${2 * TILE_SIZE}, 0, ${0 * TILE_SIZE})`);
    console.log(`TEE W port: (${2 * TILE_SIZE - TILE_SIZE / 2}, 0, 0)`);
    console.log(`TEE E port: (${2 * TILE_SIZE + TILE_SIZE / 2}, 0, 0)`);
    console.log(`TEE S port: (${2 * TILE_SIZE}, 0, ${TILE_SIZE / 2})`);
  });
});
