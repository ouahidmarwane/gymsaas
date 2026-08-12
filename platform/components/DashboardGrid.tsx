'use client'

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { CardPlacement, CardSpec } from '@/lib/client'
import { COLUMNS, moveCard, resizeCard, rows } from '@/lib/grid'
import styles from './grid.module.css'

const ROW_HEIGHT = 88
const GAP = 12

interface Props {
  layout: CardPlacement[]
  specs: Record<string, CardSpec>
  editing: boolean
  renderCard: (id: string) => React.ReactNode
  labelFor: (id: string) => string
  onChange: (next: CardPlacement[]) => void
}

type Drag =
  | { kind: 'move'; id: string; pointerId: number; dx: number; dy: number }
  | { kind: 'resize'; id: string; pointerId: number; startW: number; startH: number; startX: number; startY: number }

export default function DashboardGrid({
  layout, specs, editing, renderCard, labelFor, onChange,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)

  const visible = layout.filter(c => c.visible)
  const hidden = layout.filter(c => !c.visible)
  const rowCount = rows(layout)

  /** Largeur reelle d'une colonne, mesuree : la grille est fluide. */
  const colWidth = useCallback(() => {
    const width = gridRef.current?.clientWidth ?? 0
    return (width - GAP * (COLUMNS - 1)) / COLUMNS
  }, [])

  function startMove(event: ReactPointerEvent, card: CardPlacement) {
    if (!editing) return
    event.preventDefault()
    const rect = (event.currentTarget as HTMLElement).closest(`.${styles.cell}`)!.getBoundingClientRect()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    setDrag({
      kind: 'move', id: card.id, pointerId: event.pointerId,
      dx: event.clientX - rect.left, dy: event.clientY - rect.top,
    })
    setGhost({ x: card.x, y: card.y })
  }

  function startResize(event: ReactPointerEvent, card: CardPlacement) {
    if (!editing) return
    event.preventDefault()
    event.stopPropagation()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    setDrag({
      kind: 'resize', id: card.id, pointerId: event.pointerId,
      startW: card.w, startH: card.h, startX: event.clientX, startY: event.clientY,
    })
  }

  function onPointerMove(event: ReactPointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return
    const grid = gridRef.current
    if (!grid) return
    const rect = grid.getBoundingClientRect()
    const unit = colWidth() + GAP

    if (drag.kind === 'move') {
      // En RTL la grille se lit de droite a gauche : on mesure depuis le
      // bord logique de depart, pas depuis la gauche physique.
      const rtl = getComputedStyle(grid).direction === 'rtl'
      const offsetX = rtl
        ? rect.right - (event.clientX - drag.dx) - colWidth()
        : (event.clientX - drag.dx) - rect.left
      const x = Math.round(offsetX / unit)
      const y = Math.round(((event.clientY - drag.dy) - rect.top) / (ROW_HEIGHT + GAP))
      setGhost({ x: Math.max(0, x), y: Math.max(0, y) })
    } else {
      const card = layout.find(c => c.id === drag.id)!
      const w = drag.startW + Math.round((event.clientX - drag.startX) / unit)
      const h = drag.startH + Math.round((event.clientY - drag.startY) / (ROW_HEIGHT + GAP))
      const spec = specs[card.id]
      if (spec) onChange(resizeCard(layout, card.id, w, h, spec))
      setDrag({ ...drag, startW: w, startH: h, startX: event.clientX, startY: event.clientY })
    }
  }

  function endDrag() {
    if (drag?.kind === 'move' && ghost) onChange(moveCard(layout, drag.id, ghost.x, ghost.y))
    setDrag(null)
    setGhost(null)
  }

  /** Deplacement au clavier : le glisser ne peut pas etre le seul moyen. */
  function onCardKeyDown(event: React.KeyboardEvent, card: CardPlacement) {
    if (!editing) return
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }
    const delta = step[event.key]
    if (!delta) return
    event.preventDefault()
    onChange(moveCard(layout, card.id, card.x + delta[0], card.y + delta[1]))
  }

  return (
    <>
      <div
        ref={gridRef}
        className={styles.grid}
        data-editing={editing || undefined}
        style={{
          gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
          gridAutoRows: `${ROW_HEIGHT}px`,
          gap: `${GAP}px`,
          minHeight: rowCount * (ROW_HEIGHT + GAP),
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Empreinte de destination pendant le glisser. */}
        {drag?.kind === 'move' && ghost && (() => {
          const card = layout.find(c => c.id === drag.id)!
          return (
            <div
              className={styles.ghost}
              aria-hidden="true"
              style={{
                gridColumn: `${Math.min(ghost.x, COLUMNS - card.w) + 1} / span ${card.w}`,
                gridRow: `${ghost.y + 1} / span ${card.h}`,
              }}
            />
          )
        })()}

        {visible.map(card => (
          <section
            key={card.id}
            className={styles.cell}
            data-dragging={drag?.id === card.id || undefined}
            style={{
              gridColumn: `${card.x + 1} / span ${card.w}`,
              gridRow: `${card.y + 1} / span ${card.h}`,
            }}
            aria-label={labelFor(card.id)}
          >
            {editing && (
              <div className={styles.chrome}>
                <button
                  type="button"
                  className={styles.handle}
                  onPointerDown={e => startMove(e, card)}
                  onKeyDown={e => onCardKeyDown(e, card)}
                  aria-label={`Deplacer ${labelFor(card.id)}. Fleches pour ajuster.`}
                >
                  <GripIcon />
                </button>
                <button
                  type="button"
                  className={styles.hide}
                  onClick={() => onChange(layout.map(c =>
                    c.id === card.id ? { ...c, visible: false } : c))}
                  aria-label={`Masquer ${labelFor(card.id)}`}
                >
                  &times;
                </button>
              </div>
            )}

            <div className={styles.body}>{renderCard(card.id)}</div>

            {editing && (
              <span
                className={styles.resize}
                role="slider"
                tabIndex={0}
                aria-label={`Redimensionner ${labelFor(card.id)}`}
                aria-valuenow={card.w}
                aria-valuemin={specs[card.id]?.minW ?? 1}
                aria-valuemax={specs[card.id]?.maxW ?? COLUMNS}
                onPointerDown={e => startResize(e, card)}
                onKeyDown={e => {
                  const spec = specs[card.id]
                  if (!spec) return
                  if (e.key === 'ArrowRight') { e.preventDefault(); onChange(resizeCard(layout, card.id, card.w + 1, card.h, spec)) }
                  if (e.key === 'ArrowLeft')  { e.preventDefault(); onChange(resizeCard(layout, card.id, card.w - 1, card.h, spec)) }
                  if (e.key === 'ArrowDown')  { e.preventDefault(); onChange(resizeCard(layout, card.id, card.w, card.h + 1, spec)) }
                  if (e.key === 'ArrowUp')    { e.preventDefault(); onChange(resizeCard(layout, card.id, card.w, card.h - 1, spec)) }
                }}
              />
            )}
          </section>
        ))}
      </div>

      {editing && hidden.length > 0 && (
        <div className={styles.tray}>
          <span className={styles.trayLabel}>Cartes masquees</span>
          <div className={styles.trayItems}>
            {hidden.map(card => (
              <button
                key={card.id}
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onChange(moveCard(
                  layout.map(c => c.id === card.id ? { ...c, visible: true } : c),
                  card.id, 0, 999,
                ))}
              >
                + {labelFor(card.id)}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
      {[2, 8, 14].map(y => (
        <g key={y}>
          <circle cx="2" cy={y} r="1.4" />
          <circle cx="8" cy={y} r="1.4" />
        </g>
      ))}
    </svg>
  )
}
