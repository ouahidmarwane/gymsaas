// Disposition des ecrans d'un club.
//
// Le mode modification deplace des CARTES sur une grille, il ne positionne
// pas des pixels. Ce choix preserve trois choses qu'un canvas libre casse :
// l'affichage sur telephone (les cartes se replient en colonne), le miroir
// RTL en arabe, et la possibilite d'ajouter des fonctionnalites plus tard
// sans entrer en collision avec la disposition de chaque club.
//
// Chaque ecran a son propre catalogue et sa propre disposition, rangee sous
// une cle distincte. Une carte n'est proposee que la ou elle a un sens : le
// chiffre d'affaires n'a rien a faire dans l'ecran des championnats.
//
// La disposition n'est jamais stockee telle quelle : elle est reconstruite a
// partir du catalogue. Un JSON envoye par le client ne peut donc pas
// introduire une carte inconnue, un identifiant arbitraire, ni des
// dimensions absurdes.

export const GRID_COLUMNS = 12

export interface CardSpec {
  minW: number; maxW: number; minH: number; maxH: number
  /** Libelle propose dans la palette. */
  label: string
  /** Regroupement dans le catalogue. */
  group: string
  /** Carte reservee aux clubs qui notent des grades. */
  needsGrading?: boolean
}

const stat = (label: string, group: string, needsGrading?: boolean): CardSpec =>
  ({ minW: 2, maxW: 6, minH: 1, maxH: 2, label, group, needsGrading })
const panel = (label: string, group: string, needsGrading?: boolean): CardSpec =>
  ({ minW: 3, maxW: 12, minH: 2, maxH: 6, label, group, needsGrading })

/** Catalogue complet, par ecran. */
export const PAGE_CARDS = {
  dashboard: {
    members_total:     stat('Membres', 'Chiffres'),
    members_active:    stat('Membres actifs', 'Chiffres'),
    subs_expiring:     stat('A renouveler', 'Chiffres'),
    insurance_missing: stat('Assurances manquantes', 'Chiffres'),
    revenue_month:     stat('Recette du mois', 'Chiffres'),
    alerts_unread:     stat('Alertes', 'Chiffres'),
    growth_chart:      panel('Croissance', 'Graphiques'),
    revenue_chart:     panel('Recettes', 'Graphiques'),
    grade_progress:    panel('Progression des grades', 'Graphiques', true),
    branch_split:      panel('Repartition par salle', 'Graphiques'),
    recent_members:    panel('Derniers inscrits', 'Listes'),
    upcoming_grades:   panel('Passages a venir', 'Listes', true),
  },
  members: {
    members_total:     stat('Membres', 'Chiffres'),
    members_active:    stat('Membres actifs', 'Chiffres'),
    subs_expiring:     stat('A renouveler', 'Chiffres'),
    insurance_missing: stat('Assurances manquantes', 'Chiffres'),
    recent_members:    panel('Derniers inscrits', 'Listes'),
    branch_split:      panel('Repartition par salle', 'Graphiques'),
  },
  comptabilite: {
    revenue_month:  stat('Recette du mois', 'Chiffres'),
    members_active: stat('Membres actifs', 'Chiffres'),
    revenue_chart:  panel('Recettes', 'Graphiques'),
    branch_split:   panel('Repartition par salle', 'Graphiques'),
  },
  grades: {
    grade_progress:  panel('Progression des grades', 'Graphiques', true),
    upcoming_grades: panel('Passages a venir', 'Listes', true),
    members_active:  stat('Membres actifs', 'Chiffres'),
  },
  championships: {
    members_active:  stat('Membres actifs', 'Chiffres'),
    grade_progress:  panel('Progression des grades', 'Graphiques', true),
    recent_members:  panel('Derniers inscrits', 'Listes'),
  },
} as const

export type PageKey = keyof typeof PAGE_CARDS
export const PAGE_KEYS = Object.keys(PAGE_CARDS) as PageKey[]

export function isPageKey(v: string): v is PageKey {
  return Object.prototype.hasOwnProperty.call(PAGE_CARDS, v)
}

export function cardsFor(page: PageKey): Record<string, CardSpec> {
  return PAGE_CARDS[page] as unknown as Record<string, CardSpec>
}

export interface CardPlacement {
  id: string
  x: number
  y: number
  w: number
  h: number
  visible: boolean
}

/** Cle de rangement de la disposition d'un ecran. */
export const layoutKey = (page: PageKey) => `layout:${page}`

/** Dispositions livrees a un club qui n'a rien personnalise. */
const DEFAULTS: Record<PageKey, CardPlacement[]> = {
  dashboard: [
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
  ],
  // Les autres ecrans demarrent sans bandeau : leur contenu principal est la
  // liste ou le tableau en dessous, pas les cartes.
  members: [
    { id: 'members_total',     x: 0, y: 0, w: 3, h: 1, visible: true },
    { id: 'subs_expiring',     x: 3, y: 0, w: 3, h: 1, visible: true },
    { id: 'insurance_missing', x: 6, y: 0, w: 3, h: 1, visible: true },
    { id: 'members_active',    x: 9, y: 0, w: 3, h: 1, visible: false },
    { id: 'recent_members',    x: 0, y: 1, w: 6, h: 3, visible: false },
    { id: 'branch_split',      x: 6, y: 1, w: 6, h: 3, visible: false },
  ],
  // La comptabilite porte deja ses propres indicateurs : afficher en plus la
  // recette du mois ferait doublon des le premier coup d'oeil. Les cartes
  // restent au catalogue pour qui veut les ajouter.
  comptabilite: [
    { id: 'revenue_month',  x: 0, y: 0, w: 4, h: 1, visible: false },
    { id: 'members_active', x: 4, y: 0, w: 4, h: 1, visible: false },
    { id: 'revenue_chart',  x: 0, y: 1, w: 12, h: 3, visible: false },
    { id: 'branch_split',   x: 0, y: 1, w: 6, h: 3, visible: false },
  ],
  grades: [
    { id: 'members_active',  x: 0, y: 0, w: 4, h: 1, visible: true },
    { id: 'grade_progress',  x: 4, y: 0, w: 8, h: 3, visible: true },
    { id: 'upcoming_grades', x: 0, y: 3, w: 6, h: 3, visible: false },
  ],
  championships: [
    { id: 'members_active', x: 0, y: 0, w: 4, h: 1, visible: true },
    { id: 'grade_progress', x: 0, y: 1, w: 6, h: 3, visible: false },
    { id: 'recent_members', x: 6, y: 1, w: 6, h: 3, visible: false },
  ],
}

export function defaultLayout(page: PageKey): CardPlacement[] {
  return DEFAULTS[page].map(c => ({ ...c }))
}

export class LayoutError extends Error {}

const MAX_ROWS = 60

/**
 * Valide et normalise une disposition recue du client.
 *
 * Tout est reconstruit champ par champ, contre le catalogue de CET ecran :
 * une carte valide ailleurs mais absente ici est rejetee. Les tailles sont
 * ramenees dans les bornes, les positions bornees a la grille, une carte
 * absente reprend sa place par defaut, une carte en double est refusee.
 */
export function parseLayout(page: PageKey, input: unknown): CardPlacement[] {
  const catalogue = cardsFor(page)
  if (!Array.isArray(input)) throw new LayoutError('La disposition doit etre une liste')
  if (input.length > Object.keys(catalogue).length) {
    throw new LayoutError('Trop d elements dans la disposition')
  }

  const seen = new Set<string>()
  const placed: CardPlacement[] = []

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') throw new LayoutError('Element de disposition invalide')
    const row = raw as Record<string, unknown>
    const id = row.id

    if (typeof id !== 'string' || !catalogue[id]) {
      throw new LayoutError(`Carte inconnue sur cet ecran : ${String(id)}`)
    }
    if (seen.has(id)) throw new LayoutError(`Carte en double : ${id}`)
    seen.add(id)

    const spec = catalogue[id]!
    const w = clampInt(row.w, spec.minW, spec.maxW)
    const h = clampInt(row.h, spec.minH, spec.maxH)
    const x = clampInt(row.x, 0, GRID_COLUMNS - w)
    const y = clampInt(row.y, 0, MAX_ROWS)

    placed.push({ id, x, y, w, h, visible: row.visible !== false })
  }

  for (const card of defaultLayout(page)) {
    if (!seen.has(card.id)) placed.push({ ...card, visible: false })
  }

  return placed
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' ? Math.round(v) : Number.NaN
  if (!Number.isFinite(n)) throw new LayoutError('Coordonnee invalide')
  return Math.min(Math.max(n, min), max)
}
