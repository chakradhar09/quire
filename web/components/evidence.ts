// Evidence colours and sizes, shared by server and client components.

// CSS colours for a source rank (rank 11 reuses colour 1), for the fluorescing highlight (globals.css .ev) and dots.
const slot = (rank: number) => ((rank - 1) % 10) + 1;
export const matchVars = (rank: number) => ({ tint: `var(--match-${slot(rank)}-bg)`, line: `var(--match-${slot(rank)}-solid)` });

// Share of the score drawn as dot diameter on a fixed ramp, so a source's weight reads at a glance.
export const dotSize = (percent: number) => Math.round(Math.min(28, 8 + Math.sqrt(Math.max(percent, 0)) * 5));
