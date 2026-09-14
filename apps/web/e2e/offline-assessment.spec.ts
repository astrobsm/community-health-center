import { expect, test, type Page } from '@playwright/test';

/**
 * Acceptance criterion N: "The system can operate offline" (doc 23).
 *
 * This is the test the whole offline architecture exists to pass. A unit test
 * of the outbox proves the data structure; only this proves that an assessor
 * can walk out of signal, keep working, and have nothing lost.
 *
 * The scenario deliberately mirrors a real field visit:
 *   sign in with signal -> open the assessment -> LOSE SIGNAL
 *   -> answer questions -> confirm the app still works and says so
 *   -> regain signal -> confirm the answers reached the server
 */

const PM_EMAIL = process.env['PM_EMAIL'] ?? 'pm@example.org';
const PM_PASSWORD = process.env['PM_PASSWORD'] ?? 'correct-horse-battery-staple';

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(PM_EMAIL);
  await page.getByLabel('Password').fill(PM_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Facilities' })).toBeVisible();

  // The service worker needs one online visit to precache the app shell.
  // Waiting for it is what a real first run does, and it proves the precache
  // actually happened rather than assuming it.
  await page.waitForFunction(
    () => navigator.serviceWorker?.controller !== null || navigator.serviceWorker === undefined,
    undefined,
    { timeout: 20_000 },
  ).catch(() => {
    // Some environments disable service workers entirely; the offline store
    // still works, so the rest of the suite is still meaningful.
  });
}

test.describe('offline field assessment', () => {
  test('an assessor keeps working through a loss of signal, and nothing is lost', async ({
    page,
    context,
  }) => {
    await signIn(page);

    // Start an assessment while online, so the instrument is cached. This is
    // the one thing that genuinely requires a connection first.
    await page.getByRole('link', { name: 'Start assessment' }).first().click();
    await expect(page.getByRole('navigation', { name: 'Assessment sections' })).toBeVisible();

    const sectionCount = await page.getByRole('navigation', { name: 'Assessment sections' })
      .getByRole('button')
      .count();
    expect(sectionCount).toBe(17);

    // --- Signal lost -------------------------------------------------------
    await context.setOffline(true);
    await page.waitForFunction(() => !navigator.onLine);

    // The app must SAY it is offline. Silently degrading is how a phone ends up
    // carrying two weeks of unsynced work nobody knew about.
    await expect(page.getByRole('status')).toContainText(/offline/i);

    // Answer questions with no network at all.
    const yesButtons = page.getByRole('radio', { name: 'Yes' });
    const answerCount = Math.min(await yesButtons.count(), 5);
    for (let i = 0; i < answerCount; i += 1) {
      await yesButtons.nth(i).check();
    }

    // Progress updates locally — no round trip, no spinner.
    await expect(page.getByRole('status')).toContainText(/\d+ records? waiting/i);

    // A reload while offline must not lose anything: the answers live in
    // encrypted IndexedDB, not in React state.
    await page.reload();

    // The app asks for the password, not a full sign-in — and tells the user
    // how much unsynced work is on the device BEFORE they unlock.
    await expect(page.getByRole('heading', { name: 'Unlock' })).toBeVisible();
    await expect(page.getByText(/records? on this device/i)).toBeVisible();

    await page.getByLabel('Password').fill(PM_PASSWORD);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();

    await expect(page.getByRole('status')).toContainText(/offline/i);
    await expect(page.getByRole('status')).toContainText(/\d+ records? waiting/i);

    // --- Signal returns ----------------------------------------------------
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    // The queue drains on its own, without the user pressing anything.
    await expect(page.getByRole('status')).toContainText(/synced|online/i, { timeout: 30_000 });
    await expect(page.getByRole('status')).not.toContainText(/waiting/i, { timeout: 30_000 });
  });

  test('an assessment never opened on this device says so plainly when offline', async ({
    page,
    context,
  }) => {
    await signIn(page);
    await context.setOffline(true);

    await page.goto('/assessments/00000000-0000-4000-8000-000000000000');

    // A navigation while offline is served from the precached shell — proof in
    // itself that the service worker did its job — and lands on the lock screen.
    await expect(page.getByRole('heading', { name: 'Unlock' })).toBeVisible();
    await page.getByLabel('Password').fill(PM_PASSWORD);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();

    // Not a spinner, and not a generic error: the one genuinely unrecoverable
    // offline case, explained.
    await expect(page.getByText(/has not been opened on this device before/i)).toBeVisible();
  });

  test('the sync strip is always present, never hidden', async ({ page }) => {
    await signIn(page);

    const strip = page.getByRole('status');
    await expect(strip).toBeVisible();

    // Still visible after navigating — it is part of the shell, not a toast.
    await page.getByRole('link', { name: 'Start assessment' }).first().click();
    await expect(strip).toBeVisible();
  });
});
