import type { ReactNode } from 'react'
import styles from './Card.module.css'

interface CardProps {
  children: ReactNode
  title?: string
  className?: string
  onClick?: () => void
}

export function Card({ children, title, className = '', onClick }: CardProps) {
  const isClickable = !!onClick

  return (
    <div
      className={`${styles.card} ${isClickable ? styles.clickable : ''} ${className}`}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => e.key === 'Enter' && onClick?.() : undefined}
    >
      {title && <h2 className={styles.title}>{title}</h2>}
      {children}
    </div>
  )
}
