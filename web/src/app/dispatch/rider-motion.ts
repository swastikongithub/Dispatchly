import type { Api } from '../core/api/api-client';
import { tokens } from '../tokens';

/**
 * Rider marker motion (PLAN.md §6.2). The server sends every rider's position every 2 s; this
 * keeps the last few for each rider and renders `renderDelay` behind real time, interpolating
 * between them, so movement is continuous. A late update is extrapolated for at most
 * `maxExtrapolation`, then the marker holds. Bearings ease along the shortest angle.
 *
 * Times are local `performance.now()` milliseconds. Server times (`at`) are mapped onto that clock
 * with the smallest offset seen recently: the batch that arrived fastest.
 */

export type RiderStatus = Api['RiderStatus'];

/** `[id, lat, lng, bearing, status]`, as in `riders:batch` (docs/realtime.md). */
export type RiderPoint = [
  id: number,
  lat: number,
  lng: number,
  bearing: number,
  status: RiderStatus,
];

export interface RiderFrame {
  id: number;
  lat: number;
  lng: number;
  bearing: number;
  status: RiderStatus;
}

export interface MotionOptions {
  renderDelay: number;
  maxExtrapolation: number;
  bearingDuration: number;
  /** Reduced motion: show the latest position straight away, without easing. */
  instant: boolean;
}

interface Sample {
  t: number;
  lat: number;
  lng: number;
  bearing: number;
  status: RiderStatus;
}

interface Track {
  samples: Sample[];
  bearingFrom: number;
  bearingTo: number;
  bearingStart: number;
  shownBearing: number;
}

const ms = (duration: string) => parseFloat(duration);
const KEEP_SAMPLES = 4;
/** How many batches the clock offset is taken over. */
const OFFSET_WINDOW = 10;

export const defaultMotion: MotionOptions = {
  renderDelay: ms(tokens.motion.duration.renderDelay),
  maxExtrapolation: ms(tokens.motion.duration.maxExtrapolation),
  bearingDuration: ms(tokens.motion.duration.bearing),
  instant: false,
};

export class RiderMotion {
  private readonly tracks = new Map<number, Track>();
  private readonly offsets: number[] = [];
  private offset = 0;
  private lastAt = -Infinity;

  constructor(private readonly options: MotionOptions = defaultMotion) {}

  get size(): number {
    return this.tracks.size;
  }

  has(id: number): boolean {
    return this.tracks.has(id);
  }

  /**
   * Applies one batch: `serverAt` is its `at` in epoch ms, `receivedAt` the local time it arrived.
   * A rider missing from the batch went offline and is dropped. Older batches are ignored.
   */
  push(serverAt: number, riders: readonly RiderPoint[], receivedAt: number): void {
    if (serverAt <= this.lastAt) return;
    this.lastAt = serverAt;
    this.offsets.push(receivedAt - serverAt);
    if (this.offsets.length > OFFSET_WINDOW) this.offsets.shift();
    this.offset = Math.min(...this.offsets);
    const t = serverAt + this.offset;

    const seen = new Set<number>();
    for (const [id, lat, lng, bearing, status] of riders) {
      seen.add(id);
      const sample: Sample = { t, lat, lng, bearing, status };
      const track = this.tracks.get(id);
      if (!track) {
        this.tracks.set(id, {
          samples: [sample],
          bearingFrom: bearing,
          bearingTo: bearing,
          bearingStart: -Infinity,
          shownBearing: bearing,
        });
        continue;
      }
      track.samples.push(sample);
      if (track.samples.length > KEEP_SAMPLES) track.samples.shift();
    }
    for (const id of this.tracks.keys()) {
      if (!seen.has(id)) this.tracks.delete(id);
    }
  }

  /** Forgets everything, e.g. before a fresh snapshot. */
  clear(): void {
    this.tracks.clear();
    this.offsets.length = 0;
    this.lastAt = -Infinity;
  }

  /** Every rider where they should be drawn at local time `now`. */
  sample(now: number): RiderFrame[] {
    const frames: RiderFrame[] = [];
    for (const [id, track] of this.tracks) frames.push(this.frame(id, track, now));
    return frames;
  }

  /** One rider at local time `now`, or null when they aren't on the map. */
  sampleOne(id: number, now: number): RiderFrame | null {
    const track = this.tracks.get(id);
    return track ? this.frame(id, track, now) : null;
  }

  private frame(id: number, track: Track, now: number): RiderFrame {
    const { samples } = track;
    const last = samples[samples.length - 1]!;
    if (this.options.instant) {
      track.shownBearing = last.bearing;
      return { id, lat: last.lat, lng: last.lng, bearing: last.bearing, status: last.status };
    }

    const at = now - this.options.renderDelay;
    let lat: number;
    let lng: number;
    let heading: Sample;
    let status: RiderStatus;
    if (samples.length === 1 || at <= samples[0]!.t) {
      // A rider who just appeared: hold where we first saw them.
      ({ lat, lng } = samples[0]!);
      heading = samples[0]!;
      status = samples[0]!.status;
    } else if (at >= last.t) {
      // The next update is late: carry on for at most maxExtrapolation, then hold.
      const prev = samples[samples.length - 2]!;
      const span = last.t - prev.t;
      const ahead = Math.min(at - last.t, this.options.maxExtrapolation);
      const k = span > 0 ? ahead / span : 0;
      lat = last.lat + (last.lat - prev.lat) * k;
      lng = last.lng + (last.lng - prev.lng) * k;
      heading = last;
      status = last.status;
    } else {
      let i = 0;
      while (samples[i + 1]!.t <= at) i++;
      const from = samples[i]!;
      const to = samples[i + 1]!;
      const k = (at - from.t) / (to.t - from.t);
      lat = from.lat + (to.lat - from.lat) * k;
      lng = from.lng + (to.lng - from.lng) * k;
      heading = to;
      status = from.status;
    }
    return { id, lat, lng, bearing: this.bearing(track, heading.bearing, now), status };
  }

  /** Eases the shown bearing towards `target` over `bearingDuration`, the short way round. */
  private bearing(track: Track, target: number, now: number): number {
    if (target !== track.bearingTo) {
      track.bearingFrom = track.shownBearing;
      track.bearingTo = target;
      track.bearingStart = now;
    }
    const k = Math.min(1, (now - track.bearingStart) / this.options.bearingDuration);
    const delta = ((((track.bearingTo - track.bearingFrom) % 360) + 540) % 360) - 180;
    const eased = 1 - (1 - k) ** 3;
    track.shownBearing = (((track.bearingFrom + delta * eased) % 360) + 360) % 360;
    return track.shownBearing;
  }
}
