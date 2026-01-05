import type { ReactNode, ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

type ButtonVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'link'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  fullWidth?: boolean
  children: ReactNode
}

export function Button({
  variant = 'default',
  fullWidth = true,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const variantClass = styles[variant] || ''

  return (
    <button
      className={`${styles.btn} ${variantClass} ${fullWidth ? styles.fullWidth : ''} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
