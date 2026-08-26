'use client'

import { useState } from 'react'
import { api, ApiError, type Branding } from '@/lib/client'
import { SKINS, SKIN_KEYS, type SkinKey } from '@/src/club/branding'

/**
 * Choix de l'habillage et de la couleur du club.
 *
 * Extrait du panneau de la plateforme pour etre pose a deux endroits : le
 * mode modification du superadmin, et la configuration du club. Extrait, et
 * non recopie — deux listes de cinq habillages auraient diverge au premier
 * ajout, et le client aurait vu des themes que la plateforme ne connait pas.
 *
 * Le serveur n'a rien eu a changer : `PUT /api/branding` acceptait deja un
 * administrateur de club. C'etait l'interface, et elle seule, qui reservait
 * le reglage a la plateforme.
 */

// Palette proposee. Le club peut coller n'importe quelle teinte, mais la
// plupart des proprietaires veulent choisir, pas composer.
const SWATCHES = ['#f05a28', '#d94b1c', '#ff8a5c', '#16a34a', '#f59e0b', '#ef4444', '#0d9488', '#64748b']

/**
 * Vignettes d'apercu.
 *
 * Elles reprennent les memes degrades que la feuille de style, ecrits ici
 * une seconde fois : une vignette qui lirait les variables du document
 * montrerait l'habillage actif, pas celui qu'on propose — les cinq pastilles
 * seraient identiques.
 */
const PREVIEW: Record<SkinKey, { bg: string; card: string; note: string }> = {
  default: {
    bg: '#eee4db',
    card: 'linear-gradient(180deg, #fffaf5, #f7eee7)',
    note: 'Crème, noir et orange GymFlow.',
  },
  sombre: {
    bg: '#080b12',
    card: 'linear-gradient(180deg, rgba(24,26,34,0.92), rgba(15,17,24,0.95))',
    note: 'Le bleu nuit d’origine.',
  },
  clair: {
    bg: '#f0f4f8',
    card: 'linear-gradient(180deg, #ffffff, #f7fafd)',
    note: 'Lisible en plein jour, salle vitrée.',
  },
  chaleureux: {
    bg: 'radial-gradient(ellipse at 20% 0%, rgba(234,88,12,0.4), transparent 60%), #f4e9dc',
    card: 'linear-gradient(180deg, #fffaf3, #f8ecdd)',
    note: 'Beige et braise.',
  },
  sport: {
    bg: 'repeating-linear-gradient(115deg, rgba(134,239,172,0.14) 0 2px, transparent 2px 12px), radial-gradient(ellipse at 15% 0%, rgba(22,163,74,0.5), transparent 60%), #07100b',
    card: 'linear-gradient(180deg, rgba(16,32,22,0.94), rgba(8,18,12,0.96))',
    note: 'Couloirs de piste, vert terrain.',
  },
  tatami: {
    bg: 'repeating-linear-gradient(0deg, rgba(203,166,110,0.16) 0 1px, transparent 1px 6px), repeating-linear-gradient(90deg, rgba(203,166,110,0.16) 0 1px, transparent 1px 6px), radial-gradient(ellipse at 50% 0%, rgba(185,28,28,0.45), transparent 55%), #12100e',
    card: 'linear-gradient(180deg, rgba(31,27,23,0.94), rgba(18,16,14,0.96))',
    note: 'Tressage de tatami, rouge du dojo.',
  },
}

export default function ThemePicker({ initial, onSaved }: {
  initial: Branding | null
  onSaved?: (b: Branding) => void
}) {
  const [accent, setAccent] = useState(initial?.theme.accent ?? '#f05a28')
  const [skin, setSkin] = useState<SkinKey>(
    initial?.theme.skin === 'sombre' || initial?.theme.skin === 'clair'
      ? 'default'
      : (initial?.theme.skin ?? 'default'),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  /**
   * Les valeurs a ecrire sont passees explicitement.
   *
   * setState est asynchrone : un enregistrement declenche dans la foulee d'un
   * setSkin enverrait l'habillage precedent. C'est exactement le genre de
   * decalage qui donne l'impression que « ca n'a pas ete pris ».
   */
  async function persist(next: { accent?: string; skin?: SkinKey }) {
    setBusy(true); setError(null); setSaved(false)
    try {
      const result = await api.put<Branding>('/api/branding', {
        theme: {
          accent: next.accent ?? accent,
          skin: next.skin ?? skin,
          mode: initial?.theme.mode ?? 'system',
        },
      })
      onSaved?.(result)
      setSaved(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Enregistrement impossible')
    } finally { setBusy(false) }
  }

  // La couleur s'applique en direct : on juge une teinte sur l'interface,
  // pas dans une pastille de seize pixels.
  function paint(next: string) {
    setAccent(next)
    document.documentElement.style.setProperty('--gold', next)
    document.documentElement.style.setProperty('--tabs-pill-bg', next)
  }

  /**
   * L'habillage s'applique a tout le document, et s'enregistre aussitot.
   *
   * Un choix unique, visible sur-le-champ et reversible d'un clic n'a pas
   * besoin d'une confirmation. Sans l'enregistrement immediat, l'apercu etait
   * la et le reglage ne l'etait pas : changer de page rendait l'ancien
   * habillage, et on croyait avoir perdu son choix.
   */
  function chooseSkin(next: SkinKey) {
    setSkin(next)
    const root = document.documentElement
    root.setAttribute('data-skin', next)
    try { localStorage.setItem('gf-skin', next) } catch { /* mode prive */ }
    paint(SKINS[next].accent)
    persist({ accent: SKINS[next].accent, skin: next })
  }

  return (
    <div>
      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 10 }}>
          Habillage
        </legend>
        <div style={{ display: 'grid', gap: 12,
                      gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))' }}>
          {SKIN_KEYS.map(key => {
            const active = skin === key
            const p = PREVIEW[key]
            return (
              <button key={key} type="button" onClick={() => chooseSkin(key)}
                      aria-pressed={active} disabled={busy}
                      style={{
                        padding: 0, cursor: 'pointer', textAlign: 'left', overflow: 'hidden',
                        borderRadius: 16, background: 'transparent',
                        border: active ? '2px solid var(--gold)' : '2px solid var(--card-border)',
                        transition: 'border-color var(--transition-fast)',
                      }}>
                {/* Une maquette miniature plutot qu'une pastille de couleur :
                    un habillage se juge sur le rapport fond / carte / accent,
                    qu'un rond uni ne montre pas. */}
                <span aria-hidden="true" style={{ display: 'block', height: 72, background: p.bg, padding: 10 }}>
                  <span style={{ display: 'block', height: 30, borderRadius: 8, background: p.card,
                                 border: '1px solid rgba(128,128,128,0.25)' }} />
                  <span style={{ display: 'block', marginTop: 7, height: 8, width: '55%',
                                 borderRadius: 99, background: SKINS[key].accent }} />
                </span>
                <span style={{ display: 'block', padding: '9px 11px 11px' }}>
                  <span style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700 }}>
                    {SKINS[key].label}
                  </span>
                  <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--muted)', marginTop: 2 }}>
                    {p.note}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <fieldset style={{ border: 'none', margin: '20px 0 0', padding: 0,
                         display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)' }}>
          Couleur du club
        </legend>
        <p className="dz-card-note" style={{ marginBottom: 4 }}>
          Elle habille les boutons, les onglets et les graphiques de toute la
          plateforme. Chaque habillage en propose une ; celle-ci la remplace.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {SWATCHES.map(hex => (
            <button key={hex} type="button" onClick={() => paint(hex)}
                    aria-label={`Couleur ${hex}`}
                    aria-pressed={accent.toLowerCase() === hex}
                    style={{
                      width: 28, height: 28, borderRadius: '50%', padding: 0, cursor: 'pointer',
                      background: hex,
                      border: accent.toLowerCase() === hex ? '2px solid #fff' : '2px solid transparent',
                      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.25)',
                    }} />
          ))}
          <input type="color" value={accent} onChange={e => paint(e.target.value)}
                 aria-label="Couleur personnalisée"
                 style={{ width: 28, height: 28, borderRadius: '50%', padding: 0, cursor: 'pointer',
                          background: 'none', border: '1px dashed var(--border-hover)' }} />
          {/* La couleur ne s'enregistre pas au survol de la palette : on
              essaie plusieurs teintes avant de trancher, et enregistrer
              chacune ecrirait dix fois en base pour un seul choix. */}
          <button className="btn-ghost" style={{ padding: '0.4rem 0.9rem', fontSize: '0.78rem' }}
                  onClick={() => persist({ accent })} disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer la couleur'}
          </button>
        </div>
      </fieldset>

      <div aria-live="polite" style={{ marginTop: 10 }}>
        {error && <p role="alert" className="mdet-problem">{error}</p>}
        {saved && !error && (
          <p role="status" className="dz-card-note" style={{ color: 'var(--positive)' }}>
            Enregistré.
          </p>
        )}
      </div>
    </div>
  )
}
