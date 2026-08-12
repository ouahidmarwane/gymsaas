// Marque d'un club : nom affiche, logo, couleur d'accent.
//
// Stockee dans la ligne organizations du plan de controle, que resolveSession
// lit deja : le club recoit sa marque sans requete supplementaire, et le
// tableau de bord plateforme liste les logos sans ouvrir N bases.
//
// Les valeurs sont reconstruites, jamais reprises telles quelles : une
// couleur est une teinte hexadecimale validee, un logo est une cle R2 dont
// on impose le prefixe. Sans cela, un champ "couleur" contenant
// « red;background:url(...) » finirait injecte dans une variable CSS.

export interface Theme {
  accent: string
  mode: 'light' | 'dark' | 'system'
}

// Le bleu du systeme visuel d'origine (--gold dans globals.css). Un club qui
// ne choisit rien doit ressembler a l'application, pas a une variante.
export const DEFAULT_THEME: Theme = { accent: '#2f6bff', mode: 'system' }

const HEX = /^#[0-9a-f]{6}$/i
const MODES = new Set(['light', 'dark', 'system'])

export class BrandingError extends Error {}

export function parseTheme(input: unknown): Theme {
  if (input === null || input === undefined) return DEFAULT_THEME
  if (typeof input !== 'object') throw new BrandingError('Theme invalide')
  const row = input as Record<string, unknown>

  const accent = row.accent ?? DEFAULT_THEME.accent
  if (typeof accent !== 'string' || !HEX.test(accent)) {
    throw new BrandingError('Couleur invalide : format attendu #RRGGBB')
  }

  const mode = row.mode ?? DEFAULT_THEME.mode
  if (typeof mode !== 'string' || !MODES.has(mode)) {
    throw new BrandingError('Mode invalide : light, dark ou system')
  }

  // Reconstruit, jamais copie : aucune cle supplementaire ne survit.
  return { accent: accent.toLowerCase(), mode: mode as Theme['mode'] }
}

export function readTheme(stored: string | null): Theme {
  if (!stored) return DEFAULT_THEME
  try {
    return parseTheme(JSON.parse(stored))
  } catch {
    return DEFAULT_THEME
  }
}

/**
 * Cle R2 d'un logo. Le prefixe est impose cote serveur et l'identifiant du
 * club y est inscrit : une cle forgee ne peut pas pointer vers le logo d'un
 * autre club ni vers les documents des membres.
 */
export function logoKey(orgId: string, ext: string): string {
  return `org-logos/${orgId}/${Date.now()}.${ext}`
}

export function isOwnLogoKey(orgId: string, key: string): boolean {
  return key.startsWith(`org-logos/${orgId}/`) && !key.includes('..')
}

// Volontairement sans SVG. Un SVG est un document capable de porter du
// script ; servi depuis notre propre origine, il s'executerait avec les
// droits de qui l'ouvre — un administrateur de club pourrait ainsi pieger
// le proprietaire, ou l'exploitant venu en support. Les formats matriciels
// n'ont pas ce pouvoir.
const LOGO_TYPES = /^image\/(png|jpeg|webp)$/
const LOGO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export function logoExtension(contentType: string): string {
  if (!LOGO_TYPES.test(contentType)) throw new BrandingError('Format de logo non autorise')
  return LOGO_EXT[contentType]!
}
