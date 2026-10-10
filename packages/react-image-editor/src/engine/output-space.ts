/**
 * Output space: the pixel grid of the picture as it would be exported right now.
 *
 * Pure. Programmatic callers (an AI agent, a script) only ever see the exported
 * picture, so the coordinates they can name are its pixels — not the scene's
 * display-sized units, which depend on how large the host drew the editor. This
 * module converts between the two given the scene rectangle being exported and
 * the render multiplier it is exported at.
 */

import type { FrameRect } from './crop-session';

export interface OutputSpace {
  /** The exported region, in scene coordinates. */
  readonly rect: FrameRect;
  /** Output pixels per scene unit. */
  readonly multiplier: number;
}

/** A rectangle in output pixels, from the top-left corner of the picture. */
export interface OutputRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const scaleOf = (space: OutputSpace): number =>
  Number.isFinite(space.multiplier) && space.multiplier > 0 ? space.multiplier : 1;

/** Whole-pixel size of the picture the space describes (never zero). */
export function outputSizeOf(space: OutputSpace): { width: number; height: number } {
  const m = scaleOf(space);
  return {
    width: Math.max(1, Math.round(space.rect.width * m)),
    height: Math.max(1, Math.round(space.rect.height * m)),
  };
}

/** An output-pixel length (a stroke width, a font size) in scene units. */
export function toSceneLength(space: OutputSpace, length: number): number {
  return length / scaleOf(space);
}

/** An output-pixel point in scene coordinates. */
export function toScenePoint(space: OutputSpace, x: number, y: number): { x: number; y: number } {
  const m = scaleOf(space);
  return { x: space.rect.left + x / m, y: space.rect.top + y / m };
}

/**
 * An output-pixel rectangle in scene coordinates, clipped to the picture. Returns
 * null when nothing of it lies inside (or it has no area), so callers can refuse
 * the request rather than act on an empty region.
 */
export function toSceneRect(space: OutputSpace, rect: OutputRect): FrameRect | null {
  const size = outputSizeOf(space);
  const x0 = Math.max(0, Math.min(rect.x, rect.x + rect.width));
  const y0 = Math.max(0, Math.min(rect.y, rect.y + rect.height));
  const x1 = Math.min(size.width, Math.max(rect.x, rect.x + rect.width));
  const y1 = Math.min(size.height, Math.max(rect.y, rect.y + rect.height));
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 - x0 < 1 || y1 - y0 < 1) {
    return null;
  }
  const m = scaleOf(space);
  return {
    left: space.rect.left + x0 / m,
    top: space.rect.top + y0 / m,
    width: (x1 - x0) / m,
    height: (y1 - y0) / m,
  };
}
