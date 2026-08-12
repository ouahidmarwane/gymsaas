import type { CardPlacement, CardSpec } from './client'

export const COLUMNS = 12

/**
 * Tasse les cartes vers le haut, dans l'ordre lecture.
 *
 * Sans cette etape, deplacer une carte laisserait un trou et pourrait en
 * chevaucher une autre. Le tassement rend le resultat previsible : une carte
 * lachee "quelque part en haut a droite" atterrit la ou l'oeil l'attend.
 */
export function compact(layout: CardPlacement[]): CardPlacement[] {
  const visible = layout
    .filter(c => c.visible)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))

  const placed: CardPlacement[] = []

  for (const card of visible) {
    let y = 0
    // Descend jusqu'a la premiere rangee ou la carte ne touche personne.
    while (placed.some(other => overlaps({ ...card, y }, other))) y++
    placed.push({ ...card, y })
  }

  const hidden = layout.filter(c => !c.visible)
  return [...placed, ...hidden]
}

function overlaps(a: CardPlacement, b: CardPlacement): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/** Deplace une carte, puis retasse. Les coordonnees restent dans la grille. */
export function moveCard(
  layout: CardPlacement[], id: string, x: number, y: number,
): CardPlacement[] {
  const moved = layout.map(card =>
    card.id === id
      ? { ...card, x: clamp(x, 0, COLUMNS - card.w), y: Math.max(0, y) }
      : card,
  )
  // La carte deplacee passe en tete a y egal, pour qu'elle prenne la place
  // visee plutot que de se ranger derriere son ancienne voisine.
  const target = moved.find(c => c.id === id)!
  const others = moved.filter(c => c.id !== id)
  return compact([target, ...others])
}

export function resizeCard(
  layout: CardPlacement[], id: string, w: number, h: number, spec: CardSpec,
): CardPlacement[] {
  return compact(layout.map(card => {
    if (card.id !== id) return card
    const nextW = clamp(w, spec.minW, Math.min(spec.maxW, COLUMNS))
    return {
      ...card,
      w: nextW,
      h: clamp(h, spec.minH, spec.maxH),
      x: clamp(card.x, 0, COLUMNS - nextW),
    }
  }))
}

export function toggleCard(layout: CardPlacement[], id: string): CardPlacement[] {
  return compact(layout.map(card =>
    card.id === id ? { ...card, visible: !card.visible, y: card.visible ? card.y : 999 } : card,
  ))
}

export function rows(layout: CardPlacement[]): number {
  return layout.filter(c => c.visible).reduce((max, c) => Math.max(max, c.y + c.h), 1)
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}
