/** Geometry constants for the LEGO 40786 model. Units are arbitrary scene units. */

// Track ring (gray monorail surface)
export const TRACK_OUTER = 6.4;
export const TRACK_INNER = 4.6;
export const TRACK_CORNER_R_OUT = 1.1;
export const TRACK_CORNER_R_IN = 0.6;
export const TRACK_Y = 0.10;

// Base plate (blue plate). Scaled up after the great strip-down so the
// plate fills the visible scene and dominates the moon backdrop.
export const BASE_SIZE = 28.0;
export const BASE_CORNER_R = 1.4;

// Standard Y-offset for set pieces sitting on the baseplate — a hair above
// the plate surface so they don't z-fight. Use this in place of bare 0.08s.
export const GROUND_OBJECT_Y = 0.08;
// Rocket launchpad sits even lower — its built-in base provides its own lift.
export const LAUNCHPAD_GROUND_Y = 0.06;
