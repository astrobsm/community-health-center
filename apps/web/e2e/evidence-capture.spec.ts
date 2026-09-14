import { expect, test, type Page } from '@playwright/test';

/**
 * Evidence capture, end to end (spec §62, doc 09 §5).
 *
 * The chain this proves:
 *   photograph captured -> compressed to WebP -> stored on device
 *   -> evidence registered -> bytes uploaded to object storage
 *   -> server HEADs the object and matches the declared size
 *
 * It runs against a REAL MinIO, because every interesting failure lives in the
 * upload path — an expired pre-signed URL, an unsupported encryption header, a
 * truncated body — and none of them are visible against a stub.
 *
 * A NOTE ON THE ASSERTION. An earlier version of this suite checked only that
 * the sync strip fell quiet, and it passed green while ZERO objects reached
 * storage. The strip is a summary; it is not evidence. Every test here now
 * asserts the media reaches `UPLOADED`, which the client sets only after the
 * server confirms the object exists and its size matches.
 */

const PM_EMAIL = process.env['PM_EMAIL'] ?? 'pm@example.org';
const PM_PASSWORD = process.env['PM_PASSWORD'] ?? 'correct-horse-battery-staple';

/** A real PNG, built in the browser, so the compression path runs for real. */
async function makePhotograph(page: Page, width = 2400, height = 1600): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w as number;
      canvas.height = h as number;
      const context = canvas.getContext('2d')!;

      // Gradient plus shapes, so it compresses like a photograph rather than
      // like a flat colour — which makes the size assertions mean something.
      const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, '#8b5a2b');
      gradient.addColorStop(1, '#cbd5e1');
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < 400; i += 1) {
        context.fillStyle = `hsl(${(i * 37) % 360} 60% ${30 + (i % 40)}%)`;
        context.fillRect((i * 97) % canvas.width, (i * 53) % canvas.height, 40, 25);
      }

      return canvas.toDataURL('image/png');
    },
    [width, height],
  );

  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

/**
 * The media records held on the device.
 *
 * `UPLOADED` is server-verified: the client sets it only after
 * `POST /evidence/:id/confirm-upload` returns 200, and that endpoint HEADs the
 * object in storage and compares its size to what was declared. A truncated or
 * absent upload cannot reach this state.
 */
async function readMedia(page: Page): Promise<Array<{ status: string; lastError?: string }>> {
  return page.evaluate(async () => {
    const request = indexedDB.open('chc-offline');
    const database: IDBDatabase = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return new Promise((resolve) => {
      const all = database.transaction('media').objectStore('media').getAll();
      all.onsuccess = () =>
        resolve(
          (all.result as Array<{ status: string; lastError?: string }>).map((row) => ({
            status: row.status,
            lastError: row.lastError,
          })),
        );
      all.onerror = () => resolve([]);
    });
  });
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(PM_EMAIL);
  await page.getByLabel('Password').fill(PM_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Facilities' })).toBeVisible();
}

async function openAssessment(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Start assessment' }).first().click();
  await expect(page.getByRole('navigation', { name: 'Assessment sections' })).toBeVisible();
}

test.describe('evidence capture', () => {
  test('a photograph is compressed, then actually reaches object storage', async ({ page }) => {
    await signIn(page);
    await openAssessment(page);

    const photograph = await makePhotograph(page);

    await page.getByRole('button', { name: 'Attach evidence' }).first().click();
    const dialog = page.getByRole('dialog');

    await dialog.getByLabel('Photograph', { exact: true }).setInputFiles({
      name: 'field.png',
      mimeType: 'image/png',
      buffer: photograph,
    });
    await expect(dialog.getByAltText('The photograph just captured')).toBeVisible({ timeout: 15_000 });

    // A 2400x1600 source comes back bounded to 1920 on the long edge and
    // re-encoded — which is also what strips the EXIF a phone embeds silently.
    const summary = await dialog.getByText(/·\s*\d+(\.\d+)?\s*(kB|MB|B)/).first().innerText();
    expect(summary).toMatch(/1920×1280/);
    expect(summary).toMatch(/reduced from/);

    await dialog.getByLabel('What does this show?').fill('Water ingress above the labour room door');
    await dialog.getByRole('button', { name: 'Attach', exact: true }).click();

    // The item stops owing evidence immediately, not at the next sync.
    await expect(page.getByRole('button', { name: '1 attached' }).first()).toBeVisible({
      timeout: 15_000,
    });

    // The assertion that matters: the server confirmed the bytes.
    await expect
      .poll(async () => (await readMedia(page))[0]?.status, {
        timeout: 60_000,
        message: 'the photograph must reach UPLOADED, which requires the server to HEAD the object',
      })
      .toBe('UPLOADED');
  });

  test('location is attached only when the assessor asks for it', async ({ page }) => {
    await signIn(page);
    await openAssessment(page);

    await page.getByRole('button', { name: 'Attach evidence' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Attach evidence' })).toBeVisible();

    // Opt-in, unticked by default. A phone embeds GPS in EXIF silently; this
    // app re-encodes that away and records coordinates only on request.
    await expect(dialog.getByRole('checkbox', { name: /Attach this location/i })).not.toBeChecked();
  });

  test('a photograph captured offline uploads when signal returns', async ({ page, context }) => {
    await signIn(page);
    await openAssessment(page);

    const photograph = await makePhotograph(page, 1200, 900);

    await context.setOffline(true);
    await page.waitForFunction(() => !navigator.onLine);

    await page.getByRole('button', { name: 'Attach evidence' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Photograph', { exact: true }).setInputFiles({
      name: 'offline.png',
      mimeType: 'image/png',
      buffer: photograph,
    });
    await expect(dialog.getByAltText('The photograph just captured')).toBeVisible({ timeout: 15_000 });
    await dialog.getByLabel('What does this show?').fill('Captured with no signal');
    await dialog.getByRole('button', { name: 'Attach', exact: true }).click();

    // Held on the device, and the strip says so.
    await expect(page.getByRole('status')).toContainText(/offline/i);
    await expect.poll(async () => (await readMedia(page))[0]?.status).toBe('PENDING_UPLOAD');

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    // Metadata and bytes both drain, with no user action.
    await expect
      .poll(async () => (await readMedia(page))[0]?.status, { timeout: 90_000 })
      .toBe('UPLOADED');
  });
});
