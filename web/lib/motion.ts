// Motion in sequence: each step starts when the one before it reaches a point in its own run, so one
// movement hands over to the next. The rhythms are motion tokens (tokens.json, motion):
//   standard    slow-fast-slow, gentle: something moving or drawing across (IBM Carbon productive)
//   expressive  slow-fast-slow, weighty: the one big move on a screen (IBM Carbon expressive)
//   enter       fast-slow: arrives quickly and eases to rest (Material 3 emphasized decelerate)
//   exit        slow-fast: gathers and leaves (Material 3 emphasized accelerate)
//   settle      fast, past its mark, back: the landing of a small element that matters (overshoot)
//   anticipate  a slight wind-up back, then fast-slow: the hit after a hold
export type Ease = "standard" | "expressive" | "enter" | "exit" | "settle" | "anticipate";
// link: how far through this step (0 to 1) the next one starts; without it, the next waits for the end.
// hold: a rest after that point, before the next step (the pause that makes the next move land).
export type Step = { dur: number; link?: number; hold?: number; ease?: Ease };
export type Timed = { at: number; dur: number; ease: Ease };

export function chain(steps: Step[], start = 0): Timed[] {
  let at = start;
  return steps.map((s) => {
    const timed = { at, dur: s.dur, ease: s.ease ?? "standard" };
    at += s.dur * (s.link ?? 1) + (s.hold ?? 0);
    return timed;
  });
}

// For a CSS entrance (.enter-pop in globals.css), which reads these variables.
export const enter = (t: Timed) => ({ "--at": `${t.at}ms`, "--dur": `${t.dur}ms`, "--ease": `var(--motion-${t.ease})` });

// For a CSS transition on an element whose state flips: the change plays at its place in the chain.
export const transit = (t: Timed) => ({
  transitionDelay: `${t.at}ms`, transitionDuration: `${t.dur}ms`, transitionTimingFunction: `var(--motion-${t.ease})`,
});
