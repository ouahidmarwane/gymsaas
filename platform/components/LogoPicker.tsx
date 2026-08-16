'use client'

import { useRef, useState } from 'react'
import { Upload, Trash2 } from 'lucide-react'
import { api, upload as putFile, ApiError, type Branding } from '@/lib/client'

/**
 * Logo du club.
 *
 * Extrait pour vivre a deux endroits, comme la banniere et l'habillage : la
 * configuration du club, et le panneau de la plateforme en mode support. Le
 * televersement etait jusqu'ici enferme dans le panneau de la plateforme,
 * alors que le serveur l'ouvre depuis toujours aux administrateurs du club
 * (`atLeast(principal, 'admin', true)`) — c'etait l'ecran qui manquait, pas
 * le droit.
 *
 * Une seule definition des regles d'envoi : format, plafond, message. Deux
 * copies auraient diverge au premier ajustement, et un club aurait lu « 2 Mo
 * maximum » la ou le serveur en accepte autre chose.
 */

const MAX_BYTES = 2 * 1024 * 1024
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp']

export default function LogoPicker({ initial, name, onSaved }: {
  initial: Branding | null
  /** Sert les initiales du repli quand aucun logo n'est pose. */
  name?: string
  onSaved?: (b: Branding) => void
}) {
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const initials = ((name ?? initial?.name ?? 'GF').trim() || 'GF').slice(0, 2).toUpperCase()

  async function send(file: File) {
    // Refuse ici ce que le serveur refuserait : faire monter le fichier pour
    // lire « format non accepte » est une perte de temps sur la connexion
    // d'une salle de sport.
    if (!ACCEPTED.includes(file.type)) {
      setError('Format accepté : PNG, JPEG ou WebP.'); return
    }
    if (file.size > MAX_BYTES) {
      setError('Logo trop volumineux : 2 Mo maximum.'); return
    }
    setBusy(true); setError(null)
    try {
      await putFile<{ key: string }>('PUT', '/api/branding/logo', file)
      // On relit la marque plutot que de fabriquer l'URL a partir de la cle :
      // c'est le serveur qui decide comment un fichier se sert.
      const refreshed = await api.get<Branding>('/api/branding')
      setLogoUrl(refreshed.logoUrl)
      onSaved?.(refreshed)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Envoi impossible')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function remove() {
    if (!confirm('Retirer le logo du club ?')) return
    setBusy(true); setError(null)
    try {
      await api.del('/api/branding/logo')
      setLogoUrl(null)
      onSaved?.(await api.get<Branding>('/api/branding'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Suppression impossible')
    } finally { setBusy(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* L'apercu est rond et cadre comme le rail — meme `cover`, meme
            rognage. Un apercu en `contain` montrerait l'image entiere puis le
            rail en couperait les bords : l'apercu mentirait sur le resultat,
            ce qui est pire que pas d'apercu du tout. */}
        {logoUrl
          ? <img src={logoUrl} alt="Logo actuel" width={56} height={56}
                 style={{
                   borderRadius: '50%', objectFit: 'cover', objectPosition: 'center',
                   flex: 'none',
                   background: 'var(--overlay-soft)', border: '1px solid var(--card-border)',
                 }} />
          : <span style={{
              width: 56, height: 56, borderRadius: '50%', flex: 'none',
              display: 'grid', placeItems: 'center',
              // var(--gold) plutot qu'une copie de l'accent : la pastille suit
              // le choix fait dans ThemePicker en direct.
              background: 'var(--gold)', color: '#fff', fontWeight: 800, fontSize: '0.95rem',
            }}>{initials}</span>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <input ref={fileRef} type="file" className="sr-only"
                 accept="image/png,image/jpeg,image/webp"
                 onChange={e => { const f = e.target.files?.[0]; if (f) send(f) }} />
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-ghost" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}
                    onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload size={14} strokeWidth={2.2} />
              {busy ? 'Envoi…' : logoUrl ? 'Remplacer' : 'Choisir un logo'}
            </button>
            {logoUrl && (
              <button className="btn-ghost" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem',
                                                     color: '#f87171' }}
                      onClick={remove} disabled={busy}>
                <Trash2 size={14} strokeWidth={2.2} /> Retirer
              </button>
            )}
          </span>
          <span className="dz-card-note" style={{ fontSize: '0.74rem', maxWidth: 340 }}>
            PNG, JPEG ou WebP, 2 Mo maximum. Il est recadré dans un rond, sans
            jamais être déformé : une image carrée garde donc tout, une image
            large est rognée sur les côtés. Sans logo, les initiales du club
            prennent sa place.
          </span>
        </div>
      </div>

      <div aria-live="polite" style={{ marginTop: 10 }}>
        {error && <p role="alert" className="mdet-problem">{error}</p>}
      </div>
    </div>
  )
}
