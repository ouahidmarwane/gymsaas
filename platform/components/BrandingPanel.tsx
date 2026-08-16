'use client'

import { useState } from 'react'
import { Palette } from 'lucide-react'
import { api, ApiError, type Branding } from '@/lib/client'
import ThemePicker from '@/components/ThemePicker'
import BannerPicker from '@/components/BannerPicker'
import LogoPicker from '@/components/LogoPicker'

/**
 * Panneau de marque de la plateforme.
 *
 * Il garde ce qui appartient a l'exploitant : le nom affiche, le logo, la
 * banniere du tableau de bord. L'habillage et la couleur sont passes a
 * ThemePicker, partage avec la configuration du club — un seul endroit ou
 * les cinq habillages sont definis.
 */
export default function BrandingPanel({
  initial, onSaved,
}: { initial: Branding | null; onSaved: (b: Branding) => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  /**
   * Enregistre le nom affiche.
   *
   * Le theme n'est plus envoye d'ici : ThemePicker l'ecrit lui-meme. Le
   * renvoyer aurait remis l'habillage tel qu'il etait au montage du panneau,
   * ecrasant en silence le choix fait juste au-dessus.
   */
  async function persist() {
    setBusy(true); setError(null); setSaved(false)
    try {
      const result = await api.put<Branding>('/api/branding', {
        name: name.trim() || undefined,
      })
      onSaved(result); setSaved(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Enregistrement impossible')
    } finally { setBusy(false) }
  }

  return (
    <section className="dz-card" aria-label="Apparence du club">
      <div className="dz-card-head">
        <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Palette size={17} strokeWidth={2.1} style={{ color: 'var(--gold)' }} /> Apparence
        </h2>
        <div aria-live="polite" style={{ fontSize: '0.78rem' }}>
          {error && <span style={{ color: '#fca5a5' }}>{error}</span>}
          {saved && !error && <span style={{ color: '#6ee7b7' }}>Enregistre</span>}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 360 }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)' }}>Nom affiche</span>
          <input className="input-dark" value={name} onChange={e => setName(e.target.value)} maxLength={120} />
        </label>
      </div>

      {/* Logo : le meme composant que la configuration du club, comme
          l'habillage et la banniere. Ce panneau portait sa propre copie du
          televersement — plafond, formats et messages ecrits une seconde
          fois, donc voues a diverger de ce que le club, lui, aurait lu. */}
      <fieldset style={{ border: 'none', margin: '22px 0 0', padding: 0 }}>
        <legend style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 10 }}>
          Logo
        </legend>
        <LogoPicker initial={initial} name={name} onSaved={onSaved} />
      </fieldset>

      {/* Banniere : le meme composant que dans la configuration du club, pour
          la meme raison que l'habillage — une seule definition des regles
          d'envoi. La plateforme la pose desormais pour depanner, pas parce
          qu'elle serait seule a en avoir le droit. */}
      <fieldset style={{ border: 'none', margin: '22px 0 0', padding: 0 }}>
        <legend style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 10 }}>
          Bannière du tableau de bord
        </legend>
        <BannerPicker initial={initial} onSaved={onSaved} />
      </fieldset>

      {/* Habillage et couleur : le meme composant que dans la configuration
          du club. Une seule definition des cinq habillages — recopiee, elle
          aurait diverge au premier ajout, et le client aurait vu des themes
          que la plateforme ne connait pas. */}
      <div style={{ marginTop: 22 }}>
        <ThemePicker initial={initial} onSaved={onSaved} />
      </div>

      {/* Le bouton ferme la carte : place au milieu, il avait l'air de ne
          valider que les champs au-dessus de lui. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn-dark" style={{ background: 'var(--gold)', borderColor: 'transparent' }}
                onClick={() => persist()} disabled={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer le nom'}
        </button>
      </div>
    </section>
  )
}
