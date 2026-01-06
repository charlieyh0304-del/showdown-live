/**
 * 접근성 설정을 전역으로 적용하는 Provider
 * body 요소에 테마, 폰트 크기, 모션 감소 클래스를 적용
 */

import { useEffect } from 'react'
import { useAccessibilityStore } from '@/stores'

interface AccessibilityProviderProps {
  children: React.ReactNode
}

export function AccessibilityProvider({ children }: AccessibilityProviderProps) {
  const { theme, fontSize, reduceMotion } = useAccessibilityStore()

  useEffect(() => {
    const body = document.body

    // 테마 클래스 적용
    body.classList.remove('default', 'dark', 'high-contrast', 'inverted')
    if (theme !== 'default') {
      body.classList.add(theme)
    }

    // 폰트 크기 클래스 적용
    body.classList.remove('font-normal', 'font-large', 'font-extra-large')
    if (fontSize !== 'normal') {
      body.classList.add(`font-${fontSize}`)
    }

    // 모션 감소 클래스 적용
    if (reduceMotion) {
      body.classList.add('reduce-motion')
    } else {
      body.classList.remove('reduce-motion')
    }

    return () => {
      // Cleanup on unmount
      body.classList.remove('default', 'dark', 'high-contrast', 'inverted')
      body.classList.remove('font-normal', 'font-large', 'font-extra-large')
      body.classList.remove('reduce-motion')
    }
  }, [theme, fontSize, reduceMotion])

  return <>{children}</>
}
