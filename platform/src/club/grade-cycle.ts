// Cadence des passages de grade.
//
// Les sessions tombent tous les trois mois, sur une grille ancree sur un mois
// choisi par le club. Ancre en septembre — le defaut, celui de la rentree
// sportive marocaine — la grille vaut 1er septembre, 1er decembre, 1er mars,
// 1er juin.
//
// Rien n'est stocke : la prochaine date se deduit du mois d'ancrage et du
// jour ou l'on regarde, comme les echeances d'abonnement. Une date figee en
// base se serait desynchronisee au premier passage de trimestre.
//
// Fonctions pures, sans horloge : la date de depart est un argument. C'est ce
// qui les rend verifiables sans attendre le 1er mars.

/** Trois mois entre deux sessions. */
export const CYCLE_MONTHS = 3

/** A defaut de reglage : la rentree. */
export const DEFAULT_ANCHOR_MONTH = 9

/** Mois d'ancrage valide, ou le defaut. Un reglage abime ne casse pas l'ecran. */
export function anchorMonthOf(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : DEFAULT_ANCHOR_MONTH
}

/** Les quatre dates de la grille pour une annee donnee, en ordre croissant. */
export function gradeGrid(anchorMonth: number, year: number): string[] {
  const out: string[] = []
  for (let k = 0; k < 12 / CYCLE_MONTHS; k++) {
    const month = ((anchorMonth - 1 + k * CYCLE_MONTHS) % 12) + 1
    out.push(`${year}-${String(month).padStart(2, '0')}-01`)
  }
  return out.sort()
}

/**
 * Prochaine date de session, a partir d'un jour donne (incluse).
 *
 * On balaie trois annees et on prend la premiere date de grille qui n'est pas
 * passee. Comparer des chaines « AAAA-MM-JJ » suffit et evite entierement
 * l'arithmetique de dates — c'est la ou se logent les erreurs de fuseau et de
 * mois a trente et un jours.
 */
export function nextGradeDate(anchorMonth: number, fromIso: string): string {
  const from = fromIso.slice(0, 10)
  const year = Number(from.slice(0, 4))
  const all = [
    ...gradeGrid(anchorMonth, year - 1),
    ...gradeGrid(anchorMonth, year),
    ...gradeGrid(anchorMonth, year + 1),
  ].sort()
  return all.find(d => d >= from) ?? all[all.length - 1]!
}

/** Vrai si la date tombe sur la grille du club. Sert a signaler le hors-cycle. */
export function isOnGrid(anchorMonth: number, iso: string): boolean {
  const d = iso.slice(0, 10)
  return gradeGrid(anchorMonth, Number(d.slice(0, 4))).includes(d)
}
