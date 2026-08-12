// Disposition du tableau de bord d'un club.
//
// Le mode modification deplace des CARTES sur une grille, il ne positionne
// pas des pixels. Ce choix preserve trois choses qu'un canvas libre casse :
// l'affichage sur telephone (les cartes se replient en colonne), le miroir
// RTL en arabe, et la possibilite d'ajouter des fonctionnalites plus tard
// sans entrer en collision avec la disposition de chaque club.
//
// La disposition n'est jamais stockee telle quelle : elle est reconstruite a
// partir de ce registre. Un JSON envoye par le client ne peut donc pas
// introduire une carte inconnue, un identifiant arbitraire, ni des
// dimensions absurdes.

export const GRID_COLUMNS = 12

/** Cartes disponibles, avec leurs contraintes de taille. */
export const CARD_REGISTRY = {
  members_total:    { minW: 2, maxW: 4,  minH: 1, maxH: 2 },
  members_active:   { minW: 2, maxW: 4,  minH: 1, maxH: 2 },
  subs_expiring:    { minW: 2, maxW: 4,  minH: 1, maxH: 2 },
  insurance_missing:{ minW: 2, maxW: 4,  minH: 1, maxH: 2 },
  revenue_month:    { minW: 2, maxW: 4,  minH: 1, maxH: 2 },
  alerts_unread:    { minW: 2, maxW: 4,  minH: 1, maxH: 2 },
  growth_chart:     { minW: 4, maxW: 12, minH: 2, maxH: 5 },
  revenue_chart:    { minW: 4, maxW: 12, minH: 2, maxH: 5 },
  grade_progress:   { minW: 3, maxW: 8,  minH: 2, maxH: 5 },
  recent_members:   { minW: 3, maxW: 8,  minH: 2, maxH: 6 },
  upcoming_grades:  { minW: 3, maxW: 8,  minH: 2, maxH: 6 },
  branch_split:     { minW: 3, maxW: 8,  minH: 2, maxH: 5 },
} as const

export type CardId = keyof typeof CARD_REGISTRY

export interface CardPlacement {
  id: CardId
  x: number
  y: number
  w: number
  h: number
  visible: boolean
}

export function isCardId(v: unknown): v is CardId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CARD_REGISTRY, v)
}

/** Disposition livree a un club qui n'a rien personnalise. */
export function defaultLayout(): CardPlacement[] {
  return [
    { id: 'members_total',     x: 0, y: 0, w: 3, h: 1, visible: true },
    { id: 'members_active',    x: 3, y: 0, w: 3, h: 1, visible: true },
    { id: 'subs_expiring',     x: 6, y: 0, w: 3, h: 1, visible: true },
    { id: 'alerts_unread',     x: 9, y: 0, w: 3, h: 1, visible: true },
    { id: 'growth_chart',      x: 0, y: 1, w: 8, h: 3, visible: true },
    { id: 'upcoming_grades',   x: 8, y: 1, w: 4, h: 3, visible: true },
    { id: 'revenue_month',     x: 0, y: 4, w: 3, h: 1, visible: true },
    { id: 'insurance_missing', x: 3, y: 4, w: 3, h: 1, visible: true },
    { id: 'recent_members',    x: 6, y: 4, w: 6, h: 3, visible: true },
    { id: 'revenue_chart',     x: 0, y: 5, w: 6, h: 3, visible: false },
    { id: 'grade_progress',    x: 0, y: 5, w: 6, h: 3, visible: false },
    { id: 'branch_split',      x: 0, y: 5, w: 6, h: 3, visible: false },
  ]
}

export class LayoutError extends Error {}

const MAX_ROWS = 60

/**
 * Valide et normalise une disposition recue du client.
 *
 * Tout est reconstruit champ par champ : les cartes inconnues sont rejetees,
 * les tailles ramenees dans les bornes du registre, les positions bornees a
 * la grille. Une carte absente de l'envoi reprend sa place par defaut, et
 * une carte en double est refusee.
 */
export function parseLayout(input: unknown): CardPlacement[] {
  if (!Array.isArray(input)) throw new LayoutError('La disposition doit etre une liste')
  if (input.length > Object.keys(CARD_REGISTRY).length) {
    throw new LayoutError('Trop d elements dans la disposition')
  }

  const seen = new Set<CardId>()
  const placed: CardPlacement[] = []

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') throw new LayoutError('Element de disposition invalide')
    const row = raw as Record<string, unknown>

    if (!isCardId(row.id)) throw new LayoutError(`Carte inconnue : ${String(row.id)}`)
    if (seen.has(row.id)) throw new LayoutError(`Carte en double : ${row.id}`)
    seen.add(row.id)

    const spec = CARD_REGISTRY[row.id]
    const w = clampInt(row.w, spec.minW, spec.maxW)
    const h = clampInt(row.h, spec.minH, spec.maxH)
    const x = clampInt(row.x, 0, GRID_COLUMNS - w)
    const y = clampInt(row.y, 0, MAX_ROWS)

    placed.push({ id: row.id, x, y, w, h, visible: row.visible !== false })
  }

  // Les cartes non mentionnees restent disponibles, masquees.
  for (const card of defaultLayout()) {
    if (!seen.has(card.id)) placed.push({ ...card, visible: false })
  }

  return placed
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' ? Math.round(v) : Number.NaN
  if (!Number.isFinite(n)) throw new LayoutError('Coordonnee invalide')
  return Math.min(Math.max(n, min), max)
}
