'use client'

import { useEffect } from 'react'

/**
 * Empeche la page de defiler derriere une fenetre modale.
 *
 * Deux raisons, dans cet ordre :
 *
 *  1. La molette au-dessus d'une modale faisait defiler la page derriere.
 *     On lache la souris, la fiche est toujours la, mais le tableau a bouge.
 *
 *  2. Deux barres de defilement s'affichaient en meme temps — celle de la
 *     page et celle de la modale — l'une contre l'autre au bord droit.
 *
 * Le compteur sert aux modales empilees : la visionneuse de piece s'ouvre
 * par-dessus la fiche du membre, et la fermer ne doit pas rendre son
 * defilement a la page pendant que la fiche est encore ouverte.
 *
 * La largeur de la barre est rendue en marge interieure : sans cela, la
 * disparition de la barre elargit la page d'une dizaine de pixels et tout
 * le contenu saute lateralement a l'ouverture.
 */
let depth = 0
let restore = ''

export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return

    if (depth === 0) {
      const body = document.body
      restore = body.style.paddingRight
      const bar = window.innerWidth - document.documentElement.clientWidth
      if (bar > 0) {
        const current = parseFloat(getComputedStyle(body).paddingRight) || 0
        body.style.paddingRight = `${current + bar}px`
      }
      body.style.overflow = 'hidden'
    }
    depth++

    return () => {
      depth--
      if (depth === 0) {
        document.body.style.overflow = ''
        document.body.style.paddingRight = restore
      }
    }
  }, [active])
}
