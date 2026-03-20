import { test, expect } from '@playwright/test';
import { navigateToReferee, waitForLoading } from './helpers';

test.describe('Referee Scoring Flow', () => {
  test('referee login page shows tournament selection', async ({ page }) => {
    await navigateToReferee(page);

    // Should show "심판 모드" heading
    await expect(page.locator('h1', { hasText: '심판 모드' })).toBeVisible();

    // Should show "대회 선택" step
    await expect(page.locator('text=대회 선택')).toBeVisible();

    // Should have a "모드 선택으로" back button
    await expect(page.locator('button', { hasText: '모드 선택으로' })).toBeVisible();
  });

  test('referee login page shows practice mode button', async ({ page }) => {
    await navigateToReferee(page);

    // Practice mode button should be visible (no auth required)
    const practiceButton = page.locator('button', { hasText: '연습 모드' });
    await expect(practiceButton).toBeVisible();
  });

  test('back button on referee login returns to mode selector', async ({ page }) => {
    await navigateToReferee(page);

    const backButton = page.locator('button', { hasText: '모드 선택으로' });
    await backButton.click();
    await waitForLoading(page);

    // Should return to mode selector
    await expect(page.locator('text=쇼다운')).toBeVisible({ timeout: 10000 });
  });

  test('tournament selection step shows tournament list or empty state', async ({ page }) => {
    await navigateToReferee(page);

    // Wait for tournaments to load - either we see tournament buttons or "등록된 대회가 없습니다"
    const tournamentButton = page.locator('button.btn-primary.btn-large').first();
    const emptyMessage = page.locator('text=등록된 대회가 없습니다');
    const loadingMessage = page.locator('text=대회 목록 로딩 중');

    await expect(
      tournamentButton.or(emptyMessage).or(loadingMessage),
    ).toBeVisible({ timeout: 15000 });

    // If loading, wait for it to finish
    if (await loadingMessage.isVisible()) {
      await loadingMessage.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    }
  });

  test('selecting a tournament shows referee selection step', async ({ page }) => {
    await navigateToReferee(page);

    // Wait for tournament list to load
    await waitForLoading(page);

    // Try to find a tournament button
    const tournamentButton = page.locator('button.btn-primary.btn-large').first();
    const emptyMessage = page.locator('text=등록된 대회가 없습니다');

    // Wait for either state
    await expect(tournamentButton.or(emptyMessage)).toBeVisible({ timeout: 15000 });

    // Only proceed if there are tournaments
    if (await tournamentButton.isVisible()) {
      await tournamentButton.click();
      await waitForLoading(page);

      // Should show referee selection step
      await expect(page.locator('text=심판 선택')).toBeVisible({ timeout: 5000 });

      // Should have a back button
      const backButton = page.locator('button', { hasText: '뒤로' });
      await expect(backButton).toBeVisible();
    }
  });

  test('PIN entry step shows after referee selection', async ({ page }) => {
    await navigateToReferee(page);
    await waitForLoading(page);

    // Select tournament if available
    const tournamentButton = page.locator('button.btn-primary.btn-large').first();
    const emptyTournaments = page.locator('text=등록된 대회가 없습니다');
    await expect(tournamentButton.or(emptyTournaments)).toBeVisible({ timeout: 15000 });

    if (!(await tournamentButton.isVisible())) {
      test.skip();
      return;
    }

    await tournamentButton.click();
    await waitForLoading(page);

    // Select referee if available
    const refereeButton = page.locator('button.btn-secondary.btn-large').first();
    const emptyReferees = page.locator('text=등록된 심판이 없습니다');
    await expect(refereeButton.or(emptyReferees)).toBeVisible({ timeout: 15000 });

    if (!(await refereeButton.isVisible())) {
      test.skip();
      return;
    }

    await refereeButton.click();
    await waitForLoading(page);

    // Should show PIN entry
    await expect(page.locator('text=PIN 입력')).toBeVisible({ timeout: 5000 });

    // PIN input should be visible
    const pinInput = page.locator('input[type="password"]');
    await expect(pinInput).toBeVisible();

    // Login button should exist but be disabled (no PIN entered)
    const loginButton = page.locator('button', { hasText: '로그인' });
    await expect(loginButton).toBeVisible();
    await expect(loginButton).toBeDisabled();

    // Enter a 4-digit PIN
    await pinInput.fill('1234');

    // Login button should now be enabled
    await expect(loginButton).toBeEnabled();
  });

  test('practice mode navigates to practice page', async ({ page }) => {
    await navigateToReferee(page);

    const practiceButton = page.locator('button', { hasText: '연습 모드' });
    await practiceButton.click();
    await waitForLoading(page);

    // Should navigate to practice page
    await expect(page).toHaveURL(/\/referee\/practice/);
  });
});
