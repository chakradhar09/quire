// Geometry of the document pane's custom scrollbar: pixels in, pixels out. Checked by scrollbar.test.ts.

export const MIN_THUMB = 28;
const MIN_TICK = 3;

// The thumb for a scroll area: its share of the track is the share of the content on screen.
export function thumb(scrollTop: number, client: number, scroll: number, track: number) {
  if (scroll <= client) return { top: 0, height: track, visible: false };
  const height = Math.min(track, Math.max(MIN_THUMB, (track * client) / scroll));
  return { top: ((track - height) * scrollTop) / (scroll - client), height, visible: true };
}

// scrollTop for a thumb dragged to `thumbTop` (the inverse of thumb), clamped to the scrollable range.
export function scrollFor(thumbTop: number, client: number, scroll: number, track: number) {
  const height = Math.min(track, Math.max(MIN_THUMB, (track * client) / scroll));
  const room = track - height;
  if (room <= 0) return 0;
  return Math.max(0, Math.min(1, thumbTop / room)) * (scroll - client);
}

// A passage at [top, top + height) of the content, drawn on the track at the same fraction.
export function tick(top: number, height: number, scroll: number, track: number) {
  const h = Math.max(MIN_TICK, (track * height) / scroll);
  return { top: Math.min(track - h, (track * top) / scroll), height: h };
}
