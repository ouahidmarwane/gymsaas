'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, ExternalLink, ChevronDown } from 'lucide-react'
import type { Map as LeafletMap, Marker, FeatureGroup } from 'leaflet'
import 'leaflet/dist/leaflet.css'

/**
 * Carte des salles abonnees, sur OpenStreetMap via Leaflet.
 *
 * Ni compte, ni cle, ni facturation — donc une carte qu'on peut reellement
 * essayer, au lieu d'un ecran qui attend une cle qu'on n'a pas.
 *
 * Les marqueurs sont des divIcon, c'est-a-dire des noeuds du DOM. C'est ce qui
 * permet le halo neon en CSS : une image de marqueur ne s'anime pas. Ils sont
 * aussi mis a jour EN PLACE — sur un rafraichissement toutes les dix secondes,
 * les recreer ferait clignoter la carte entiere.
 *
 * Leaflet est importe dans l'effet, jamais au niveau du module : il touche
 * `window` des son evaluation, et le rendu serveur echouerait.
 */

export interface MapClub {
  id: string
  org_id: string
  branch_id: string
  club_name: string
  branch_name: string
  name: string
  slug: string
  lat: number | null
  lng: number | null
  label: string | null
  theme: { accent: string }
  online: number
  open_alerts: number
  under_support: number
  last_seen_at: string | null
  status: string
}

/** Etat visuel d'une salle. L'ordre compte : l'alerte prime sur l'activite. */
function stateOf(club: MapClub): 'support' | 'alert' | 'online' | 'idle' {
  if (club.under_support > 0) return 'support'
  if (club.open_alerts > 0) return 'alert'
  if (club.online > 0) return 'online'
  return 'idle'
}

function badgeOf(club: MapClub): string {
  if (club.under_support > 0) return 'support'
  if (club.open_alerts > 0) return `${club.open_alerts} alerte${club.open_alerts > 1 ? 's' : ''}`
  if (club.online > 0) return `${club.online} en ligne`
  return ''
}

const PIN_HTML = '<span class="gf-pin-halo"></span><span class="gf-pin-dot"></span>'
  + '<span class="gf-pin-label"></span>'

export default function ClubsMap({
  clubs, onEnter, onLocate,
}: {
  clubs: MapClub[]
  onEnter: (club: MapClub) => void
  onLocate: (club: MapClub, at: { lat: number; lng: number; label: string }) => Promise<void>
}) {
  const holder = useRef<HTMLDivElement>(null)
  const map = useRef<LeafletMap | null>(null)
  const markers = useRef(new Map<string, Marker>())
  const group = useRef<FeatureGroup | null>(null)
  const fitted = useRef(false)
  const enterRef = useRef(onEnter)
  const clubsRef = useRef(clubs)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locating, setLocating] = useState<string | null>(null)
  const STEP = 6
  const [count, setCount] = useState(STEP)

  // Les gestionnaires poses une seule fois sur chaque marqueur lisent la liste
  // courante, pas celle capturee a leur creation.
  useEffect(() => { enterRef.current = onEnter }, [onEnter])
  useEffect(() => { clubsRef.current = clubs }, [clubs])

  // Memoise : la page de supervision se rend chaque seconde pour faire avancer
  // les durees. Sans cela l'effet des marqueurs tournerait une fois par seconde.
  const located = useMemo(() => clubs.filter(c => c.lat !== null && c.lng !== null), [clubs])

  useEffect(() => {
    if (!holder.current) return
    let cancelled = false

    ;(async () => {
      try {
        const L = (await import('leaflet')).default
        if (cancelled || !holder.current || map.current) return

        map.current = L.map(holder.current, {
          // La molette appartient a la page : la detourner pour zoomer pendant
          // qu'on fait defiler la supervision est desagreable.
          scrollWheelZoom: false,
          zoomControl: true,
          attributionControl: true,
          center: [31.79, -7.09],   // Maroc, en attendant les points
          zoom: 5,
        })

        // L'attribution OpenStreetMap est obligatoire et ne doit pas etre
        // masquee : c'est la contrepartie de tuiles gratuites.
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        }).addTo(map.current)

        group.current = L.featureGroup().addTo(map.current)
        setReady(true)
      } catch {
        if (!cancelled) setError('Chargement de la carte impossible')
      }
    })()

    return () => {
      cancelled = true
      map.current?.remove()
      map.current = null
      markers.current.clear()
      group.current = null
      fitted.current = false
    }
  }, [])

  // Creation, mise a jour en place, retrait.
  useEffect(() => {
    if (!ready || !map.current || !group.current) return
    let cancelled = false

    ;(async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !map.current || !group.current) return

      const seen = new Set<string>()

      for (const club of located) {
        seen.add(club.id)
        const position: [number, number] = [club.lat!, club.lng!]
        let marker = markers.current.get(club.id)

        if (!marker) {
          marker = L.marker(position, {
            icon: L.divIcon({
              className: 'gf-pin-wrap',
              html: `<button type="button" class="gf-pin">${PIN_HTML}</button>`,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            }),
            keyboard: true,
            title: club.name,
          })
          marker.on('click', () => {
            const current = clubsRef.current.find(c => c.id === club.id)
            if (current) enterRef.current(current)
          })
          marker.addTo(group.current)
          markers.current.set(club.id, marker)
        } else {
          marker.setLatLng(position)
        }

        // Le noeud n'existe qu'une fois le marqueur ajoute a la carte.
        const el = marker.getElement()?.querySelector<HTMLElement>('.gf-pin')
        if (!el) continue

        const state = stateOf(club)
        // On n'ecrit que si la valeur change : reaffecter la meme classe
        // relancerait l'animation a chaque rafraichissement.
        if (el.dataset.state !== state) el.dataset.state = state
        el.style.setProperty('--pin', club.theme?.accent ?? '#f05a28')
        el.setAttribute('aria-label', `${club.name}, entrer`)

        const badge = badgeOf(club)
        const text = badge ? `${club.name} · ${badge}` : club.name
        const label = el.querySelector('.gf-pin-label')
        if (label && label.textContent !== text) label.textContent = text
      }

      for (const [id, marker] of markers.current) {
        if (!seen.has(id)) { marker.remove(); markers.current.delete(id) }
      }

      // Cadrage une seule fois : recadrer a chaque rafraichissement
      // arracherait la carte des mains de qui est en train de la deplacer.
      if (!fitted.current && located.length > 0) {
        fitted.current = true
        const bounds = group.current.getBounds()
        if (bounds.isValid()) map.current.fitBounds(bounds.pad(0.25), { maxZoom: 14 })
      }
    })()

    return () => { cancelled = true }
  }, [ready, located])

  const missing = clubs.length - located.length

  const RANK = { support: 0, alert: 1, online: 2, idle: 3 } as const
  const sorted = useMemo(
    () => [...clubs].sort((a, b) => RANK[stateOf(a)] - RANK[stateOf(b)] || a.name.localeCompare(b.name, 'fr')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clubs],
  )
  const shown = sorted.slice(0, count)
  const rest = Math.max(0, sorted.length - count)

  return (
    <div className="gf-map-wrap">
      {error ? (
        <div className="gf-map-fallback">
          <MapPin size={22} strokeWidth={2} style={{ color: 'var(--muted)' }} />
          <p style={{ fontWeight: 700, fontSize: '0.95rem' }}>{error}</p>
          <p className="dz-card-note">Les salles restent listées ci-dessous.</p>
        </div>
      ) : (
        <div ref={holder} className="gf-map" role="application" aria-label="Carte des salles" />
      )}

      {/* La liste double la carte : elle reste lisible au clavier, et c'est
          la seule facon de reperer une salle sans coordonnees. */}
      <ul className="gf-map-list">
        {shown.map(club => {
          const state = stateOf(club)
          return (
            <li key={club.id} style={{ '--pin': club.theme?.accent ?? '#f05a28' } as React.CSSProperties}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                <button type="button" className="gf-map-row" data-state={state}
                        onClick={() => onEnter(club)}>
                  <span className="gf-map-row-dot" aria-hidden="true" />
                  <span className="gf-map-row-body">
                    <span className="gf-map-row-name">{club.name}</span>
                    <span className="gf-map-row-note">
                      {club.label
                        ?? (club.lat === null ? 'emplacement non renseigné' : `${club.lat!.toFixed(4)}, ${club.lng!.toFixed(4)}`)}
                    </span>
                  </span>
                  <span className="gf-map-row-state">
                    {club.under_support > 0 ? 'support en cours'
                      : club.open_alerts > 0 ? `${club.open_alerts} alerte${club.open_alerts > 1 ? 's' : ''}`
                      : club.online > 0 ? `${club.online} en ligne`
                      : 'calme'}
                  </span>
                  <ExternalLink size={13} strokeWidth={2.2} style={{ flex: 'none', color: 'var(--muted)' }} />
                </button>
                <button type="button" className="gf-mini-btn" style={{ flex: 'none' }}
                        aria-expanded={locating === club.id}
                        onClick={() => setLocating(locating === club.id ? null : club.id)}>
                  <MapPin size={12} strokeWidth={2.4} /> {club.lat === null ? 'Situer' : 'Déplacer'}
                </button>
              </div>
              {locating === club.id && (
                <LocateForm club={club}
                            onCancel={() => setLocating(null)}
                            onSave={async at => { await onLocate(club, at); setLocating(null) }} />
              )}
            </li>
          )
        })}
      </ul>

      {(rest > 0 || count > STEP) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {rest > 0 && (
            <button className="gf-fold" onClick={() => setCount(c => c + STEP)}>
              <ChevronDown size={15} strokeWidth={2.4} />
              Afficher {Math.min(STEP, rest)} de plus
              <span className="gf-fold-rest">
                {rest} salle{rest > 1 ? 's' : ''} restante{rest > 1 ? 's' : ''}
              </span>
            </button>
          )}
          {count > STEP && (
            <button className="gf-fold" onClick={() => setCount(STEP)}>
              <ChevronDown size={15} strokeWidth={2.4} data-open="true" /> Réduire
            </button>
          )}
        </div>
      )}

      {missing > 0 && (
        <p className="dz-card-note" style={{ marginTop: 10 }}>
          {missing} salle{missing > 1 ? 's' : ''} sans emplacement : utilisez « Situer » pour
          la placer sur la carte.
        </p>
      )}
    </div>
  )
}

/**
 * Ajustement exceptionnel par la plateforme. Le point initial est normalement
 * choisi par le responsable du club pendant la création de la branche.
 *
 * Pas de geocodage automatique : le service gratuit de Nominatim interdit
 * l'usage en masse, et il se trompe sur les adresses marocaines mal
 * normalisees. Un clic droit dans n'importe quelle carte donne le couple
 * exact, et le champ accepte le « 33.5731, -7.5898 » qu'il met dans le
 * presse-papier.
 */
function LocateForm({ club, onSave, onCancel }: {
  club: MapClub
  onSave: (at: { lat: number; lng: number; label: string }) => Promise<void>
  onCancel: () => void
}) {
  const [pair, setPair] = useState(club.lat !== null ? `${club.lat}, ${club.lng}` : '')
  const [label, setLabel] = useState(club.label ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const parsed = (() => {
    const m = pair.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/)
    if (!m) return null
    const lat = Number(m[1]), lng = Number(m[2])
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
    return { lat, lng }
  })()

  return (
    <div style={{
      display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
      margin: '6px 0 2px', padding: '0.7rem 0.85rem',
      borderRadius: 14, background: 'var(--overlay-soft)', border: '1px solid var(--float-border)',
    }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 190px' }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--muted)' }}>
          Latitude, longitude
        </span>
        <input className="input-dark" value={pair} placeholder="33.5731, -7.5898"
               inputMode="decimal" onChange={e => { setPair(e.target.value); setProblem(null) }} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 190px' }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--muted)' }}>Adresse affichée</span>
        <input className="input-dark" value={label} maxLength={200}
               placeholder="Sbata, Casablanca" onChange={e => setLabel(e.target.value)} />
      </label>
      <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-end', paddingBottom: 2 }}>
        <button className="gf-mini-btn" onClick={onCancel} disabled={busy}>Annuler</button>
        <button className="gf-mini-btn" disabled={busy || !parsed}
                style={{ background: 'var(--gold)', borderColor: 'transparent', color: '#fff' }}
                onClick={async () => {
                  if (!parsed) { setProblem('Deux nombres séparés par une virgule.'); return }
                  setBusy(true)
                  try { await onSave({ ...parsed, label: label.trim() }) }
                  catch (e) { setProblem(e instanceof Error ? e.message : 'Enregistrement impossible') }
                  finally { setBusy(false) }
                }}>
          {busy ? '…' : 'Enregistrer'}
        </button>
      </div>
      {(problem || (pair.trim() && !parsed)) && (
        <p style={{ flexBasis: '100%', margin: 0, fontSize: '0.72rem', color: '#fca5a5' }}>
          {problem ?? 'Format attendu : 33.5731, -7.5898'}
        </p>
      )}
    </div>
  )
}
