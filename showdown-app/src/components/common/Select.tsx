import type { SelectHTMLAttributes } from 'react'
import styles from './Select.module.css'

interface SelectOption {
  value: string | number
  label: string
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: SelectOption[]
  error?: string
}

export function Select({ label, options, error, id, className = '', ...props }: SelectProps) {
  const selectId = id || `select-${label?.replace(/\s/g, '-').toLowerCase()}`

  return (
    <div className={`${styles.formGroup} ${className}`}>
      {label && <label htmlFor={selectId}>{label}</label>}
      <select
        id={selectId}
        className={`${styles.select} ${error ? styles.error : ''}`}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <span className={styles.errorText}>{error}</span>}
    </div>
  )
}
