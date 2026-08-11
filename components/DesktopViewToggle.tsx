'use client'
// components/DesktopViewToggle.tsx
// Bascule « Vue PC » sur téléphone : fixe la largeur du viewport à 1280 px.
// Le navigateur affiche alors la mise en page ORDINATEUR, ajustée à l'écran,
// que l'on parcourt au doigt et que l'on agrandit par pincement — comme le
// « Site pour ordinateur » de Chrome.
//
// Pourquoi ça marche : toutes les règles CSS mobiles sont en
// `@media (max-width: 767px)`. Avec un viewport à 1280 px elles ne
// s'appliquent plus → rendu identique au PC, rien n'est masqué ni tronqué.
//
// Deux pièges, corrigés ici :
//   1. PAS d'`initial-scale` : le navigateur ajuste seul 1280 px à la
//      largeur de l'écran. Le calculer soi-même est faux dès le 2ᵉ passage,
//      car `window.innerWidth` vaut alors 1280 (et non la largeur réelle du
//      téléphone) → l'échelle retombait à 1, donc pas de dézoom.
//   2. Next.js réécrit la balise viewport à chaque navigation côté client :
//      un MutationObserver la remet en place tant que la vue PC est active.
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Monitor, Smartphone } from 'lucide-react'

export const DESKTOP_VIEW_KEY = 'gymflow:desktop-view'
export const DESKTOP_WIDTH = 1280
export const MOBILE_VIEWPORT = 'width=device-width, initial-scale=1'

// L'échelle est calculée depuis `screen.width` : c'est la largeur PHYSIQUE de
// l'écran, que la balise viewport ne modifie jamais. `window.innerWidth`, lui,
// vaut 1280 dès que la vue PC est active — s'en servir donnait une échelle de
// 1 (aucun dézoom) à chaque réapplication.
//
// L'`initial-scale` est indispensable : sans lui, quand Next.js réinitialise
// la balise et qu'on la restaure, le navigateur GARDE le zoom courant (100 %)
// au lieu de réajuster → mise en page PC affichée en grand, donc coupée.
function desktopViewport(): string {
  const screenWidth = (typeof screen !== 'undefined' && screen.width) || window.innerWidth || 390
  const scale = Math.min(1, screenWidth / DESKTOP_WIDTH)
  return `width=${DESKTOP_WIDTH}, initial-scale=${scale.toFixed(4)}`
}

function setViewport(content: string) {
  const meta = document.querySelector('meta[name="viewport"]')
  if (meta && meta.getAttribute('content') !== content) meta.setAttribute('content', content)
}

export default function DesktopViewToggle() {
  const [desktop, setDesktop] = useState(false)
  const [ready, setReady] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    setDesktop(localStorage.getItem(DESKTOP_VIEW_KEY) === '1')
    setReady(true)
  }, [])

  // Maintient le viewport voulu, y compris après une navigation : Next.js
  // réinjecte sa propre balise et faisait perdre la vue PC à chaque page.
  useEffect(() => {
    if (!ready) return
    if (!desktop) { setViewport(MOBILE_VIEWPORT); return }

    const enforce = () => setViewport(desktopViewport())
    enforce()
    const observer = new MutationObserver(enforce)
    observer.observe(document.head, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['content'],
    })
    // La rotation change `screen.width` : l'échelle doit être recalculée.
    window.addEventListener('orientationchange', enforce)
    return () => { observer.disconnect(); window.removeEventListener('orientationchange', enforce) }
  }, [ready, desktop, pathname])

  const toggle = () => {
    const next = !desktop
    localStorage.setItem(DESKTOP_VIEW_KEY, next ? '1' : '0')
    setDesktop(next)
    window.scrollTo(0, 0)
  }

  if (!ready) return null

  return (
    <button
      onClick={toggle}
      className="viewmode-fab"
      title={desktop ? 'Revenir à la vue téléphone' : 'Vue ordinateur : tout voir en faisant défiler et en zoomant'}
      aria-label={desktop ? 'Vue téléphone' : 'Vue ordinateur'}
    >
      {desktop ? <Smartphone size={16} strokeWidth={2.2} /> : <Monitor size={16} strokeWidth={2.2} />}
      <span>{desktop ? 'Mobile' : 'Vue PC'}</span>
    </button>
  )
}
