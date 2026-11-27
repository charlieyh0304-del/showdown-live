import { it, expect, describe } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import AccessibilityMenu from './AccessibilityMenu';

// React 테스트 환경(jsdom)이 없어 서버 렌더로 확인한다. i18n을 초기화하지 않아 문구 대신 키가 나온다.
describe('AccessibilityMenu (SSR smoke)', () => {
  it('closed: the fixed trigger itself carries the no-invert counter filter and an accessible name', () => {
    const html = renderToString(h(AccessibilityMenu));
    // 필터(a11y-no-invert)는 고정 위치 요소 자신에 있어야 한다 (조상에 있으면 화면 고정이 깨진다)
    expect(html).toMatch(/<div class="a11y-no-invert fixed bottom-4 right-4 z-50">/);
    expect(html).toContain('aria-label="common.accessibility.openSettings"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/role="status"[^>]*class="sr-only"|aria-live="polite"/);
    expect(html).not.toContain('role="dialog"');
  });

  it('open: labelled dialog, radio groups with legends, switches with aria-checked, no voice read-aloud options', () => {
    const html = renderToString(h(AccessibilityMenu, { initialOpen: true }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="[^"]+-title"/);
    for (const legend of ['screenMode', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing']) {
      expect(html).toContain(`<legend class="font-semibold mb-1">common.accessibility.${legend}</legend>`);
    }
    // 라디오는 모두 label과 연결된다 (for ↔ id)
    const radios = [...html.matchAll(/<input id="([^"]+)" type="radio"/g)].map(m => m[1]);
    expect(radios.length).toBe(5 + 5 + 2 + 3 + 3);
    for (const id of radios) expect(html).toContain(`for="${id}"`);
    // 스위치: 초점 강조·움직임 줄이기 (기본 꺼짐), 설명이 연결된다
    const switches = [...html.matchAll(/role="switch" aria-checked="(true|false)" aria-describedby="([^"]+)"/g)];
    expect(switches.map(m => m[1])).toEqual(['false', 'false']);
    for (const m of switches) expect(html).toContain(`id="${m[2]}"`);
    // 음성 안내(기기 음성 읽기) 옵션은 없다 (소유자 결정)
    expect(html).not.toContain('voiceOn');
    expect(html).not.toContain('voiceOff');
    expect(html).not.toContain('readVoiceAnswers');
  });
});
