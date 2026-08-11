// components/GradeBadge.tsx
// Pastille de ceinture : point + texte colorés à la couleur de la ceinture.
import { GRADE_LABELS } from '@/types'
import clsx from 'clsx'

interface GradeBadgeProps {
  grade: number
  size?: 'sm' | 'md' | 'lg'
}

// [couleur du point, couleur du texte — version lisible sur fond sombre]
const BELT_COLORS: Record<number, [string, string]> = {
  0:  ['#e5e7eb', '#e5e7eb'], 1:  ['#e5e7eb', '#e5e7eb'],
  2:  ['#facc15', '#facc15'], 3:  ['#facc15', '#facc15'],
  4:  ['#fb923c', '#fb923c'], 5:  ['#fb923c', '#fb923c'],
  6:  ['#22c55e', '#4ade80'], 7:  ['#22c55e', '#4ade80'],
  8:  ['#3b82f6', '#60a5fa'], 9:  ['#3b82f6', '#60a5fa'],
  10: ['#92400e', '#d97706'], 11: ['#92400e', '#d97706'],
  12: ['#111111', '#f1f5f9'],
}

export default function GradeBadge({ grade, size = 'md' }: GradeBadgeProps) {
  const [dot, text] = BELT_COLORS[grade] ?? BELT_COLORS[0]
  const label = GRADE_LABELS[grade] ?? 'Inconnue'
  const hasLine = grade % 2 === 1
  const isBlack = grade === 12
  const isWhite = grade <= 1

  const sizeClasses = {
    sm: 'text-[0.62rem] px-2 py-0.5 tracking-[0.08em] gap-1.5',
    md: 'text-[0.7rem] px-2.5 py-1 tracking-[0.1em] gap-1.5',
    lg: 'text-xs px-3 py-1.5 tracking-[0.12em] gap-2',
  }[size]

  const dotSize = { sm: 8, md: 9, lg: 11 }[size]

  return (
    <span
      className={clsx(
        'grade-chip inline-flex items-center rounded-full font-bold uppercase whitespace-nowrap',
        isWhite && 'belt-white',
        isBlack && 'belt-black',
        sizeClasses,
      )}
      style={{ ['--belt-text' as any]: text }}
    >
      <span
        aria-hidden="true"
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: '50%',
          background: dot,
          flexShrink: 0,
          boxShadow: isBlack ? '0 0 0 1.5px rgba(255,255,255,0.45)' : hasLine ? `0 0 0 1.5px ${dot}55` : 'none',
        }}
      />
      {isBlack && <span aria-hidden="true" style={{ fontSize: '0.7em' }}>⭐</span>}
      {label}
    </span>
  )
}
