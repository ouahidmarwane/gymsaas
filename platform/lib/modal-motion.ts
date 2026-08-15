'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Ouverture et fermeture des fenetres modales.
 *
 * OUVERTURE — la carte grandit depuis l'endroit exact ou l'on vient de
 * cliquer. Ouvrir la fiche de la quatrieme ligne d'un tableau et la voir
 * naitre de cette ligne dit, sans un mot, de quoi la fenetre parle. Une
 * carte qui apparait au centre oblige a refaire le lien soi-meme.
 *
 * On ne transmet pas la position en propriete : il y a une quinzaine de
 * modales, ouvertes depuis des boutons, des lignes de tableau, des menus.
 * La derniere position du pointeur est captee une fois pour toutes au niveau
 * du document, et chaque carte la traduit en point d'origine relatif a
 * elle-meme au moment ou elle se pose.
 *
 * FERMETURE — React demonte au changement d'etat : sans delai, l'animation
 * de sortie n'a jamais lieu, l'element disparait avant sa premiere image. Le
 * composant reste donc monte, marque `closing`, et previent son parent
 * ensuite.
 */

/** Derniere position du pointeur, en coordonnees de fenetre. */
let lastPointer: { x: number; y: number; at: number } | null = null

if (typeof document !== 'undefined') {
  // En capture : un `stopPropagation` sur le bouton qui ouvre la modale ne
  // doit pas nous priver de la position.
  document.addEventListener('pointerdown', event => {
    lastPointer = { x: event.clientX, y: event.clientY, at: Date.now() }
  }, true)
}

/** Au-dela, le clic n'a plus rien a voir avec cette ouverture. */
const POINTER_TTL_MS = 1500

export function useModalMotion(onClose: () => void, ms = 200) {
  const [closing, setClosing] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // useLayoutEffect : le point d'origine doit etre pose avant la premiere
  // image, sinon la carte demarre son animation depuis son centre puis
  // corrige — ce qui se voit.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card || !lastPointer) return
    // Ouverture au clavier, ou clic trop ancien : le centre reste le defaut
    // honnete. Faire naitre la carte d'un clic sans rapport serait pire que
    // de ne rien viser.
    if (Date.now() - lastPointer.at > POINTER_TTL_MS) return

    const r = card.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return

    // Un point hors de la carte est legitime — il indique une direction —
    // mais borne : depuis l'autre bout de l'ecran, la carte semblerait
    // glisser plutot que grandir.
    const clamp = (v: number) => Math.max(-120, Math.min(220, v))
    const x = clamp(((lastPointer.x - r.left) / r.width) * 100)
    const y = clamp(((lastPointer.y - r.top) / r.height) * 100)
    card.style.transformOrigin = `${x.toFixed(1)}% ${y.toFixed(1)}%`
  }, [])

  const dismiss = useCallback(() => {
    // Entre le clic et le demontage, le fond reste cliquable : sans ce
    // verrou, deux fermetures en vol appelleraient deux fois `onClose`,
    // dont une sur un composant deja parti.
    if (timer.current) return
    const reduced = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setClosing(true)
    timer.current = setTimeout(onClose, reduced ? 0 : ms)
  }, [onClose, ms])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // Echap ferme, avec la meme animation que la croix.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [dismiss])

  return {
    closing,
    dismiss,
    cardRef,
    /** A poser sur le voile de fond, en plus de sa classe habituelle. */
    overlayClass: closing ? ' is-closing' : '',
  }
}
