import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

export function ResizeHandle({
  direction = 'horizontal',
  value,
  min,
  max,
  onChange,
  invert = false,
  label,
}: {
  direction?: 'horizontal' | 'vertical'
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  invert?: boolean
  label: string
}) {
  const start = useRef({ position: 0, value: 0 })
  const clamp = (next: number) => Math.min(max, Math.max(min, next))
  const down = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    start.current = { position: direction === 'horizontal' ? event.clientX : event.clientY, value }
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const position = direction === 'horizontal' ? event.clientX : event.clientY
    onChange(clamp(start.current.value + (position - start.current.position) * (invert ? -1 : 1)))
  }
  const key = (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    onChange(
      clamp(value + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -10 : 10) * (invert ? -1 : 1)),
    )
  }
  return (
    <div
      className={`resize-handle ${direction}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={down}
      onPointerMove={move}
      onKeyDown={key}
    />
  )
}
