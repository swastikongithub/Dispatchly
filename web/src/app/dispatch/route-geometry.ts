/** `[lng, lat]`, as GeoJSON and MapLibre take them. */
export type LngLat = [number, number];

export interface Position {
  lat: number;
  lng: number;
}

export const lngLat = (p: Position): LngLat => [p.lng, p.lat];

const EARTH_RADIUS_M = 6_371_000;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in metres, as the server measures straight lines. */
export function distance(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Splits a route where a rider on it is: `[travelled, remaining]`, both passing through `at`, so
 * the travelled part ends and the remaining part starts at the marker. Over a few kilometres a
 * flat projection is plenty to find the nearest segment.
 */
export function splitRoute(route: readonly LngLat[], at: LngLat): [LngLat[], LngLat[]] {
  if (route.length < 2) return [[], [at, ...route]];
  const k = Math.cos(rad(at[1]));
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, ay] = [route[i]![0] * k, route[i]![1]];
    const [bx, by] = [route[i + 1]![0] * k, route[i + 1]![1]];
    const [px, py] = [at[0] * k, at[1]];
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t = length > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
    const d = (ax + t * dx - px) ** 2 + (ay + t * dy - py) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return [
    [...route.slice(0, best + 1), at],
    [at, ...route.slice(best + 1)],
  ];
}

/** The length of a line in metres. */
export function lineLength(line: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += distance(line[i - 1]!, line[i]!);
  return total;
}
