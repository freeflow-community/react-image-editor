import { describe, expect, it } from 'vitest';

import { outputSizeOf, toSceneLength, toScenePoint, toSceneRect, type OutputSpace } from './output-space';

// A 4000×3000 photo drawn 800×600 at (100, 50): five output pixels per scene unit.
const space: OutputSpace = { rect: { left: 100, top: 50, width: 800, height: 600 }, multiplier: 5 };

describe('output space', () => {
  it('sizes the picture in whole pixels', () => {
    expect(outputSizeOf(space)).toEqual({ width: 4000, height: 3000 });
    expect(outputSizeOf({ rect: { left: 0, top: 0, width: 0.01, height: 0.01 }, multiplier: 1 })).toEqual({
      width: 1,
      height: 1,
    });
  });

  it('maps points and lengths into the scene', () => {
    expect(toScenePoint(space, 0, 0)).toEqual({ x: 100, y: 50 });
    expect(toScenePoint(space, 2000, 1500)).toEqual({ x: 500, y: 350 });
    expect(toSceneLength(space, 40)).toBe(8);
  });

  it('maps a rectangle into the scene', () => {
    expect(toSceneRect(space, { x: 1000, y: 500, width: 2000, height: 1000 })).toEqual({
      left: 300,
      top: 150,
      width: 400,
      height: 200,
    });
  });

  it('clips a rectangle to the picture', () => {
    expect(toSceneRect(space, { x: -500, y: 2500, width: 1000, height: 5000 })).toEqual({
      left: 100,
      top: 550,
      width: 100,
      height: 100,
    });
  });

  it('accepts a rectangle given from its opposite corner', () => {
    expect(toSceneRect(space, { x: 3000, y: 1500, width: -2000, height: -1000 })).toEqual(
      toSceneRect(space, { x: 1000, y: 500, width: 2000, height: 1000 }),
    );
  });

  it('refuses a rectangle with nothing inside the picture', () => {
    expect(toSceneRect(space, { x: 4500, y: 0, width: 100, height: 100 })).toBeNull();
    expect(toSceneRect(space, { x: 10, y: 10, width: 0, height: 50 })).toBeNull();
    expect(toSceneRect(space, { x: Number.NaN, y: 0, width: 10, height: 10 })).toBeNull();
  });

  it('treats a broken multiplier as one', () => {
    expect(toSceneLength({ ...space, multiplier: 0 }, 7)).toBe(7);
  });
});
