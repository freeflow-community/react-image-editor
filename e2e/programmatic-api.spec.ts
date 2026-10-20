import { expect, test, type Page } from '@playwright/test';

/**
 * The engine's programmatic API (output-pixel coordinates), driven through the
 * handle `<ImageEditor onReady>` gives a host. The `/e2e` harness loads a
 * 1600x1200 grid image with `exportBounds="image"` and publishes the handle on
 * `window.__aspHandle`; each test edits through it and inspects the export.
 */

interface Handle {
  engine: {
    getOutputSize(): { width: number; height: number } | null;
    cropTo(rect: { x: number; y: number; width: number; height: number }): boolean;
    setOutputWidth(width: number | null): { width: number; height: number } | null;
    rotateBy(deg: number): void;
    addShapeAt(kind: string, style: object, geometry: object): string | null;
    addTextBox(text: string, style: object, at: object): string | null;
    addImageAt(src: string | Blob, at: object, opts?: object): Promise<string | null>;
    redactRect(rect: object, mode: string): Promise<boolean>;
    batch<T>(label: string, fn: () => T | Promise<T>): Promise<T>;
    getLayers(): unknown[];
    historyEntries: readonly unknown[];
    undo(): Promise<void>;
  };
  refresh(): void;
  exportBlob(): Promise<Blob>;
}

type Win = Window & { __aspHandle?: Handle };

async function open(page: Page, extra = ''): Promise<void> {
  await page.goto(`/e2e?mode=advanced&source=1600x1200&shell=900&bounds=image${extra}`);
  await expect(page.getByTestId('stat-loaded')).not.toHaveText('0');
  await page.waitForFunction(() => !!(window as Win).__aspHandle);
}

/** Export through the handle; report the size and the colors at some points. */
async function exported(
  page: Page,
  points: readonly (readonly [number, number])[] = [],
): Promise<{ width: number; height: number; colors: string[] }> {
  return page.evaluate(async (pts) => {
    const blob = await (window as Win).__aspHandle!.exportBlob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const colors = pts.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3)).join(','));
    return { width: bitmap.width, height: bitmap.height, colors };
  }, points);
}

test.describe('programmatic editing', () => {
  test('an uncropped picture exports at its own size, not the size of the editor', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => (window as Win).__aspHandle!.engine.getOutputSize())).toEqual({
      width: 1600,
      height: 1200,
    });
    const out = await exported(page);
    expect([out.width, out.height]).toEqual([1600, 1200]);
  });

  test('without exportBounds the export is still the editing surface', async ({ page }) => {
    await page.goto('/e2e?mode=advanced&source=1600x1200&shell=900');
    await expect(page.getByTestId('stat-loaded')).not.toHaveText('0');
    await page.waitForFunction(() => !!(window as Win).__aspHandle);
    const out = await exported(page);
    expect(out.width).toBeLessThan(1000);
  });

  test('cropTo crops to a rectangle given in pixels of the picture', async ({ page }) => {
    await open(page);
    const ok = await page.evaluate(() =>
      (window as Win).__aspHandle!.engine.cropTo({ x: 400, y: 300, width: 800, height: 600 }),
    );
    expect(ok).toBe(true);
    const out = await exported(page);
    expect([out.width, out.height]).toEqual([800, 600]);
    // Coordinates are now those of the cropped picture.
    const again = await page.evaluate(() => {
      const { engine } = (window as Win).__aspHandle!;
      engine.cropTo({ x: 0, y: 0, width: 400, height: 300 });
      return engine.getOutputSize();
    });
    expect(again).toEqual({ width: 400, height: 300 });
  });

  test('cropTo refuses a rectangle outside the picture', async ({ page }) => {
    await open(page);
    const ok = await page.evaluate(() =>
      (window as Win).__aspHandle!.engine.cropTo({ x: 5000, y: 0, width: 100, height: 100 }),
    );
    expect(ok).toBe(false);
    expect((await exported(page)).width).toBe(1600);
  });

  test('a rotated picture exports turned, at full size', async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as Win).__aspHandle!.engine.rotateBy(90));
    const out = await exported(page);
    expect([out.width, out.height]).toEqual([1200, 1600]);
  });

  test('setOutputWidth scales the export down and never up', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => (window as Win).__aspHandle!.engine.setOutputWidth(800))).toEqual({
      width: 800,
      height: 600,
    });
    const out = await exported(page);
    expect([out.width, out.height]).toEqual([800, 600]);
    expect(await page.evaluate(() => (window as Win).__aspHandle!.engine.setOutputWidth(5000))).toEqual({
      width: 1600,
      height: 1200,
    });
  });

  test('addShapeAt draws where it was asked to', async ({ page }) => {
    await open(page);
    const id = await page.evaluate(() =>
      (window as Win).__aspHandle!.engine.addShapeAt(
        'rect',
        { color: '#ff0000', strokeWidth: 4, fill: '#ff0000' },
        { box: { x: 200, y: 100, width: 400, height: 200 } },
      ),
    );
    expect(id).toBeTruthy();
    const out = await exported(page, [
      [400, 200],
      [210, 110],
      [590, 290],
      [150, 200],
      [700, 200],
      [400, 350],
    ]);
    expect(out.colors.slice(0, 3)).toEqual(['255,0,0', '255,0,0', '255,0,0']);
    for (const c of out.colors.slice(3)) {
      expect(c).not.toBe('255,0,0');
    }
  });

  test('an arrow runs between its two points', async ({ page }) => {
    await open(page);
    const id = await page.evaluate(() =>
      (window as Win).__aspHandle!.engine.addShapeAt(
        'arrow',
        { color: '#00ff00', strokeWidth: 12 },
        { from: { x: 200, y: 900 }, to: { x: 1000, y: 900 } },
      ),
    );
    expect(id).toBeTruthy();
    const out = await exported(page, [
      [300, 900],
      [600, 900],
      [990, 900],
      [150, 900],
      [1060, 900],
    ]);
    expect(out.colors.slice(0, 3)).toEqual(['0,255,0', '0,255,0', '0,255,0']);
    expect(out.colors[3]).not.toBe('0,255,0');
    expect(out.colors[4]).not.toBe('0,255,0');
  });

  test('addTextBox puts text at a point, on its background', async ({ page }) => {
    await open(page);
    const id = await page.evaluate(() =>
      (window as Win).__aspHandle!.engine.addTextBox(
        'Hello',
        { color: '#ffffff', fontSize: 80, background: '#0000ff' },
        { x: 800, y: 600, width: 400 },
      ),
    );
    expect(id).toBeTruthy();
    const out = await exported(page, [
      [1190, 610],
      [790, 610],
    ]);
    expect(out.colors[0]).toBe('0,0,255');
    expect(out.colors[1]).not.toBe('0,0,255');
  });

  test('addImageAt puts a picture over the picture as a layer, where and as big as asked', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const { engine } = (window as Win).__aspHandle!;
      // A 40x20 solid magenta picture, drawn 400 pixels wide (so 200 high) at (100, 100).
      const canvas = document.createElement('canvas');
      canvas.width = 40;
      canvas.height = 20;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(0, 0, 40, 20);
      const before = engine.getLayers().length;
      const id = await engine.addImageAt(canvas.toDataURL('image/png'), { x: 100, y: 100, width: 400 });
      return { id, added: engine.getLayers().length - before };
    });
    expect(result.id).toBeTruthy();
    expect(result.added).toBe(1);
    const out = await exported(page, [
      [110, 110],
      [490, 290],
      [510, 200],
      [300, 310],
    ]);
    expect(out.width).toBe(1600);
    expect(out.colors[0]).toBe('255,0,255');
    expect(out.colors[1]).toBe('255,0,255');
    expect(out.colors[2]).not.toBe('255,0,255');
    expect(out.colors[3]).not.toBe('255,0,255');
  });

  test('redactRect conceals a rectangle', async ({ page }) => {
    await open(page);
    const ok = await page.evaluate(() =>
      (window as Win).__aspHandle!.engine.redactRect({ x: 1000, y: 800, width: 300, height: 200 }, 'solid'),
    );
    expect(ok).toBe(true);
    const out = await exported(page, [
      [1150, 900],
      [900, 900],
    ]);
    expect(out.colors[0]).toBe('11,15,26');
    expect(out.colors[1]).not.toBe('11,15,26');
  });

  test('a batch is one history step', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const handle = (window as Win).__aspHandle!;
      const { engine } = handle;
      const before = { steps: engine.historyEntries.length, layers: engine.getLayers().length };
      await engine.batch('Agent edit', async () => {
        engine.addShapeAt('ellipse', { color: '#ff0000', strokeWidth: 4 }, { box: { x: 0, y: 0, width: 200, height: 200 } });
        engine.addTextBox('One', { color: '#000000', fontSize: 40 }, { x: 300, y: 300 });
        await engine.redactRect({ x: 600, y: 600, width: 100, height: 100 }, 'solid');
      });
      handle.refresh();
      const after = { steps: engine.historyEntries.length, layers: engine.getLayers().length };
      await engine.undo();
      return { before, after, undone: engine.getLayers().length };
    });
    expect(result.after.steps).toBe(result.before.steps + 1);
    expect(result.after.layers).toBe(result.before.layers + 3);
    expect(result.undone).toBe(result.before.layers);
  });
});
