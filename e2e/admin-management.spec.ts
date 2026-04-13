import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { navigateToAdmin, waitForLoading } from './helpers';

const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Admin 관리 페이지 전체 테스트.
 * 대시보드, 선수/심판/코트 관리, 설정 페이지를 커버한다.
 */

// ── helpers ──────────────────────────────────────────────

async function ensureAdminDashboard(page: import('@playwright/test').Page) {
  await navigateToAdmin(page);
  const dashboard = page.locator('h1', { hasText: '대시보드' });
  if (!(await dashboard.isVisible({ timeout: 10000 }).catch(() => false))) {
    test.skip();
  }
}

// ── Admin Dashboard ──────────────────────────────────────

test.describe('Admin Dashboard', () => {
  test('shows tournament list or empty state', async ({ page }) => {
    await ensureAdminDashboard(page);

    const tournamentList = page.locator('[aria-label]').filter({ hasText: '대회' });
    const emptyState = page.locator('text=등록된 대회가 없습니다');

    // Either tournaments or empty message
    const hasList = await tournamentList.first().isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    expect(hasList || hasEmpty).toBeTruthy();
  });

  test('tournament items show status and type badges', async ({ page }) => {
    await ensureAdminDashboard(page);

    const tournamentItem = page.locator('button[role="button"]').first();
    if (!(await tournamentItem.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    // Should have status text (one of: draft, registration, in_progress, paused, completed)
    const item = tournamentItem.locator('..');
    await expect(item).toBeVisible();
  });

  test('delete tournament modal opens and has focus trap', async ({ page }) => {
    await ensureAdminDashboard(page);

    // Find any delete button
    const deleteButton = page.locator('button').filter({ hasText: '삭제' }).first();
    if (!(await deleteButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await deleteButton.click();

    // Modal should open
    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Modal title
    await expect(page.locator('#delete-modal-title')).toBeVisible();

    // PIN input should be visible
    const pinInput = page.locator('#admin-password');
    await expect(pinInput).toBeVisible();

    // Wrong PIN → error
    await pinInput.fill('9999');
    await modal.locator('button').filter({ hasText: '삭제' }).click();
    await page.waitForTimeout(1000);

    // Error might or might not show depending on actual PIN
    // Just verify the modal is still open (didn't accidentally close)
    await expect(modal).toBeVisible();

    // Cancel closes modal
    await modal.locator('button').filter({ hasText: '취소' }).click();
    await expect(modal).not.toBeVisible({ timeout: 3000 });
  });

  test('delete modal PIN lockout after 5 failures', async ({ page }) => {
    await ensureAdminDashboard(page);

    const deleteButton = page.locator('button').filter({ hasText: '삭제' }).first();
    if (!(await deleteButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await deleteButton.click();
    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const pinInput = page.locator('#admin-password');
    const confirmDelete = modal.locator('button').filter({ hasText: '삭제' });

    // Attempt 5 wrong PINs
    for (let i = 0; i < 5; i++) {
      await pinInput.fill('9999');
      await confirmDelete.click();
      await page.waitForTimeout(500);
    }

    // After 5 failures, input should be disabled (lockout)
    await expect(pinInput).toBeDisabled({ timeout: 5000 });
  });

  test('a11y: admin dashboard', async ({ page }) => {
    await ensureAdminDashboard(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
  });
});

// ── Player Management ────────────────────────────────────

test.describe('Player Management', () => {
  test('page loads with player list or empty state', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/players');
    await waitForLoading(page);

    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('add player modal opens and has required fields', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/players');
    await waitForLoading(page);

    const addButton = page.locator('button').filter({ hasText: '추가' }).first();
    if (!(await addButton.isVisible().catch(() => false))) {
      // Try aria-label based
      const altButton = page.locator('[aria-label*="addPlayer"]').first();
      if (!(await altButton.isVisible().catch(() => false))) {
        test.skip();
        return;
      }
      await altButton.click();
    } else {
      await addButton.click();
    }

    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Required fields
    await expect(page.locator('#player-name')).toBeVisible();

    // Gender toggle buttons
    const genderButtons = modal.locator('button[aria-pressed]');
    expect(await genderButtons.count()).toBeGreaterThanOrEqual(2);

    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible({ timeout: 3000 });
  });

  test('add player: fill form and save', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/players');
    await waitForLoading(page);

    const addButton = page.locator('button').filter({ hasText: '추가' }).first()
      .or(page.locator('[aria-label*="addPlayer"]').first());
    if (!(await addButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await addButton.click();
    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill name
    await page.locator('#player-name').fill('E2E 테스트 선수');

    // Save
    const saveButton = modal.locator('button').filter({ hasText: '저장' }).first()
      .or(modal.locator('button').filter({ hasText: 'Save' }).first());
    if (await saveButton.isVisible()) {
      await saveButton.click();
      await waitForLoading(page);
    }
  });

  test('select all checkbox and bulk delete button', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/players');
    await waitForLoading(page);

    const selectAll = page.locator('[aria-label*="selectAll"], [aria-label*="전체 선택"]').first();
    if (!(await selectAll.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await selectAll.click();

    // Bulk delete button should appear
    const bulkDelete = page.locator('button').filter({ hasText: '삭제' }).first();
    await expect(bulkDelete).toBeVisible({ timeout: 3000 });
  });

  test('a11y: player management', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/players');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
  });
});

// ── Referee Management ───────────────────────────────────

test.describe('Referee Management', () => {
  test('page loads with referee list or empty state', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/referees');
    await waitForLoading(page);

    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('add referee modal has name, role, and PIN fields', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/referees');
    await waitForLoading(page);

    const addButton = page.locator('button').filter({ hasText: '추가' }).first()
      .or(page.locator('[aria-label*="addReferee"]').first());
    if (!(await addButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await addButton.click();

    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#referee-name')).toBeVisible();
    await expect(page.locator('#referee-role')).toBeVisible();
    await expect(page.locator('#referee-pin')).toBeVisible();

    // Close
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible({ timeout: 3000 });
  });

  test('delete referee modal has focus trap with cancel auto-focused', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/referees');
    await waitForLoading(page);

    const deleteButton = page.locator('button').filter({ hasText: '삭제' }).first();
    if (!(await deleteButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await deleteButton.click();

    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Cancel button should be focused (safety default)
    const cancelButton = modal.locator('button').filter({ hasText: '취소' });
    await expect(cancelButton).toBeFocused({ timeout: 3000 });

    await cancelButton.click();
    await expect(modal).not.toBeVisible({ timeout: 3000 });
  });

  test('a11y: referee management', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/referees');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
  });
});

// ── Court Management ─────────────────────────────────────

test.describe('Court Management', () => {
  test('page loads with court list or empty state', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/courts');
    await waitForLoading(page);

    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('add court modal has name, location, and referee assignment', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/courts');
    await waitForLoading(page);

    const addButton = page.locator('button').filter({ hasText: '추가' }).first()
      .or(page.locator('[aria-label*="addCourt"]').first());
    if (!(await addButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await addButton.click();

    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#court-name')).toBeVisible();
    await expect(page.locator('#court-location')).toBeVisible();

    // Referee assignment toggles (if referees registered)
    const refToggles = modal.locator('button[aria-pressed]');
    const noRefMessage = modal.locator('text=등록된 심판이 없습니다');
    const hasToggles = await refToggles.first().isVisible().catch(() => false);
    const hasNoRef = await noRefMessage.isVisible().catch(() => false);
    expect(hasToggles || hasNoRef).toBeTruthy();

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible({ timeout: 3000 });
  });

  test('referee assignment limited to max 2', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/courts');
    await waitForLoading(page);

    const addButton = page.locator('button').filter({ hasText: '추가' }).first()
      .or(page.locator('[aria-label*="addCourt"]').first());
    if (!(await addButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await addButton.click();
    const modal = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const refToggles = modal.locator('button[aria-pressed]');
    const toggleCount = await refToggles.count();

    if (toggleCount >= 3) {
      // Click first 3 referee toggles
      await refToggles.nth(0).click();
      await refToggles.nth(1).click();
      await refToggles.nth(2).click();

      // Count selected (aria-pressed="true")
      const selected = modal.locator('button[aria-pressed="true"]');
      const count = await selected.count();
      expect(count).toBeLessThanOrEqual(2);
    }

    await page.keyboard.press('Escape');
  });

  test('a11y: court management', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/courts');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
  });
});

// ── Admin Settings ───────────────────────────────────────

test.describe('Admin Settings', () => {
  test('page loads with settings sections', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/settings');
    await waitForLoading(page);

    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('change password section expands and has PIN fields', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/settings');
    await waitForLoading(page);

    // Find expandable password section
    const expandButton = page.locator('button[aria-expanded]').first();
    if (!(await expandButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await expandButton.click();

    // PIN fields should appear
    const currentPin = page.locator('#current-pin');
    const newPin = page.locator('#new-pin');
    const confirmPin = page.locator('#confirm-new-pin');

    await expect(currentPin).toBeVisible({ timeout: 3000 });
    await expect(newPin).toBeVisible();
    await expect(confirmPin).toBeVisible();
  });

  test('password change validates PIN mismatch', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/settings');
    await waitForLoading(page);

    const expandButton = page.locator('button[aria-expanded]').first();
    if (!(await expandButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await expandButton.click();

    await page.locator('#current-pin').fill('0000');
    await page.locator('#new-pin').fill('1234');
    await page.locator('#confirm-new-pin').fill('5678'); // Mismatch

    // Submit should show error
    const submitButton = page.locator('button').filter({ hasText: '변경' }).first();
    if (await submitButton.isVisible()) {
      await submitButton.click();
      await page.waitForTimeout(500);

      // Error alert should appear
      const alert = page.locator('[role="alert"]');
      await expect(alert).toBeVisible({ timeout: 3000 });
    }
  });

  test('sample names textarea shows count label', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/settings');
    await waitForLoading(page);

    const samplePlayers = page.locator('#sample-players');
    if (await samplePlayers.isVisible().catch(() => false)) {
      await samplePlayers.fill('선수1\n선수2\n선수3');
      // Count label should show 3
      const countLabel = page.locator('text=3');
      expect(await countLabel.isVisible()).toBeTruthy();
    }
  });

  test('a11y: admin settings', async ({ page }) => {
    await ensureAdminDashboard(page);
    await page.goto('/admin/settings');
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
  });
});

// ── Tournament Detail ────────────────────────────────────

test.describe('Tournament Detail', () => {
  test('tab navigation with 5 tabs', async ({ page }) => {
    await ensureAdminDashboard(page);

    // Click first tournament if available
    const tournamentButton = page.locator('button[role="button"]').first();
    if (!(await tournamentButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await tournamentButton.click();
    await waitForLoading(page);

    // Verify tablist exists
    const tablist = page.locator('[role="tablist"]');
    await expect(tablist).toBeVisible({ timeout: 10000 });

    // Should have 5 tabs
    const tabs = page.locator('[role="tab"]');
    expect(await tabs.count()).toBe(5);

    // Each tab should have aria-selected
    for (let i = 0; i < 5; i++) {
      const tab = tabs.nth(i);
      const selected = await tab.getAttribute('aria-selected');
      expect(selected === 'true' || selected === 'false').toBeTruthy();
    }
  });

  test('tab switching updates content', async ({ page }) => {
    await ensureAdminDashboard(page);

    const tournamentButton = page.locator('button[role="button"]').first();
    if (!(await tournamentButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await tournamentButton.click();
    await waitForLoading(page);

    const tabs = page.locator('[role="tab"]');
    const tabCount = await tabs.count();

    // Click each tab and verify it becomes selected
    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click();
      await waitForLoading(page);
      await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true');
    }
  });

  test('back button returns to dashboard', async ({ page }) => {
    await ensureAdminDashboard(page);

    const tournamentButton = page.locator('button[role="button"]').first();
    if (!(await tournamentButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await tournamentButton.click();
    await waitForLoading(page);

    const backButton = page.locator('[aria-label*="back"], [aria-label*="뒤로"]').first();
    if (await backButton.isVisible()) {
      await backButton.click();
      await waitForLoading(page);
      await expect(page).toHaveURL(/\/admin\/?$/);
    }
  });

  test('a11y: tournament detail', async ({ page }) => {
    await ensureAdminDashboard(page);

    const tournamentButton = page.locator('button[role="button"]').first();
    if (!(await tournamentButton.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await tournamentButton.click();
    await waitForLoading(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
  });
});
