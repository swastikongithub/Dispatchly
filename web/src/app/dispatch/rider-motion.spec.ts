import { RiderMotion, type MotionOptions, type RiderPoint } from './rider-motion';

const options: MotionOptions = {
  renderDelay: 2000,
  maxExtrapolation: 1000,
  bearingDuration: 300,
  instant: false,
};

const at = (ms: number) => Date.parse('2026-11-27T14:30:00Z') + ms;

describe('RiderMotion', () => {
  /** Batches every 2 s that arrive 100 ms after they were built. */
  function city(batches: RiderPoint[][], motion = new RiderMotion(options)) {
    batches.forEach((riders, i) => motion.push(at(i * 2000), riders, 100 + i * 2000));
    return motion;
  }

  it('renders 2 s behind, interpolating between the last two positions', () => {
    const motion = city([[[1, 28.6, 77.2, 90, 'Delivering']], [[1, 28.6, 77.3, 90, 'Delivering']]]);

    // Local time of the first sample is 100; we see it 2 s later, and the second 2 s after that.
    expect(motion.sampleOne(1, 2100)).toMatchObject({ lat: 28.6, lng: 77.2 });
    expect(motion.sampleOne(1, 3100)!.lng).toBeCloseTo(77.25, 6);
    expect(motion.sampleOne(1, 4100)!.lng).toBeCloseTo(77.3, 6);
  });

  it('holds a rider it has seen once where it first saw them', () => {
    const motion = city([[[1, 28.6, 77.2, 0, 'Available']]]);
    expect(motion.sampleOne(1, 500)).toMatchObject({ lat: 28.6, lng: 77.2, status: 'Available' });
    expect(motion.sampleOne(1, 9000)).toMatchObject({ lat: 28.6, lng: 77.2 });
  });

  it('extrapolates a late update for at most 1 s, then holds', () => {
    const motion = city([[[1, 28.6, 77.2, 90, 'Delivering']], [[1, 28.6, 77.3, 90, 'Delivering']]]);

    // The third batch is late: half a second past the last sample, half a step further.
    expect(motion.sampleOne(1, 4600)!.lng).toBeCloseTo(77.325, 6);
    expect(motion.sampleOne(1, 5100)!.lng).toBeCloseTo(77.35, 6);
    expect(motion.sampleOne(1, 8000)!.lng).toBeCloseTo(77.35, 6);
  });

  it('drops a rider missing from a batch and ignores batches older than the last', () => {
    const motion = city([
      [
        [1, 28.6, 77.2, 0, 'Available'],
        [2, 28.5, 77.1, 0, 'Available'],
      ],
      [[1, 28.6, 77.2, 0, 'Available']],
    ]);
    expect(motion.has(2)).toBe(false);
    motion.push(at(1000), [[3, 28.6, 77.2, 0, 'Available']], 5000);
    expect(motion.has(3)).toBe(false);
    expect(motion.size).toBe(1);
  });

  it('changes status as the rendered time passes the update that changed it', () => {
    const motion = city([[[1, 28.6, 77.2, 0, 'Assigned']], [[1, 28.6, 77.2, 0, 'Delivering']]]);
    expect(motion.sampleOne(1, 3000)!.status).toBe('Assigned');
    expect(motion.sampleOne(1, 4200)!.status).toBe('Delivering');
  });

  it('eases the bearing the short way round over 300 ms', () => {
    const motion = city([
      [[1, 28.6, 77.2, 350, 'Delivering']],
      [[1, 28.6, 77.2, 350, 'Delivering']],
      [[1, 28.6, 77.2, 10, 'Delivering']],
    ]);
    expect(motion.sampleOne(1, 3000)!.bearing).toBe(350);
    // From 4100 the rendered time heads for the third sample, so the bearing turns to 10° via 0°,
    // starting from the first frame that sees it.
    expect(motion.sampleOne(1, 4150)!.bearing).toBe(350);
    const turning = motion.sampleOne(1, 4300)!.bearing;
    expect(turning > 350 || turning < 10).toBe(true);
    expect(motion.sampleOne(1, 4450)!.bearing).toBeCloseTo(10, 6);
  });

  it('maps server time with the fastest batch, so a slow one does not slow the riders', () => {
    const motion = new RiderMotion(options);
    motion.push(at(0), [[1, 28.6, 77.2, 90, 'Delivering']], 100);
    // Built 2 s later but arrived 900 ms late: its sample still sits 2 s after the first.
    motion.push(at(2000), [[1, 28.6, 77.3, 90, 'Delivering']], 3000);
    expect(motion.sampleOne(1, 3100)!.lng).toBeCloseTo(77.25, 6);
  });

  it('shows the latest position straight away under reduced motion', () => {
    const motion = city(
      [[[1, 28.6, 77.2, 0, 'Available']], [[1, 28.7, 77.3, 45, 'Assigned']]],
      new RiderMotion({ ...options, instant: true }),
    );
    expect(motion.sampleOne(1, 2100)).toEqual({
      id: 1,
      lat: 28.7,
      lng: 77.3,
      bearing: 45,
      status: 'Assigned',
    });
  });
});
