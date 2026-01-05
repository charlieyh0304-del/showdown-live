import { useNavigate } from 'react-router-dom'
import styles from './Header.module.css'

interface HeaderProps {
  title: string
  subtitle?: string
  gradient?: string
  showBack?: boolean
  onBack?: () => void
}

export function Header({
  title,
  subtitle,
  gradient = 'linear-gradient(135deg, #1a73e8 0%, #4285f4 100%)',
  showBack = false,
  onBack
}: HeaderProps) {
  const navigate = useNavigate()

  const handleBack = () => {
    if (onBack) {
      onBack()
    } else {
      navigate(-1)
    }
  }

  return (
    <header className={styles.header} style={{ background: gradient }}>
      {showBack && (
        <button
          className={styles.backButton}
          onClick={handleBack}
          aria-label="뒤로 가기"
        >
          ← 뒤로
        </button>
      )}
      <h1 className={styles.title}>{title}</h1>
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
    </header>
  )
}
