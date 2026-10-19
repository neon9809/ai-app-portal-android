import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/shared/lib/cn'

const FIELD_BASE =
  'w-full rounded-md border border-input bg-surface px-3 text-body text-surface-foreground ' +
  'placeholder:text-muted-foreground transition-colors duration-fast ' +
  'focus:border-primary focus-visible:outline-none disabled:opacity-50'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, hint, error, id, ...props },
  ref,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-caption font-medium text-muted-foreground">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={cn(FIELD_BASE, 'min-h-tap', error && 'border-danger', className)}
        {...props}
      />
      {(error || hint) && (
        <p className={cn('mt-1 text-caption', error ? 'text-danger' : 'text-muted-foreground')}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, label, hint, error, id, ...props },
  ref,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-caption font-medium text-muted-foreground">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={cn(FIELD_BASE, 'py-2.5', error && 'border-danger', className)}
        {...props}
      />
      {(error || hint) && (
        <p className={cn('mt-1 text-caption', error ? 'text-danger' : 'text-muted-foreground')}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
})

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  disabled?: boolean
}) {
  return (
    <label className={cn('flex min-h-tap items-center justify-between gap-3', disabled && 'opacity-50')}>
      {label && <span className="text-body">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition-colors duration-base',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        {/* 显式 left 定位：绝对定位的拨扭只设 top 时水平方向落在静态位置，
            而 button 默认 text-align:center 会把它先推到中间，再叠加位移就滑出轨道 */}
        <span
          className={cn(
            'absolute left-[2px] top-1/2 size-6 -translate-y-1/2 rounded-full bg-surface shadow-sm transition-transform duration-base',
            checked ? 'translate-x-[20px]' : 'translate-x-0',
          )}
        />
      </button>
    </label>
  )
}
