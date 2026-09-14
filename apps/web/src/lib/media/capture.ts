import { hashBlob } from '../offline/crypto';

/**
 * Photograph capture and compression (doc 09 §5, spec §62).
 *
 * A single field assessment can produce 200+ images. Uploading them at phone
 * resolution over 3G would take hours and exhaust both the device's storage and
 * the assessor's data allowance — so every image is re-encoded before it is
 * ever stored.
 *
 * Re-encoding also strips EXIF as a side effect, which is the point: a raw
 * phone photograph carries GPS coordinates, the device serial, and sometimes
 * the owner's name. Location is valuable evidence, but it must be attached
 * DELIBERATELY and with consent, as a separate field — not smuggled in
 * metadata nobody knew was there.
 */

export interface CaptureOptions {
  /** Longest edge, in pixels. 1920 is legible for condition evidence. */
  maxEdge?: number;
  /** WebP quality. 0.75 keeps damage and text readable at roughly 150-400 kB. */
  quality?: number;
}

export interface CapturedImage {
  blob: Blob;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  contentHash: string;
  /** For the preview thumbnail. The caller must revoke it. */
  previewUrl: string;
  originalSizeBytes: number;
}

const DEFAULTS: Required<CaptureOptions> = { maxEdge: 1920, quality: 0.75 };

export class UnsupportedImageError extends Error {
  constructor(type: string) {
    super(`"${type}" is not an image this app can process. Take a photograph, or attach a PDF instead.`);
    this.name = 'UnsupportedImageError';
  }
}

/**
 * Re-encode a captured file to WebP at a bounded size.
 *
 * Uses `createImageBitmap` where available: it decodes off the main thread, so
 * a mid-range phone does not freeze for a second per photograph while an
 * assessor is working through a section.
 */
export async function processImage(file: File, options: CaptureOptions = {}): Promise<CapturedImage> {
  const { maxEdge, quality } = { ...DEFAULTS, ...options };

  if (!file.type.startsWith('image/')) {
    throw new UnsupportedImageError(file.type || 'unknown');
  }

  const bitmap = await decode(file);

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = createCanvas(width, height);
    // The union of OffscreenCanvas and HTMLCanvasElement widens getContext's
    // return type to include contexts that cannot draw; narrowing it here keeps
    // the call sites honest without an `any`.
    const context = canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!context) throw new Error('This browser cannot process images.');

    // Better downscaling quality, which matters when the evidence is a crack in
    // a wall or a number on a register page.
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, width, height);

    const blob = await toBlob(canvas, quality);

    return {
      blob,
      contentType: blob.type,
      sizeBytes: blob.size,
      width,
      height,
      contentHash: await hashBlob(blob),
      previewUrl: URL.createObjectURL(blob),
      originalSizeBytes: file.size,
    };
  } finally {
    if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Some Android browsers fail on particular JPEGs; fall through.
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new UnsupportedImageError(file.type));
    };
    image.src = url;
  });
}

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function toBlob(canvas: OffscreenCanvas | HTMLCanvasElement, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/webp', quality });
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        // Safari historically produced null for WebP. JPEG is a smaller loss
        // than refusing to record the evidence at all.
        if (blob) resolve(blob);
        else
          canvas.toBlob(
            (fallback) =>
              fallback ? resolve(fallback) : reject(new Error('This browser could not encode the image.')),
            'image/jpeg',
            quality,
          );
      },
      'image/webp',
      quality,
    );
  });
}

/**
 * Read the device position, with an explicit timeout.
 *
 * Called ONLY when the assessor has ticked the consent box. A GPS fix indoors
 * can take 30 seconds or never arrive, so this resolves to null rather than
 * blocking the capture flow — evidence without coordinates is still evidence.
 */
export async function readPosition(timeoutMs = 10_000): Promise<{ latitude: number; longitude: number } | null> {
  if (!navigator.geolocation) return null;

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
