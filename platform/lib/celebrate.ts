'use client'

/**
 * Celebration : confettis, emojis, neon, et le montant qui monte.
 *
 * Canvas et CSS, aucune dependance. Une bibliotheque de confettis pese plus
 * lourd que tout ce fichier, et aucune ne sait lire la couleur d'un theme.
 *
 * LA COULEUR DU NEON VIENT DU THEME, JAMAIS D'UNE CONSTANTE.
 * Elle est relue a CHAQUE appel : un club change sa couleur depuis le panneau
 * de marque sans recharger la page, et une valeur mise en cache au premier
 * appel afficherait ensuite la couleur du club precedent.
 *
 * Le canvas est unique et vit dans <body>. Un canvas par modale se serait
 * fait rogner par le voile de la modale, aurait disparu avec elle au moment
 * meme ou l'animation commence, et se serait empile a chaque ouverture.
 */

/** Jeux d'emojis. Peu actifs par defaut : le neon sature vite. */
export const SETS = {
  fete:    ['🎉', '🎊', '✨', '🥳'],
  sport:   ['💪', '🥋', '🏆', '🔥'],
  argent:  ['💰', '💵', '🧾'],
  accueil: ['👋', '🙌', '⭐'],
} as const

export type SetKey = keyof typeof SETS

/**
 * Corps des confettis. Volontairement independants du theme : un confetti
 * monochrome n'est plus un confetti. Seul le HALO suit l'habillage, ce qui
 * suffit a rattacher l'effet a la couleur du club.
 */
const COLORS = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#06b6d4']

/** Dosage. Moyenne par defaut : le neon monte vite en charge. */
const CONFETTI = { douce: 26, moyenne: 46, forte: 72 }
const EMOJIS = { douce: 7, moyenne: 12, forte: 18 }
const RINGS = 2

const GLOW_MS = 780        // une pulsation, une seule
const AMOUNT_MS = 1100     // duree de la montee du montant
const AMOUNT_RISE = 46     // px parcourus vers le haut
const COUNT_MS = 650       // duree du comptage, plus courte que la montee
const HALO_PARTICLE = 12   // shadowBlur
const HALO_RING = 18

export interface CelebrateOptions {
  /** Origine, en coordonnees de fenetre — le centre du bouton declencheur. */
  x: number
  y: number
  /**
   * Montant en CENTIMES, comme partout ailleurs dans le projet. Omis, aucun
   * chiffre ne s'affiche : mieux vaut pas de montant qu'un montant invente.
   */
  amountCents?: number
  /** Court message a cote du ✓. */
  label?: string
  neon?: boolean
  /** Resolue par l'appelant depuis le theme. A defaut, lue ici. */
  neonColor?: string
  intensity?: keyof typeof CONFETTI
  sets?: SetKey[]
}

/**
 * Couleur d'accent du theme courant.
 *
 * `--gold` est posee sur <html> par la coquille, a partir de la couleur du
 * club ; la feuille en declare un defaut pour le mode clair et le mode
 * sombre. C'est la variable a laquelle tout le systeme visuel s'accroche
 * deja — rail actif, barres, graphiques, focus.
 */
export function readNeon(): string {
  if (typeof document === 'undefined') return '#2f6bff'
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim()
  return raw || '#2f6bff'
}

/** #rgb ou #rrggbb → [r, g, b]. Rend null sur toute autre notation. */
function rgb(hex: string): [number, number, number] | null {
  const h = hex.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(h)
  if (short) {
    return [parseInt(short[1]! + short[1]!, 16),
            parseInt(short[2]! + short[2]!, 16),
            parseInt(short[3]! + short[3]!, 16)]
  }
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h)
  if (!full) return null
  return [parseInt(full[1]!, 16), parseInt(full[2]!, 16), parseInt(full[3]!, 16)]
}

/**
 * Un halo doit rayonner.
 *
 * L'accent de « tatami » est un rouge sombre : tel quel, son halo se perd sur
 * un fond noir et le neon ne se voit pas. On l'eclaircit — mais on l'eclaircit
 * LUI, on ne le remplace pas. La teinte reste celle du theme.
 */
function haloOf(color: string): string {
  const c = rgb(color)
  if (!c) return color   // rgb(), oklch(), un mot-cle : on ne touche a rien
  const [r, g, b] = c
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  if (lum >= 0.42) return color
  const k = 0.42 / Math.max(lum, 0.06)
  const up = (v: number) => Math.round(Math.min(255, v * k))
  return `rgb(${up(r)}, ${up(g)}, ${up(b)})`
}

// Couche unique --------------------------------------------------------

interface Layer { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; glow: HTMLDivElement }
let layer: Layer | null = null

function mount(): Layer | null {
  if (typeof document === 'undefined') return null
  if (layer?.canvas.isConnected) return layer

  /*
    La mise en page est posee EN LIGNE, pas seulement par la classe.

    Un canvas cree en JS mesure 300x150 par defaut, dans le flux. Si la
    feuille de style n'est pas encore la — ou si quelqu'un renomme la classe
    un jour — le dessin se retrouve compresse dans cette petite boite et les
    coordonnees de fenetre ne correspondent plus a l'espace du canvas. La
    classe reste pour ce qui est thematique (la lueur, sa couleur) ; la
    geometrie, elle, ne depend de rien.

    Deux dimensionnements sont necessaires et ne font pas la meme chose :
    le CSS (100%) donne la taille d'AFFICHAGE, canvas.width/height donnent la
    RESOLUTION de dessin. Il en manque un, ça compresse ou ça floute.
  */
  const canvas = document.createElement('canvas')
  canvas.id = 'gf-fx'
  canvas.className = 'gf-fx-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:900'

  const glow = document.createElement('div')
  glow.id = 'gf-glow'
  glow.className = 'gf-fx-glow'
  glow.setAttribute('aria-hidden', 'true')
  glow.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:899;opacity:0'

  // appendChild plutot que append : les types Workers du projet redefinissent
  // `append`, et TypeScript refuse alors un Node dans un contexte navigateur.
  document.body.appendChild(glow)
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  layer = { canvas, ctx, glow }
  size(layer)
  // Un seul ecouteur, pose avec la couche : elle ne se demonte jamais.
  window.addEventListener('resize', () => layer && size(layer))
  return layer
}

/**
 * Resolution de dessin, distincte de la taille d'affichage.
 *
 * L'affichage vient du CSS en ligne (100 % / 100 %) et suit la fenetre tout
 * seul. Ici on ne regle que le magasin de pixels : sans lui, un confetti de
 * deux pixels est une bouillie sur un ecran a haute densite.
 *
 * Le `setTransform` vient APRES l'affectation de width/height : redimensionner
 * un canvas remet son contexte a zero, transformation comprise. Dans l'autre
 * ordre, l'echelle serait perdue a chaque redimensionnement.
 */
function size(l: Layer) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  l.canvas.width = Math.floor(window.innerWidth * dpr)
  l.canvas.height = Math.floor(window.innerHeight * dpr)
  l.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

// Particules -----------------------------------------------------------

interface Particle {
  x: number; y: number; vx: number; vy: number
  spin: number; angle: number
  life: number; max: number
  kind: 'confetti' | 'emoji' | 'ring'
  color: string; glyph: string; size: number
}

let particles: Particle[] = []
let frame: number | null = null
let halo = '#2f6bff'

const rand = (min: number, max: number) => min + Math.random() * (max - min)

/**
 * Rayon d'un anneau a un instant donne.
 *
 * Extrait pour etre verifiable sans navigateur, parce que c'est exactement
 * ici que ça a casse : `ctx.arc` leve IndexSizeError sur un rayon negatif,
 * l'exception sortait de la boucle, et l'ecran gardait une image figee. Le
 * plancher a zero est l'invariant, pas un detail d'affichage.
 */
export function ringRadius(life: number, max: number): number {
  return Math.max(0, 10 + (life / max) * 130)
}

function step() {
  const l = layer
  if (!l) { frame = null; return }

  try {
    draw(l)
  } catch (e) {
    // Une exception ici tuait la boucle et laissait la derniere image
    // peinte a l'ecran, indefiniment. Un effet decoratif n'a pas le droit
    // de laisser des debris sur l'interface : on efface, on vide, on
    // s'arrete proprement, et on laisse la trace en console pour la suite.
    console.error('[celebrate] rendu interrompu', e)
    particles = []
    frame = null
    l.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
  }
}

function draw(l: Layer) {
  l.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)

  for (const p of particles) {
    p.life += 1
    const t = p.life / p.max

    if (p.kind === 'ring') {
      // Le second anneau part en retard : sa vie est negative au depart, il
      // n'a donc rien a dessiner tant qu'elle ne l'est plus.
      //
      // Sans ce garde, son rayon valait 10 + (-0,167 x 130) = -11,7 a la
      // premiere image, et ctx.arc leve IndexSizeError sur un rayon negatif.
      // L'exception sortait de step() avant le requestAnimationFrame du bas :
      // la boucle mourait a la frame 1, les particules restaient groupees a
      // l'origine, et plus rien ne les effacait. Un amas fige.
      if (p.life < 0) continue
      const radius = ringRadius(p.life, p.max)
      l.ctx.save()
      l.ctx.globalAlpha = Math.max(0, 1 - t) * 0.55
      l.ctx.strokeStyle = p.color
      l.ctx.lineWidth = Math.max(1, 3 * (1 - t))
      l.ctx.shadowColor = p.color
      l.ctx.shadowBlur = HALO_RING
      l.ctx.beginPath()
      l.ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
      l.ctx.stroke()
      l.ctx.restore()
      continue
    }

    // Gravite, puis frottement de l'air : sans le frottement, les confettis
    // filent en ligne droite et retombent comme des cailloux.
    p.vy += 0.34
    p.vx *= 0.99
    p.vy *= 0.99
    p.x += p.vx
    p.y += p.vy
    p.angle += p.spin

    l.ctx.save()
    l.ctx.globalAlpha = Math.max(0, 1 - t * t)
    l.ctx.translate(p.x, p.y)
    l.ctx.rotate(p.angle)
    l.ctx.shadowColor = halo
    l.ctx.shadowBlur = HALO_PARTICLE

    if (p.kind === 'emoji') {
      l.ctx.font = `${p.size}px serif`
      l.ctx.textAlign = 'center'
      l.ctx.textBaseline = 'middle'
      l.ctx.fillText(p.glyph, 0, 0)
    } else {
      l.ctx.fillStyle = p.color
      // Un rectangle qui tourne autour de son axe court : c'est ce qui donne
      // le battement d'un vrai confetti, pas un carre qui pivote a plat.
      l.ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
    }
    l.ctx.restore()
  }

  particles = particles.filter(p => p.life < p.max && p.y < window.innerHeight + 60)

  // Le rAF s'arrete des qu'il n'y a plus rien : une boucle qui tourne a vide
  // reveille le processeur toutes les seize millisecondes, pour rien.
  if (particles.length > 0) {
    frame = requestAnimationFrame(step)
  } else {
    frame = null
    l.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
  }
}

// Elements du DOM : ✓, montant, lueur ----------------------------------

function popCheck(x: number, y: number, label?: string) {
  const el = document.createElement('div')
  el.className = 'gf-fx-check'
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  el.textContent = label ? `✓ ${label}` : '✓'
  document.body.appendChild(el)
  el.addEventListener('animationend', () => el.remove(), { once: true })
  // Ceinture et bretelles : si l'animation ne part pas (onglet en arriere-plan
  // au moment du montage), l'element resterait a l'ecran indefiniment.
  setTimeout(() => el.remove(), 2600)
}

function popAmount(x: number, y: number, cents: number, reduced: boolean) {
  const el = document.createElement('div')
  el.className = 'gf-fx-amount'
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  el.style.setProperty('--rise', `${AMOUNT_RISE}px`)
  document.body.appendChild(el)

  const target = cents / 100
  const fmt = (v: number) => `+ ${Math.round(v).toLocaleString('fr-MA')} DH`

  if (reduced) {
    // Pas de comptage : le defilement des chiffres est precisement le genre
    // de mouvement qu'on demande a eviter.
    el.textContent = fmt(target)
  } else {
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_MS)
      // Sortie cubique : le compteur ralentit avant de se poser sur le total.
      el.textContent = fmt(target * (1 - Math.pow(1 - t, 3)))
      if (t < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  el.addEventListener('animationend', () => el.remove(), { once: true })
  setTimeout(() => el.remove(), AMOUNT_MS + 1500)
}

/**
 * La lueur des bords : UNE pulsation, jamais une boucle.
 *
 * Un neon qui clignote en fort contraste peut declencher une crise chez une
 * personne photosensible — le seuil est de trois eclats par seconde. Une
 * seule montee, une seule descente, et l'element est rendu inerte.
 */
function pulseGlow(l: Layer) {
  l.glow.classList.remove('on')
  // Force un reflow : sans lui, retirer puis remettre la classe dans la meme
  // image ne rejoue pas l'animation.
  void l.glow.offsetWidth
  l.glow.classList.add('on')
  setTimeout(() => l.glow.classList.remove('on'), GLOW_MS + 60)
}

// ----------------------------------------------------------------------

export function celebrate(opts: CelebrateOptions): void {
  const l = mount()
  if (!l) return

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const { x, y, amountCents, label } = opts

  // Relue a chaque appel, jamais mise en cache.
  const neonColor = opts.neonColor ?? readNeon()
  halo = opts.neon === false ? '#ffffff' : haloOf(neonColor)
  l.glow.style.setProperty('--fx-neon', halo)

  // Moins de mouvement : le ✓ et le montant, rien d'autre. Ni particule, ni
  // eclat — c'est exactement ce que la preference demande d'eviter.
  if (reduced) {
    popCheck(x, y, label)
    if (typeof amountCents === 'number') popAmount(x, y, amountCents, true)
    return
  }

  const intensity = opts.intensity ?? 'moyenne'
  const sets = opts.sets ?? ['fete']
  const glyphs = sets.flatMap(k => [...(SETS[k] ?? [])])

  for (let i = 0; i < CONFETTI[intensity]; i++) {
    // Vers le haut et sur les cotes : un jet, pas une explosion spherique
    // dont la moitie part dans le sol.
    const a = rand(-Math.PI * 0.92, -Math.PI * 0.08)
    const speed = rand(6, 15)
    particles.push({
      x, y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      spin: rand(-0.3, 0.3),
      angle: rand(0, Math.PI * 2),
      life: 0, max: rand(55, 95),
      kind: 'confetti',
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      glyph: '',
      size: rand(6, 12),
    })
  }

  if (glyphs.length > 0) {
    for (let i = 0; i < EMOJIS[intensity]; i++) {
      const a = rand(-Math.PI * 0.85, -Math.PI * 0.15)
      const speed = rand(5, 11)
      particles.push({
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        spin: rand(-0.12, 0.12),
        angle: rand(-0.3, 0.3),
        life: 0, max: rand(60, 100),
        kind: 'emoji',
        color: '',
        glyph: glyphs[Math.floor(Math.random() * glyphs.length)]!,
        size: rand(16, 26),
      })
    }
  }

  if (opts.neon !== false) {
    for (let i = 0; i < RINGS; i++) {
      particles.push({
        x, y, vx: 0, vy: 0, spin: 0, angle: 0,
        life: -i * 8,          // le second part legerement apres le premier
        max: 42,
        kind: 'ring', color: halo, glyph: '', size: 0,
      })
    }
    pulseGlow(l)
  }

  popCheck(x, y, label)
  if (typeof amountCents === 'number') popAmount(x, y, amountCents, false)

  if (frame === null) frame = requestAnimationFrame(step)
}
