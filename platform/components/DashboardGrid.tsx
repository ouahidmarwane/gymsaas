'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GripVertical, X, Plus } from 'lucide-react'
import type { CardPlacement, CardSpec } from '@/lib/client'
import { COLUMNS, moveCard, resizeCard, rows } from '@/lib/grid'

const ROW_H = 104
const GAP = 18

interface Props {
  layout: CardPlacement[]
  specs: Record<string, CardSpec>
  editing: boolean
  labelFor: (id: string) => string
  renderCard: (id: string) => React.ReactNode
  onChange: (next: CardPlacement[]) => void
}

interface DragState {
  id: string
  pointerId: number
  grabX: number       // decalage du curseur dans la carte, en px
  grabY: number
  originX: number     // position d'origine de la carte a l'ecran
  originY: number
  dx: number          // deplacement courant, en px
  dy: number
  target: { x: number; y: number }
}

/**
 * Grille du tableau de bord.
 *
 * Le deplacement suit le curseur en `transform` pur, jamais en changeant la
 * position de grille : la carte saisie ne declenche aucun recalcul de mise en
 * page, donc elle colle au doigt meme sur un telephone moyen. Les cartes
 * bousculees, elles, changent bien de place — mais avec une transition, ce qui
 * donne l'impression qu'elles s'ecartent au lieu de sauter.
 */
export default function DashboardGrid({
  layout, specs, editing, labelFor, renderCard, onChange,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [resizing, setResizing] = useState<string | null>(null)

  // La disposition affichee pendant un glisser : la carte saisie est placee a
  // sa destination provisoire, et les autres se reorganisent autour en direct.
  // On voit donc le resultat avant de lacher, pas apres.
  const preview = useMemo(() => {
    if (!drag) return layout
    return moveCard(layout, drag.id, drag.target.x, drag.target.y)
  }, [layout, drag])

  const visible = preview.filter(c => c.visible)
  const hidden = preview.filter(c => !c.visible)
  const rowCount = Math.max(rows(preview), 1)

  const metrics = useCallback(() => {
    const width = gridRef.current?.clientWidth ?? 0
    const col = (width - GAP * (COLUMNS - 1)) / COLUMNS
    return { col, unitX: col + GAP, unitY: ROW_H + GAP }
  }, [])

  // Les ecouteurs vivent sur window : relacher le doigt hors de la grille
  // doit terminer le geste, pas le laisser coince.
  useEffect(() => {
    if (!drag) return

    const rtl = getComputedStyle(document.documentElement).direction === 'rtl'

    function onMove(event: PointerEvent) {
      if (event.pointerId !== drag!.pointerId) return
      const grid = gridRef.current
      if (!grid) return

      const rect = grid.getBoundingClientRect()
      const { col, unitX, unitY } = metrics()

      const dx = event.clientX - drag!.originX
      const dy = event.clientY - drag!.originY

      // Coin de la carte a l'ecran, ramene dans le repere de la grille.
      const cornerX = event.clientX - drag!.grabX
      const cornerY = event.clientY - drag!.grabY
      const localX = rtl ? rect.right - cornerX - col : cornerX - rect.left
      const localY = cornerY - rect.top

      const card = layout.find(c => c.id === drag!.id)!
      const x = Math.max(0, Math.min(Math.round(localX / unitX), COLUMNS - card.w))
      const y = Math.max(0, Math.round(localY / unitY))

      setDrag(d => (d ? { ...d, dx, dy, target: { x, y } } : d))
    }

    function finish(event: PointerEvent) {
      if (event.pointerId !== drag!.pointerId) return
      onChange(moveCard(layout, drag!.id, drag!.target.x, drag!.target.y))
      setDrag(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [drag, layout, metrics, onChange])

  // Redimensionnement au pointeur.
  useEffect(() => {
    if (!resizing) return
    const spec = specs[resizing]
    if (!spec) return

    function onMove(event: PointerEvent) {
      const grid = gridRef.current
      if (!grid) return
      const rect = grid.getBoundingClientRect()
      const { unitX, unitY } = metrics()
      const card = layout.find(c => c.id === resizing)!
      const rtl = getComputedStyle(document.documentElement).direction === 'rtl'
      const edgeX = rtl ? rect.right - event.clientX : event.clientX - rect.left
      const w = Math.round(edgeX / unitX) - card.x
      const h = Math.round((event.clientY - rect.top) / unitY) - card.y
      if (w !== card.w || h !== card.h) onChange(resizeCard(layout, resizing!, w, h, spec!))
    }
    function finish() { setResizing(null) }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [resizing, layout, specs, metrics, onChange])

  function grab(event: React.PointerEvent, card: CardPlacement) {
    if (!editing) return
    event.preventDefault()
    const cell = (event.currentTarget as HTMLElement).closest('.gf-cell') as HTMLElement | null
    if (!cell) return
    const rect = cell.getBoundingClientRect()
    setDrag({
      id: card.id,
      pointerId: event.pointerId,
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
      originX: event.clientX,
      originY: event.clientY,
      dx: 0, dy: 0,
      target: { x: card.x, y: card.y },
    })
  }

  /** Le clavier doit pouvoir tout faire : le glisser ne peut pas etre le seul chemin. */
  function onKey(event: React.KeyboardEvent, card: CardPlacement) {
    const spec = specs[card.id]
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }
    const delta = moves[event.key]
    if (!delta) return
    event.preventDefault()
    if (event.shiftKey && spec) {
      onChange(resizeCard(layout, card.id, card.w + delta[0], card.h + delta[1], spec))
    } else {
      onChange(moveCard(layout, card.id, card.x + delta[0], card.y + delta[1]))
    }
  }

  return (
    <>
      <div
        ref={gridRef}
        className="gf-grid"
        data-editing={editing ? 'true' : undefined}
        style={{
          gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
          gridAutoRows: `${ROW_H}px`,
          gap: `${GAP}px`,
          ['--row-h' as string]: `${ROW_H}px`,
          minHeight: rowCount * (ROW_H + GAP),
        }}
      >
        {/* Empreinte de destination : on voit ou la carte va atterrir. */}
        {drag && (() => {
          const card = preview.find(c => c.id === drag.id)!
          return (
            <div
              className="gf-ghost"
              aria-hidden="true"
              style={{
                gridColumn: `${card.x + 1} / span ${card.w}`,
                gridRow: `${card.y + 1} / span ${card.h}`,
              }}
            />
          )
        })()}

        {visible.map(card => {
          const dragged = drag?.id === card.id
          return (
            <section
              key={card.id}
              className="gf-cell"
              data-dragging={dragged ? 'true' : undefined}
              data-settling={drag && !dragged ? 'true' : undefined}
              aria-label={labelFor(card.id)}
              style={{
                gridColumn: `${card.x + 1} / span ${card.w}`,
                gridRow: `${card.y + 1} / span ${card.h}`,
                // Pendant le glisser, la carte reste dans sa cellule d'origine
                // et n'est deplacee que visuellement.
                transform: dragged ? `translate3d(${drag!.dx}px, ${drag!.dy}px, 0)` : undefined,
              }}
            >
              {editing && (
                <div className="gf-chrome">
                  <button
                    type="button"
                    className="gf-handle"
                    onPointerDown={e => grab(e, card)}
                    onKeyDown={e => onKey(e, card)}
                    aria-label={`Deplacer ${labelFor(card.id)}. Fleches pour deplacer, Maj + fleches pour redimensionner.`}
                  >
                    <GripVertical size={15} strokeWidth={2.2} />
                  </button>
                  <span className="gf-chrome-title">{labelFor(card.id)}</span>
                  <button
                    type="button"
                    className="gf-hide"
                    onClick={() => onChange(layout.map(c =>
                      c.id === card.id ? { ...c, visible: false } : c))}
                    aria-label={`Masquer ${labelFor(card.id)}`}
                  >
                    <X size={14} strokeWidth={2.4} />
                  </button>
                </div>
              )}

              <div className="gf-body">{renderCard(card.id)}</div>

              {editing && (
                <button
                  type="button"
                  className="gf-resize"
                  aria-label={`Redimensionner ${labelFor(card.id)}`}
                  onPointerDown={e => { e.preventDefault(); e.stopPropagation(); setResizing(card.id) }}
                  onKeyDown={e => onKey(e, card)}
                />
              )}
            </section>
          )
        })}
      </div>

      {editing && hidden.length > 0 && (
        <div className="gf-tray">
          <span className="gf-tray-label">Cartes masquees</span>
          <div className="gf-tray-items">
            {hidden.map(card => (
              <button
                key={card.id}
                type="button"
                className="gf-tray-btn"
                onClick={() => onChange(moveCard(
                  layout.map(c => (c.id === card.id ? { ...c, visible: true } : c)),
                  card.id, 0, 999,
                ))}
              >
                <Plus size={13} strokeWidth={2.4} /> {labelFor(card.id)}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
