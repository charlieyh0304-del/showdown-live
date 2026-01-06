/**
 * 접근성 설정 메뉴
 * 음성 안내, 테마, 글꼴 크기 등 접근성 옵션 설정
 */

import { useAccessibilityStore } from '@/stores'
import { useSpeech } from '@/hooks'
import { Modal, Button } from '@/components/common'
import styles from './AccessibilityMenu.module.css'

interface AccessibilityMenuProps {
  isOpen: boolean
  onClose: () => void
}

export function AccessibilityMenu({ isOpen, onClose }: AccessibilityMenuProps) {
  const {
    voiceEnabled,
    voiceVolume,
    theme,
    fontSize,
    reduceMotion,
    announceScore,
    announceSetScore,
    announceServe,
    setVoiceEnabled,
    setVoiceVolume,
    setTheme,
    setFontSize,
    setReduceMotion,
    setAnnounceScore,
    setAnnounceSetScore,
    setAnnounceServe,
  } = useAccessibilityStore()

  const { speak, isSupported } = useSpeech()

  const handleVoiceToggle = () => {
    const newValue = !voiceEnabled
    setVoiceEnabled(newValue)
    if (newValue) {
      // 활성화 시 테스트 음성 출력
      setTimeout(() => speak('음성 안내가 활성화되었습니다.'), 100)
    }
  }

  const handleTestVoice = () => {
    speak('테스트 음성입니다. 3 대 2, 홍길동 서브.')
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="접근성 설정">
      <div className={styles.menu}>
        {/* 음성 안내 섹션 */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>🔊 음성 안내</h3>

          <div className={styles.option}>
            <label className={styles.label}>
              <span>음성 안내 사용</span>
              <button
                className={`${styles.toggle} ${voiceEnabled ? styles.active : ''}`}
                onClick={handleVoiceToggle}
                disabled={!isSupported}
                aria-pressed={voiceEnabled}
              >
                {voiceEnabled ? 'ON' : 'OFF'}
              </button>
            </label>
            {!isSupported && (
              <p className={styles.warning}>이 브라우저는 음성 합성을 지원하지 않습니다.</p>
            )}
          </div>

          {voiceEnabled && (
            <>
              <div className={styles.option}>
                <label className={styles.label}>
                  <span>음량</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={voiceVolume}
                    onChange={(e) => setVoiceVolume(parseFloat(e.target.value))}
                    className={styles.slider}
                  />
                  <span className={styles.value}>{Math.round(voiceVolume * 100)}%</span>
                </label>
              </div>

              <div className={styles.option}>
                <Button variant="default" size="small" onClick={handleTestVoice}>
                  음성 테스트
                </Button>
              </div>

              <div className={styles.subOptions}>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={announceScore}
                    onChange={(e) => setAnnounceScore(e.target.checked)}
                  />
                  <span>매 득점 시 안내</span>
                </label>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={announceSetScore}
                    onChange={(e) => setAnnounceSetScore(e.target.checked)}
                  />
                  <span>세트 점수 안내</span>
                </label>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={announceServe}
                    onChange={(e) => setAnnounceServe(e.target.checked)}
                  />
                  <span>서브 교대 안내</span>
                </label>
              </div>
            </>
          )}
        </section>

        {/* 시각 설정 섹션 */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>👁️ 시각 설정</h3>

          <div className={styles.option}>
            <label className={styles.label}>
              <span>테마</span>
            </label>
            <div className={styles.themeButtons}>
              <button
                className={`${styles.themeBtn} ${theme === 'default' ? styles.selected : ''}`}
                onClick={() => setTheme('default')}
                aria-pressed={theme === 'default'}
              >
                <span className={styles.themePreview} data-theme="default" />
                기본
              </button>
              <button
                className={`${styles.themeBtn} ${theme === 'dark' ? styles.selected : ''}`}
                onClick={() => setTheme('dark')}
                aria-pressed={theme === 'dark'}
              >
                <span className={styles.themePreview} data-theme="dark" />
                다크
              </button>
              <button
                className={`${styles.themeBtn} ${theme === 'high-contrast' ? styles.selected : ''}`}
                onClick={() => setTheme('high-contrast')}
                aria-pressed={theme === 'high-contrast'}
              >
                <span className={styles.themePreview} data-theme="high-contrast" />
                고대비
              </button>
              <button
                className={`${styles.themeBtn} ${theme === 'inverted' ? styles.selected : ''}`}
                onClick={() => setTheme('inverted')}
                aria-pressed={theme === 'inverted'}
              >
                <span className={styles.themePreview} data-theme="inverted" />
                반전
              </button>
            </div>
          </div>

          <div className={styles.option}>
            <label className={styles.label}>
              <span>글꼴 크기</span>
            </label>
            <div className={styles.fontButtons}>
              <button
                className={`${styles.fontBtn} ${fontSize === 'normal' ? styles.selected : ''}`}
                onClick={() => setFontSize('normal')}
                aria-pressed={fontSize === 'normal'}
              >
                가
              </button>
              <button
                className={`${styles.fontBtn} ${styles.large} ${fontSize === 'large' ? styles.selected : ''}`}
                onClick={() => setFontSize('large')}
                aria-pressed={fontSize === 'large'}
              >
                가
              </button>
              <button
                className={`${styles.fontBtn} ${styles.extraLarge} ${fontSize === 'extra-large' ? styles.selected : ''}`}
                onClick={() => setFontSize('extra-large')}
                aria-pressed={fontSize === 'extra-large'}
              >
                가
              </button>
            </div>
          </div>

          <div className={styles.option}>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={reduceMotion}
                onChange={(e) => setReduceMotion(e.target.checked)}
              />
              <span>애니메이션 줄이기</span>
            </label>
          </div>
        </section>

        <div className={styles.footer}>
          <Button variant="primary" onClick={onClose}>
            설정 완료
          </Button>
        </div>
      </div>
    </Modal>
  )
}
