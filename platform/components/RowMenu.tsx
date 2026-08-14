'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

/**
 * Menu « ⋯ » d'une ligne de tableau.
 *
 * Pourquoi un portail et une position fixe plutot qu'un simple `absolute` :
 * le tableau vit dans un conteneur `overflow-x: auto`, indispensable sur
 * petit ecran. Or des qu'un axe deborde en `auto`, l'autre cesse d'etre
 * `visible` — le menu se faisait donc rogner par le bas du conteneur et
 * passait derriere les lignes suivantes. Aucun z-index n'y change rien : le
 * conteneur decoupe avant que l'empilement n'entre en jeu.
 *
 * Rendu dans <body>, ancre aux coordonnees du bouton, il echappe au
 * decoupage. Contrepartie : ces coordonnees vieillissent des que la page
 * bouge, donc tout defilement le referme.
 */
export default function RowMenu({ children, label = 'Plus d’actions', width = 200 }: {
  /** Recoit la fermeture : chaque action referme le menu en la rappelant. */
  children: (close: () => void) => ReactNode
  label?: string
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  // useLayoutEffect : positionne avant la peinture, sinon le menu apparait
  // une image dans le coin superieur gauche avant de sauter a sa place.
  useLayoutEffect(() => {
    if (!open || !trigger.current) return
    const r = trigger.current.getBoundingClientRect()
    const height = panel.current?.offsetHeight ?? 160
    const gap = 6

    // Sous le bouton par defaut ; au-dessus s'il n'y a pas la place, ce qui
    // est le cas des dernieres lignes de tout tableau un peu long.
    const below = r.bottom + gap
    const top = below + height > window.innerHeight - 8
      ? Math.max(8, r.top - gap - height)
      : below
    // Aligne a droite du bouton, sans sortir de la fenetre.
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))
    setSpot({ top, left })
  }, [open, width])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const away = (e: MouseEvent) => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) close()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }

    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    // En capture : le defilement d'un conteneur interne ne remonte pas.
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <>
      <button ref={trigger} className="icon-btn" style={{ width: 30, height: 30 }}
              title={label} aria-label={label} aria-expanded={open} aria-haspopup="menu"
              onClick={() => setOpen(o => !o)}>
        <MoreHorizontal size={15} strokeWidth={2.1} />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div ref={panel} className="row-menu" role="menu"
             style={{ top: spot?.top ?? -9999, left: spot?.left ?? -9999, width }}>
          {children(() => setOpen(false))}
        </div>,
        document.body,
      )}
    </>
  )
}
