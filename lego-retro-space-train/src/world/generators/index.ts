// Registry of track-generation algorithms. Each generator exposes the
// same shape (TrackGeneratorResult — graph + stations + junctions) so
// callers can swap algorithms via a name string.
//
// Add a new generator: write a function returning TrackGeneratorResult,
// then register it in GENERATORS below. Switch at runtime via URL param
// `?algo=<name>` or by passing the name explicitly to pickGenerator().

import { GraphNode, TrackGraph } from '../trackGraph';
import { generateWFCGraph } from '../wfcGenerator';
import { generatePrimsGraph } from './prims';

export interface TrackGeneratorOptions {
  size: number;
  rng: () => number;
  maxRetries?: number;
}

export interface TrackGeneratorResult {
  graph: TrackGraph;
  stations: GraphNode[];
  junctions: GraphNode[];
  retries?: number;
}

export type TrackGenerator = (opts: TrackGeneratorOptions) => TrackGeneratorResult;

export const GENERATORS: Record<string, TrackGenerator> = {
  wfc: (opts) => generateWFCGraph(opts),
  prims: (opts) => generatePrimsGraph(opts),
};

export function pickGenerator(name?: string | null): TrackGenerator {
  if (!name) return GENERATORS.wfc!;
  const gen = GENERATORS[name.toLowerCase()];
  return gen ?? GENERATORS.wfc!;
}

export function generatorNames(): string[] {
  return Object.keys(GENERATORS);
}
