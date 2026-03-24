import { test, expect } from '@playwright/test';
import { navigateToAdmin, waitForLoading } from './helpers';

test.describe('Tournament Creation Flow', () => {
  test('can navigate to tournament creation wizard', async ({ page }) => {
    await navigateToAdmin(page);

    // Check if we're on dashboard (authenticated) or still on login
    const dashboard = page.locator('h1', { hasText: '대시보드' });
    if (!(await dashboard.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Click "새 대회 만들기" button
    const createButton = page.locator('[aria-label="새 대회 만들기"]');
    await expect(createButton).toBeVisible({ timeout: 10000 });
    await createButton.click();

    await waitForLoading(page);

    await expect(page.locator('h1', { hasText: '새 대회 만들기' })).toBeVisible();
  });

  test('wizard step 1: fill in basic tournament info', async ({ page }) => {
    await navigateToAdmin(page);

    const dashboard = page.locator('h1', { hasText: '대시보드' });
    if (!(await dashboard.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Navigate to creation page
    await page.locator('[aria-label="새 대회 만들기"]').click();
    await waitForLoading(page);

    await expect(page.locator('h1', { hasText: '새 대회 만들기' })).toBeVisible();

    // Fill in tournament name
    const nameInput = page.locator('#name');
    await nameInput.fill('E2E 테스트 대회');
    await expect(nameInput).toHaveValue('E2E 테스트 대회');

    // Verify type selection exists
    await expect(page.locator('text=유형 선택')).toBeVisible();

    // Verify setup method section exists
    await expect(page.locator('text=설정 방식')).toBeVisible();
  });

  test('wizard step 1: preset selection navigates forward', async ({ page }) => {
    await navigateToAdmin(page);

    const dashboard = page.locator('h1', { hasText: '대시보드' });
    if (!(await dashboard.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await page.locator('[aria-label="새 대회 만들기"]').click();
    await waitForLoading(page);

    await page.locator('#name').fill('프리셋 테스트 대회');

    // Click "풀리그" preset if it exists
    const fullLeaguePreset = page.locator('button', { hasText: '풀리그' });
    if (await fullLeaguePreset.isVisible()) {
      await fullLeaguePreset.click();
      await waitForLoading(page);

      const participantCount = page.locator('text=참가자 수');
      const preview = page.locator('text=미리보기');
      await expect(participantCount.or(preview)).toBeVisible({ timeout: 5000 });
    }
  });

  test('wizard step 2: set participant count via custom setup', async ({ page }) => {
    await navigateToAdmin(page);

    const dashboard = page.locator('h1', { hasText: '대시보드' });
    if (!(await dashboard.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await page.locator('[aria-label="새 대회 만들기"]').click();
    await waitForLoading(page);

    await page.locator('#name').fill('참가자 테스트');

    const customButton = page.locator('button', { hasText: '직접 설정' });
    if (await customButton.isVisible()) {
      await customButton.click();
      await waitForLoading(page);

      await expect(page.locator('h2', { hasText: '참가자 수' }).or(page.locator('h2', { hasText: '팀 수' }))).toBeVisible({ timeout: 5000 });
    }
  });

  test('wizard navigation: can go forward and backward', async ({ page }) => {
    await navigateToAdmin(page);

    const dashboard = page.locator('h1', { hasText: '대시보드' });
    if (!(await dashboard.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await page.locator('[aria-label="새 대회 만들기"]').click();
    await waitForLoading(page);

    await page.locator('#name').fill('네비게이션 테스트');

    const customButton = page.locator('button', { hasText: '직접 설정' });
    if (!(await customButton.isVisible())) {
      test.skip();
      return;
    }
    await customButton.click();
    await waitForLoading(page);

    // Navigate forward
    const nextButton = page.locator('[aria-label="다음 단계"]');
    if (await nextButton.isVisible()) {
      await nextButton.click();
      await waitForLoading(page);
    }

    // Navigate backward
    const prevButton = page.locator('[aria-label="이전 단계"]');
    if (await prevButton.isVisible()) {
      await prevButton.click();
      await waitForLoading(page);
    }

    // Keep clicking next until we see "대회 생성" button
    for (let i = 0; i < 4; i++) {
      const nextBtn = page.locator('[aria-label="다음 단계"]');
      if (await nextBtn.isVisible()) {
        await nextBtn.click();
        await waitForLoading(page);
      } else {
        break;
      }
    }

    const submitButton = page.locator('[aria-label="대회 생성"]').first();
    await expect(submitButton).toBeVisible({ timeout: 5000 });
  });

  test('wizard cancel button returns to admin home', async ({ page }) => {
    await navigateToAdmin(page);

    const dashboard = page.locator('h1', { hasText: '대시보드' });
    if (!(await dashboard.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await page.locator('[aria-label="새 대회 만들기"]').click();
    await waitForLoading(page);

    const cancelButton = page.locator('[aria-label="취소"]');
    await cancelButton.click();
    await waitForLoading(page);

    await expect(page).toHaveURL(/\/admin\/?$/);
  });
});
