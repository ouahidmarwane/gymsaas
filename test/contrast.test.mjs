// Lisibilite des habillages, calculee et non constatee a l'oeil.
//
// Cinq palettes multipliees par une dizaine de surfaces font cinquante
// couples texte/fond : les verifier de visu, c'est en oublier. Ce test lit
// les variables dans la feuille de style, compose les couches translucides
// sur leur fond et calcule le rapport de contraste WCAG.
//
// Il ne demande aucun serveur : c'est une lecture de fichier.
//
//   node --test test/contrast.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * La feuille, commentaires retires.
 *
 * Sans cela, une phrase de commentaire mentionnant « --bg : » etait lue
 * comme une declaration : le lecteur prenait le texte du commentaire pour la
 * valeur du jeton, ecrasait la vraie, et le test echouait en accusant une
 * couleur illisible. La cause etait a trois cents lignes de la, dans une
 * phrase en francais. Un lecteur naif de CSS doit au moins ignorer ce que
 * CSS lui-meme ignore.
 */
const CSS = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** Bloc qui DEFINIT la palette — pas le premier portant ce selecteur. */
function block(selector, from = 0) {
  const i = CSS.indexOf(selector, from)
  if (i === -1) return null
  const open = CSS.indexOf('{', i)
  let depth = 0, j = open
  for (; j < CSS.length; j++) {
    if (CSS[j] === '{') depth++
    else if (CSS[j] === '}') { depth--; if (depth === 0) break }
  }
  const out = {}
  for (const m of CSS.slice(open + 1, j).matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim()
  }
  // html[data-theme='light'] apparait d'abord pour un simple color-scheme.
  return out['--bg'] ? out : block(selector, j)
}

const root = block(':root {')

const PALETTES = {
  sombre: {},
  clair: block("html[data-theme='light'] {"),
  chaleureux: block("html[data-skin='chaleureux'] {"),
  sport: block("html[data-skin='sport'] {"),
  tatami: block("html[data-skin='tatami'] {"),
}

function parse(color) {
  const c = color.trim()
  let m = c.match(/^#([0-9a-f]{6})$/i)
  if (m) return [0, 2, 4].map(k => parseInt(m[1].slice(k, k + 2), 16)).concat(1)
  m = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/)
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
  return null
}

/** Premiere couleur d'un degrade : celle du haut de la carte, ou vivent les titres. */
function firstColor(value) {
  const m = value.match(/#[0-9a-f]{6}|rgba?\([^)]*\)/i)
  return m ? parse(m[0]) : null
}

const over = (fg, bg) => fg[3] >= 1
  ? fg
  : [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1)

function luminance([r, g, b]) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(fg, bg) {
  const [a, b] = [luminance(over(fg, bg)), luminance(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

test('les cinq habillages sont declares', () => {
  for (const [name, palette] of Object.entries(PALETTES)) {
    assert.ok(palette, `palette introuvable pour ${name}`)
  }
})

/**
 * Une surface ne se peint pas en fonction du MODE.
 *
 * Le tableau des membres portait deux couleurs ecrites en dur : un bleu
 * clair sous `data-theme='light'`, un bleu nuit sous
 * `:not([data-theme='light'])`. Mais « pas clair » regroupe quatre
 * habillages aux palettes distinctes, qui recevaient donc tous le meme bleu
 * marine — le beige de « chaleureux » et le vert de « sport » s'arretaient
 * au bord du tableau.
 *
 * Le mode dit s'il fait clair ou sombre ; l'habillage dit quelle couleur.
 * Une surface se peint donc en jetons, jamais en litteral sous un selecteur
 * de mode. Ce test garde les classes vivantes de l'ecran des membres.
 */
test('les surfaces de l ecran membres ne sont pas peintes par mode', () => {
  const GUARDED = [
    'members-page-table', 'members-page-table-head', 'members-row',
    'members-search-input', 'mdet-', 'docview',
  ]

  const offenders = []
  // Un bloc = tout ce qui precede une accolade fermante, selecteur compris.
  for (const chunk of CSS.split('}')) {
    const open = chunk.lastIndexOf('{')
    if (open === -1) continue
    const selector = chunk.slice(0, open)
    const body = chunk.slice(open + 1)

    if (!selector.includes('data-theme')) continue
    if (!GUARDED.some(cls => selector.includes(cls))) continue

    for (const m of body.matchAll(/(?:^|[;\s])(background|background-color)\s*:\s*([^;]+)/g)) {
      const value = m[2].trim()
      // `none`, `transparent` et `inherit` ne portent pas de couleur.
      if (/^(none|transparent|inherit|initial|unset)\b/.test(value)) continue
      if (value.includes('var(')) continue
      offenders.push(`${selector.trim().split('\n').pop().trim()} → ${value}`)
    }
  }

  assert.deepEqual(offenders, [],
    `Couleur ecrite en dur sous un selecteur de mode :\n  ${offenders.join('\n  ')}`)
})

test('aucun jeton ne se refere a lui-meme', () => {
  // Une passe de remplacement automatique a deja transforme
  // « --card-border: rgba(...) » en « --card-border: var(--card-border) ».
  // La variable ne vaut alors plus rien et la bordure disparait, sans que
  // rien n'echoue au build.
  for (const m of CSS.matchAll(/(--[a-z-]+)\s*:\s*var\((--[a-z-]+)\)/g)) {
    assert.notEqual(m[1], m[2], `${m[1]} se refere a lui-meme`)
  }
})

for (const [name, palette] of Object.entries(PALETTES)) {
  test(`habillage « ${name} » : tout reste lisible`, () => {
    const t = { ...root, ...(palette ?? {}) }
    const bg = parse(t['--bg'])
    assert.ok(bg, `--bg illisible pour ${name}`)

    const surfaces = {
      fond: bg,
      carte: over(firstColor(t['--card-bg']), bg),
      panneau: over(firstColor(t['--panel-bg']), bg),
      rail: over(firstColor(t['--rail-bg']), bg),
      flottant: over(parse(t['--float-bg']), bg),
    }

    // Texte courant : 4.5. En dessous, un chiffre de tableau de bord se
    // devine plutot qu'il ne se lit.
    for (const [where, surface] of Object.entries(surfaces)) {
      for (const [role, token] of [['principal', '--text'], ['secondaire', '--muted']]) {
        const ink = parse(t[token])
        assert.ok(ink, `${token} illisible pour ${name}`)
        const ratio = contrast(ink, surface)
        assert.ok(ratio >= 4.5,
          `${name} : texte ${role} sur ${where} = ${ratio.toFixed(2)}, minimum 4.5`)
      }
    }

    // Les montants encaisses sont verts : un vert clair sur fond clair est
    // exactement le piege que ce test existe pour attraper.
    const ratio = contrast(parse(t['--positive']), surfaces.carte)
    assert.ok(ratio >= 4.5, `${name} : montant sur carte = ${ratio.toFixed(2)}, minimum 4.5`)

    // Une bordure doit se distinguer de la surface qu'elle borde, sinon la
    // carte n'a plus de contour du tout.
    const border = contrast(over(parse(t['--card-border']), surfaces.carte), surfaces.carte)
    assert.ok(border >= 1.15, `${name} : bordure de carte invisible (${border.toFixed(2)})`)
  })
}
