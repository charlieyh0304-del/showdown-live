import type { InputHTMLAttributes } from 'react'
import styles from './Input.module.css'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export function Input({ label, error, id, className = '', ...props }: InputProps) {
  const inputId = id || `input-${label?.replace(/\s/g, '-').toLowerCase()}`

  return (
    <div className={`${styles.formGroup} ${className}`}>
      {label && <label htmlFor={inputId}>{label}</label>}
      <input
        id={inputId}
        className={`${styles.input} ${error ? styles.error : ''}`}
        {...props}
      />
      {error && <span className={styles.errorText}>{error}</span>}
    </div>
  )
}
