import { distance, lineLength, splitRoute, type LngLat } from './route-geometry';

describe('route geometry', () => {
  const khanMarket: LngLat = [77.227, 28.6003];
  const lajpatNagar: LngLat = [77.2436, 28.5679];

  it('measures straight lines in metres', () => {
    // About 3.9 km from Khan Market to Lajpat Nagar.
    expect(distance(khanMarket, lajpatNagar)).toBeGreaterThan(3_800);
    expect(distance(khanMarket, lajpatNagar)).toBeLessThan(4_000);
    expect(distance(khanMarket, khanMarket)).toBe(0);
  });

  it('splits a route at the rider, both parts meeting at the marker', () => {
    const route: LngLat[] = [
      [77.2, 28.6],
      [77.21, 28.6],
      [77.22, 28.6],
      [77.23, 28.6],
    ];
    const rider: LngLat = [77.215, 28.6001];

    const [travelled, remaining] = splitRoute(route, rider);

    expect(travelled).toEqual([[77.2, 28.6], [77.21, 28.6], rider]);
    expect(remaining).toEqual([rider, [77.22, 28.6], [77.23, 28.6]]);
  });

  it('starts at the rider when there is no route yet', () => {
    expect(splitRoute([], khanMarket)).toEqual([[], [khanMarket]]);
  });

  it('adds up a line', () => {
    expect(lineLength([khanMarket, lajpatNagar, khanMarket])).toBeCloseTo(
      2 * distance(khanMarket, lajpatNagar),
      6,
    );
  });
});
