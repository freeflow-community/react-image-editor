import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  ImageEditor,
  aspectOption,
  openImageEditorDialog,
  type AspEditorError,
  type AspEditorHandle,
  type AspExportFormat,
  type AspExportTarget,
  type AspMode,
} from '@ascentsparksoftware/react-image-editor';

const MODES: readonly AspMode[] = ['viewer', 'basic', 'advanced', 'full'];
const ALL_FORMATS: readonly AspExportFormat[] = ['png', 'jpeg', 'webp', 'svg', 'json', 'pdf'];

/**
 * Build a deterministic test image: white with a black grid and a diagonal.
 * Gridlines are 1 source pixel wide, so an export that truly carries source
 * pixels stays high-contrast while an upscaled one visibly blurs — which is
 * what {@link measureSharpness} measures.
 */
function gridImageDataUrl(size: number, height = size): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2d context unavailable');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, height);
  ctx.fillStyle = '#000000';
  const step = Math.max(4, Math.round(size / 24));
  for (let x = 0; x < size; x += step) {
    ctx.fillRect(x, 0, 1, height);
  }
  for (let y = 0; y < height; y += step) {
    ctx.fillRect(0, y, size, 1);
  }
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(size, height);
  ctx.stroke();
  return canvas.toDataURL('image/png');
}

/**
 * Mean absolute horizontal luminance gradient across the bitmap, 0–255. A
 * bitmap that still holds 1px gridlines scores far higher than the same image
 * upscaled from a screen-sized raster, so the tests can tell real source pixels
 * from a blur.
 */
function measureSharpness(image: ImageBitmap): number {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return 0;
  }
  ctx.drawImage(image, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, image.width, image.height);
  let total = 0;
  let samples = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const p = (y * width + x) * 4;
      total += Math.abs(data[p] - data[p - 4]);
      samples += 1;
    }
  }
  return samples === 0 ? 0 : total / samples;
}

/** Parse a `1000x1000` query param into an export target. */
function parseTarget(raw: string | null): AspExportTarget | null {
  const m = /^(\d+)x(\d+)$/i.exec(raw ?? '');
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/** Decode a blob to its pixel size and sharpness score (PDFs report page size). */
async function describeBlob(blob: Blob): Promise<{ size: string; sharpness: string }> {
  if (blob.type === 'application/pdf') {
    // The page is sized from the engine's reported output size, so the MediaBox
    // is how a host would see that number.
    const box = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(await blob.text());
    return {
      size: box ? `${Math.round(Number(box[1]))}x${Math.round(Number(box[2]))}` : 'no-mediabox',
      sharpness: 'n/a',
    };
  }
  if (!blob.type.startsWith('image/') || blob.type === 'image/svg+xml') {
    return { size: 'n/a', sharpness: 'n/a' };
  }
  try {
    const bitmap = await createImageBitmap(blob);
    const result = {
      size: `${bitmap.width}x${bitmap.height}`,
      sharpness: measureSharpness(bitmap).toFixed(2),
    };
    bitmap.close();
    return result;
  } catch {
    return { size: 'decode-failed', sharpness: 'decode-failed' };
  }
}

/**
 * Hidden deterministic surface for the Playwright suite (not in the nav).
 * `/e2e?mode=advanced&theme=dark&aspect=1:1` renders one editor full-width with
 * the requested mode/theme, plus instrumentation readouts the tests assert on.
 */
export default function E2eHarness(): ReactElement {
  const [params] = useSearchParams();
  const modeParam = params.get('mode');
  const mode: AspMode = MODES.includes(modeParam as AspMode) ? (modeParam as AspMode) : 'advanced';
  const themeMode = params.get('theme') === 'dark' ? 'dark' : 'light';
  const initialAspect = params.get('aspect') === '1:1' ? '1:1' : null;
  const shellWidth = Number(params.get('shell')) > 0 ? Number(params.get('shell')) : undefined;
  const exportTarget = parseTarget(params.get('target'));
  const chip = parseTarget(params.get('chip'));
  const aspectRatios = useMemo(
    () => (chip ? [aspectOption(chip.width, chip.height)] : []),
    [chip?.width, chip?.height], // eslint-disable-line react-hooks/exhaustive-deps -- keyed by value
  );
  // `source=2400` generates a 2400x2400 grid image; without it the demo's own
  // sample auto-loads, which is what the pre-existing suite expects.
  // `source=1600x1200` generates a grid image that is not square.
  const sourceParam = params.get('source') ?? '';
  const src = useMemo(() => {
    const box = parseTarget(sourceParam);
    if (box) {
      return gridImageDataUrl(box.width, box.height);
    }
    const size = Number(sourceParam);
    return Number.isFinite(size) && size > 0 ? gridImageDataUrl(size) : null;
  }, [sourceParam]);
  // `bounds=image` exports the picture itself rather than the editing surface,
  // and the engine handle is published for the programmatic-API tests.
  const exportBounds = params.get('bounds') === 'image' ? 'image' : 'canvas';
  const onReady = useCallback((handle: AspEditorHandle) => {
    (window as unknown as { __aspHandle?: AspEditorHandle }).__aspHandle = handle;
  }, []);
  // `format=jpeg` puts that format first, which is what basic-mode Save uses.
  const formatParam = params.get('format') as AspExportFormat | null;
  const exportFormats = useMemo<readonly AspExportFormat[]>(
    () =>
      formatParam && ALL_FORMATS.includes(formatParam)
        ? [formatParam, ...ALL_FORMATS.filter((f) => f !== formatParam)]
        : ALL_FORMATS,
    [formatParam],
  );

  const [loaded, setLoaded] = useState(0);
  const [savedBytes, setSavedBytes] = useState<number | null>(null);
  const [savedType, setSavedType] = useState('');
  const [exportedBytes, setExportedBytes] = useState<number | null>(null);
  const [canceled, setCanceled] = useState(0);
  const [lastError, setLastError] = useState('');
  const [dialogResult, setDialogResult] = useState('');
  const [savedSize, setSavedSize] = useState('-');
  const [savedSharpness, setSavedSharpness] = useState('-');
  const [exportedSize, setExportedSize] = useState('-');
  const [exportedSharpness, setExportedSharpness] = useState('-');

  const onSaved = useCallback((blob: Blob) => {
    setSavedBytes(blob.size);
    setSavedType(blob.type);
    void describeBlob(blob).then(({ size, sharpness }) => {
      setSavedSize(size);
      setSavedSharpness(sharpness);
    });
  }, []);
  const onExported = useCallback((blob: Blob) => {
    setExportedBytes(blob.size);
    void describeBlob(blob).then(({ size, sharpness }) => {
      setExportedSize(size);
      setExportedSharpness(sharpness);
    });
  }, []);
  const onImageLoaded = useCallback(() => setLoaded((n) => n + 1), []);
  const onCanceled = useCallback(() => setCanceled((n) => n + 1), []);
  const onError = useCallback((e: AspEditorError) => setLastError(e.code), []);

  const openDialog = async (): Promise<void> => {
    const blob = await openImageEditorDialog({
      heading: 'Update profile photo',
      aspectPresets: ['1:1', '4:3', 'free'],
      initialAspect: '1:1',
      themeMode,
    });
    setDialogResult(blob ? `blob:${blob.size}` : 'null');
  };

  return (
    // Full-bleed overlay: escapes the docs shell's max-width/sidebar so the
    // editor gets a realistic desktop width (no wrapped topbar) for the tests.
    <div
      data-testid="e2e-harness"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        overflow: 'auto',
        padding: 16,
        background: themeMode === 'dark' ? '#0e1116' : '#f6f7f9',
      }}
    >
      <div style={{ height: 640, width: shellWidth, maxWidth: '100%' }}>
        <ImageEditor
          src={src}
          mode={mode}
          themeMode={themeMode}
          baseColor={themeMode === 'dark' ? '#10151d' : '#f4f6f9'}
          accentColor="#1f6feb"
          initialAspect={initialAspect}
          aspectRatios={aspectRatios}
          exportTarget={exportTarget}
          exportBounds={exportBounds}
          onReady={onReady}
          exportFormats={exportFormats}
          onSaved={onSaved}
          onExported={onExported}
          onImageLoaded={onImageLoaded}
          onCanceled={onCanceled}
          onError={onError}
        />
      </div>
      <dl style={{ fontFamily: 'monospace', fontSize: 12 }}>
        <dt>loaded</dt>
        <dd data-testid="stat-loaded">{loaded}</dd>
        <dt>saved</dt>
        <dd data-testid="stat-saved">{savedBytes === null ? '-' : `${savedType}:${savedBytes}`}</dd>
        <dt>saved-size</dt>
        <dd data-testid="stat-saved-size">{savedSize}</dd>
        <dt>saved-sharpness</dt>
        <dd data-testid="stat-saved-sharpness">{savedSharpness}</dd>
        <dt>exported</dt>
        <dd data-testid="stat-exported">{exportedBytes ?? '-'}</dd>
        <dt>exported-size</dt>
        <dd data-testid="stat-exported-size">{exportedSize}</dd>
        <dt>exported-sharpness</dt>
        <dd data-testid="stat-exported-sharpness">{exportedSharpness}</dd>
        <dt>canceled</dt>
        <dd data-testid="stat-canceled">{canceled}</dd>
        <dt>error</dt>
        <dd data-testid="stat-error">{lastError || '-'}</dd>
        <dt>dialog</dt>
        <dd data-testid="stat-dialog">{dialogResult || '-'}</dd>
      </dl>
      <button type="button" data-testid="open-dialog" onClick={() => void openDialog()}>
        Open editor dialog
      </button>
    </div>
  );
}
