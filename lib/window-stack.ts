'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

/**
 * Pile de fenetres, a la maniere d'un bureau.
 *
 * Le premier essai reposait sur un booleen « devant / derriere » et un
 * z-index fixe. Il suffisait d'ouvrir deux fenetres — une piece d'identite
 * et l'agrandissement de la photo — pour que le modele s'effondre : les deux
 * partageaient la meme valeur, aucune ne pouvait passer devant l'autre, et
 * un clic a cote renvoyait toujours a la fiche du membre plutot qu'a la
 * derniere fenetre utilisee.
 *
 * Ici, chaque fenetre porte SON rang. Cliquer dedans lui donne le rang le
 * plus haut ; les autres gardent le leur, donc leur ordre relatif. C'est
 * exactement ce que fait un gestionnaire de fenetres, et c'est la seule
 * facon d'avoir un ordre coherent au-dela de deux.
 */

// Au-dessus des voiles ordinaires (200) et de l'ancienne visionneuse (500),
// sous la couche de celebration (900) qui, elle, ne se clique pas.
let top = 500

/** Rang d'une fenetre, et le moyen de la remonter. */
export function useWindowZ(): { z: number; raise: () => void } {
  // Le rang initial est pris au montage : une fenetre qui s'ouvre arrive
  // devant celles deja la, comme partout ailleurs.
  const [z, setZ] = useState(() => ++top)

  const raise = useCallback(() => {
    // Deja au sommet : ne rien faire. Sans ce test, chaque clic incrementait
    // le compteur et provoquait un rendu pour rien.
    setZ(prev => (prev === top ? prev : ++top))
  }, [])

  return { z, raise }
}

// Nombre de fenetres flottantes ouvertes ------------------------------------
//
// La fiche du membre doit savoir qu'il y en a, pour cesser de se comporter
// en modale : son voile ne doit plus fermer au clic, et elle doit accepter
// de passer derriere. Elle ne connait pas les visionneuses — ce sont ses
// petites-filles — d'ou ce petit magasin partage plutot qu'un cablage de
// proprietes a travers trois composants.

let openCount = 0
const listeners = new Set<() => void>()

function emit() { for (const l of listeners) l() }

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** A appeler par une fenetre flottante pendant toute sa duree de vie. */
export function useRegisterWindow() {
  useEffect(() => {
    openCount++
    emit()
    return () => { openCount--; emit() }
  }, [])
}

/**
 * Vrai s'il existe au moins une fenetre flottante.
 *
 * useSyncExternalStore plutot qu'un useState + effet : la valeur est lue au
 * rendu, sans image intermediaire ou la fiche se croirait encore seule.
 * Le snapshot serveur rend `false` — il n'y a pas de fenetre a l'hydratation.
 */
export function useHasFloatingWindow(): boolean {
  return useSyncExternalStore(subscribe, () => openCount > 0, () => false)
}
