import { tokens } from '../tokens';

export interface SpringConfig {
  stiffness: number;
  damping: number;
}

export const springs = tokens.motion.spring;

/** Milliseconds from a duration token such as "220ms". */
export function ms(duration: string): number {
  return parseFloat(duration);
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Runs a damped spring (unit mass) from `from` to `to` on requestAnimationFrame and calls
 * `update` with each position. Returns a function that stops it. With reduced motion the value
 * jumps straight to `to`.
 */
export function spring(
  config: SpringConfig,
  from: number,
  to: number,
  velocity: number,
  update: (value: number) => void,
  done?: () => void,
): () => void {
  if (prefersReducedMotion()) {
    update(to);
    done?.();
    return () => {};
  }
  let x = from;
  let v = velocity;
  let last = performance.now();
  let frame = requestAnimationFrame(function step(now) {
    // Integrate in small fixed steps so the spring is stable at any frame rate.
    let elapsed = Math.min((now - last) / 1000, 1 / 15);
    last = now;
    const dt = 1 / 240;
    while (elapsed > 0) {
      const h = Math.min(dt, elapsed);
      v += (-config.stiffness * (x - to) - config.damping * v) * h;
      x += v * h;
      elapsed -= h;
    }
    // Settled when it's within half a pixel and nearly still.
    if (Math.abs(x - to) < 0.5 && Math.abs(v) < 1) {
      update(to);
      done?.();
      return;
    }
    update(x);
    frame = requestAnimationFrame(step);
  });
  return () => cancelAnimationFrame(frame);
}
