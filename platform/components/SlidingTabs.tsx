'use client'
// Segmented control avec pilule glissante.
//
// La pilule est mesuree en JS (offsetLeft/offsetWidth) et animee en CSS :
// une transition sur `left`/`width` declencherait un reflow a chaque frame,
// alors qu'un translateX reste sur le compositeur.
//
// Premier paint et resize se positionnent sans transition, sinon la pilule
// glisserait depuis l'origine au chargement de la page.
import { useEffect, useRef, type ReactNode } from 'react'

export interface TabItem {
  key: string
  label: ReactNode
}

export default function SlidingTabs({ items, value, onChange, disabled = false }: {
  items: TabItem[]
  value: string
  onChange: (key: string) => void
  disabled?: boolean
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)

  const position = (animate: boolean) => {
    const bar = barRef.current
    const pill = pillRef.current
    if (!bar || !pill) return
    const active = bar.querySelector<HTMLButtonElement>('.t-tab[aria-selected="true"]')
    if (!active) return
    if (!animate) {
      const prev = pill.style.transition
      pill.style.transition = 'none'
      pill.style.transform = `translateX(${active.offsetLeft}px)`
      pill.style.width = `${active.offsetWidth}px`
      void pill.offsetWidth // reflow avant de restaurer la transition
      pill.style.transition = prev
    } else {
      pill.style.transform = `translateX(${active.offsetLeft}px)`
      pill.style.width = `${active.offsetWidth}px`
    }
  }

  useEffect(() => {
    const raf = requestAnimationFrame(() => position(false))
    const onResize = () => position(false)
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { position(true) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  // Repositionnement sans animation quand les onglets eux-memes changent :
  // les salles arrivent apres le chargement, la pilule doit suivre sans
  // donner l'impression que l'utilisateur a clique.
  useEffect(() => { position(false) }, [items]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={barRef} className="t-tabs" role="tablist">
      <span ref={pillRef} className="t-tabs-pill" aria-hidden="true" />
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          role="tab"
          className="t-tab"
          aria-selected={value === item.key ? 'true' : 'false'}
          disabled={disabled}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
