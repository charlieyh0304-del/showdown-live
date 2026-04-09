/**
 * Baseline accessibility scan.
 *
 * 이 앱의 핵심 사용자는 시각장애인(IBSA 쇼다운). a11y 회귀 방지를 위한
 * 기본 axe 스캔을 페이지/모드별로 수행한다. 위반은 soft-assert로 보고만 하고
 * 빌드를 멈추지는 않는다 (CI 차단 없이 가시화 우선). 위반을 실제로 fail하게
 * 만들려면 expect.soft → expect로 바꾸면 된다.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { navigateToReferee, navigateToSpectator } from './helpers';

const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('Accessibility baseline (WCAG 2.1 AA)', () => {
  test('mode selector (home) — WCAG AA', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('text=쇼다운', { timeout: 10000 });

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(
      a11y.violations,
      `Mode selector violations:\n${JSON.stringify(a11y.violations, null, 2)}`,
    ).toEqual([]);
  });

  test('referee login (시각장애 심판 진입점) — WCAG AA', async ({ page }) => {
    await navigateToReferee(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(
      a11y.violations,
      `Referee login violations:\n${JSON.stringify(a11y.violations, null, 2)}`,
    ).toEqual([]);
  });

  test('spectator home (시각장애 관람자 진입점) — WCAG AA', async ({ page }) => {
    await navigateToSpectator(page);

    const a11y = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
    expect.soft(
      a11y.violations,
      `Spectator home violations:\n${JSON.stringify(a11y.violations, null, 2)}`,
    ).toEqual([]);
  });
});
