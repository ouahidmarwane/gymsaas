'use client'

import { useCallback, useEffect, useState } from 'react'
import { Fingerprint, KeyRound, ShieldCheck, ShieldX, Clock, ArrowDownRight, ArrowUpRight, HelpCircle } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { getReasonPresentation, formatDirection } from '@/src/access-reasons'

type Credential = { id: string; type: string; identifier_mask: string; status: string; created_at: string }
type Event = {
  id: string
  occurred_at: string
  direction?: string | null
  decision: string
  reason_code: string
  access_point_name?: string | null
  requested_access_point_id?: string | null
}

export default function MemberAccessPanel({ memberId, canManage }: { memberId: string; canManage: boolean }) {
  const [credentials, setCredentials] = useState<Credential[] | null>(null)
  const [events, setEvents] = useState<Event[] | null>(null)
  const [summary, setSummary] = useState<{ visitsLast30Days: number; averageVisitsPerWeek: number } | null>(null)
  const [adding, setAdding] = useState(false)
  const [type, setType] = useState('rfid')
  const [identifier, setIdentifier] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [showDisclaimer, setShowDisclaimer] = useState(false)

  const load = useCallback(async () => {
    try {
      const [c, e, s] = await Promise.all([
        api.get<{ items: Credential[] }>(`/api/access/credentials?memberId=${memberId}&limit=20`),
        api.get<{ items: Event[] }>(`/api/access/events?memberId=${memberId}&limit=10`),
        api.get<{ visitsLast30Days: number; averageVisitsPerWeek: number }>(`/api/access/members/${memberId}/summary`).catch(() => null),
      ])
      setCredentials(c.items)
      setEvents(e.items)
      setSummary(s)
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : 'Accès indisponible')
    }
  }, [memberId])

  useEffect(() => {
    void load()
  }, [load])

  async function change(id: string, status: 'disabled' | 'lost' | 'revoked') {
    if (status === 'revoked' && !confirm('Révoquer définitivement cet identifiant ? Il ne pourra pas être réactivé.')) return
    try {
      await api.patch(`/api/access/credentials/${id}`, { status })
      await load()
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : 'Modification impossible')
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault()
    setProblem(null)
    try {
      await api.post('/api/access/credentials', { memberId, type, identifier })
      setIdentifier('')
      setAdding(false)
      await load()
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : 'Enregistrement impossible')
    }
  }

  const latest = events?.[0] ?? null
  const isEstimatedInside = latest?.decision === 'allow' && (latest.direction === 'entry' || !latest.direction)

  return (
    <div className="mdet-access">
      <div className="mdet-access-head">
        <h3 className="mdet-section">Contrôle d’accès</h3>
        {canManage && (
          <button className="gf-mini-btn" onClick={() => setAdding(v => !v)}>
            <KeyRound size={13} />
            {adding ? 'Fermer' : 'Enregistrer un badge'}
          </button>
        )}
      </div>

      {/* Estimated Presence Banner */}
      <div
        style={{
          marginTop: 10,
          padding: '9px 12px',
          borderRadius: 'var(--radius-sm, 10px)',
          background: 'var(--overlay-soft)',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.74rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isEstimatedInside ? 'var(--positive)' : 'var(--muted)',
            }}
          />
          <span>
            Présence estimée :{' '}
            <strong style={{ color: isEstimatedInside ? 'var(--positive)' : 'var(--muted)' }}>
              {isEstimatedInside ? 'En salle' : 'Hors salle'}
            </strong>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowDisclaimer(v => !v)}
          title="Précision sur la présence"
          style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer', display: 'flex' }}
        >
          <HelpCircle size={14} />
        </button>
      </div>

      {showDisclaimer && (
        <div
          style={{
            marginTop: 6,
            padding: '7px 10px',
            borderRadius: 8,
            background: 'var(--overlay-soft)',
            color: 'var(--muted)',
            fontSize: '0.67rem',
            lineHeight: 1.4,
          }}
        >
          Estimation basée sur le dernier passage enregistré. La présence physique exacte nécessite une validation des
          capteurs de passage.
        </div>
      )}

      {/* 30-day stats pills */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
        <div
          style={{
            padding: '8px 10px',
            borderRadius: 'var(--radius-sm, 8px)',
            background: 'var(--overlay-soft)',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: '0.62rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Visites (30 jours)
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>
            {summary?.visitsLast30Days ?? 0}
          </div>
        </div>
        <div
          style={{
            padding: '8px 10px',
            borderRadius: 'var(--radius-sm, 8px)',
            background: 'var(--overlay-soft)',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: '0.62rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Moyenne / semaine
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>
            ~{summary?.averageVisitsPerWeek ?? 0}
          </div>
        </div>
      </div>

      {/* Badges / Credentials list */}
      <div style={{ marginTop: 14 }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Identifiants enregistrés
        </span>
        {credentials === null ? (
          <p className="mdet-void">Chargement des badges…</p>
        ) : credentials.length === 0 ? (
          <div className="mdet-access-empty">
            <Fingerprint size={20} />
            <span>Aucun badge ou QR code enregistré.</span>
          </div>
        ) : (
          <div className="mdet-access-list">
            {credentials.map(item => (
              <div key={item.id} className="mdet-access-row">
                <span>
                  <b>
                    {item.type.toUpperCase()} · {item.identifier_mask}
                  </b>
                  <small>
                    Statut :{' '}
                    <span
                      style={{
                        color:
                          item.status === 'active'
                            ? 'var(--positive)'
                            : item.status === 'revoked'
                            ? 'var(--danger)'
                            : 'var(--warning)',
                        fontWeight: 600,
                      }}
                    >
                      {item.status === 'active' ? 'Actif' : item.status === 'revoked' ? 'Révoqué' : 'Désactivé'}
                    </span>
                  </small>
                </span>
                {canManage && item.status !== 'revoked' && (
                  <span className="mdet-access-actions">
                    {item.status === 'active' ? (
                      <button type="button" onClick={() => void change(item.id, 'disabled')}>
                        Désactiver
                      </button>
                    ) : null}
                    <button type="button" onClick={() => void change(item.id, 'lost')}>
                      Perdu
                    </button>
                    <button type="button" onClick={() => void change(item.id, 'revoked')}>
                      Révoquer
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Adding form */}
      {adding && canManage && (
        <form className="mdet-access-form" onSubmit={create} style={{ marginTop: 10 }}>
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="rfid">Badge RFID</option>
            <option value="nfc">NFC Mobile</option>
            <option value="qr">Code QR</option>
          </select>
          <input
            required
            minLength={4}
            maxLength={512}
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            placeholder="Numéro de carte ou code..."
          />
          <button className="gf-mini-btn" type="submit">
            Ajouter
          </button>
        </form>
      )}

      {/* Access History */}
      <div style={{ marginTop: 16 }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Derniers passages
        </span>
        {events === null ? (
          <p className="mdet-void">Chargement des passages…</p>
        ) : events.length === 0 ? (
          <div className="mdet-access-empty">
            <Clock size={18} />
            <span>Aucun passage récent enregistré pour ce membre.</span>
          </div>
        ) : (
          <div
            style={{
              marginTop: 8,
              borderRadius: 'var(--radius-sm, 10px)',
              border: '1px solid var(--border)',
              background: 'var(--card-bg, var(--surface))',
              overflow: 'hidden',
            }}
          >
            {events.slice(0, 5).map(ev => {
              const reason = getReasonPresentation(ev.reason_code)
              const dir = formatDirection(ev.direction)
              const isAllow = ev.decision === 'allow'
              return (
                <div
                  key={ev.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--hairline, var(--border))',
                    fontSize: '0.73rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        display: 'grid',
                        placeItems: 'center',
                        background: isAllow ? 'var(--positive-bg)' : 'var(--danger-bg)',
                        color: isAllow ? 'var(--positive)' : 'var(--danger)',
                        flexShrink: 0,
                      }}
                    >
                      {ev.direction === 'exit' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                    </span>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                        {dir.label} · {ev.access_point_name || 'Point d’accès'}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>
                        {new Date(ev.occurred_at).toLocaleString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '0.64rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: isAllow ? 'var(--positive-bg)' : 'var(--danger-bg)',
                      color: isAllow ? 'var(--positive)' : 'var(--danger)',
                    }}
                  >
                    {isAllow ? 'Autorisé' : reason.label}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {problem && (
        <p className="mdet-problem" role="alert" style={{ marginTop: 10 }}>
          {problem}
        </p>
      )}
    </div>
  )
}
