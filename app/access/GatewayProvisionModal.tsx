'use client'

import { useEffect, useState } from 'react'
import { Clock, Copy, Check, X } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import styles from './access.module.css'

export default function GatewayProvisionModal({
  gateway,
  onClose,
}: {
  gateway: Record<string, string | number | null>
  onClose: () => void
}) {
  const [tokenData, setTokenData] = useState<{ enrollmentToken: string; expiresAt: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [secondsRemaining, setSecondsRemaining] = useState<number>(900)

  useEffect(() => {
    async function requestToken() {
      setLoading(true)
      try {
        const res = await api.post<{ enrollmentToken: string; expiresAt: string }>(
          `/api/access/gateways/${gateway.id}/provision`,
          {},
        )
        setTokenData(res)
        const exp = new Date(res.expiresAt).getTime()
        const diff = Math.max(0, Math.floor((exp - Date.now()) / 1000))
        setSecondsRemaining(diff)
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Impossible de générer le jeton')
      } finally {
        setLoading(false)
      }
    }
    void requestToken()
  }, [gateway.id])

  useEffect(() => {
    if (secondsRemaining <= 0) return
    const timer = setInterval(() => setSecondsRemaining(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timer)
  }, [secondsRemaining])

  function copyToken() {
    if (!tokenData?.enrollmentToken) return
    void navigator.clipboard.writeText(tokenData.enrollmentToken)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const mins = Math.floor(secondsRemaining / 60)
  const secs = secondsRemaining % 60

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalDialog} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>Enrôlement sécurisé de la passerelle</h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '0 0 12px' }}>
            Passerelle cible : <strong>{String(gateway.name || 'Passerelle')}</strong> (<code>{String(gateway.id).slice(0, 8)}…</code>)
          </p>

          {loading && <p style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Génération du jeton d’enrôlement…</p>}

          {error && <p className="gf-banner danger">{error}</p>}

          {tokenData && (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: 'var(--overlay-soft)',
                  border: '1px solid var(--border)',
                  marginBottom: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--muted)' }}>
                  <Clock size={14} /> Expire dans :
                </div>
                <div style={{ fontSize: '0.9rem', fontWeight: 800, color: secondsRemaining < 120 ? 'var(--danger)' : 'var(--text)' }}>
                  {mins}m {secs < 10 ? `0${secs}` : secs}s
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label className={styles.formLabel}>Jeton d’enrôlement unique (Enrollment Token)</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <input
                    type="text"
                    readOnly
                    value={tokenData.enrollmentToken}
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '0.76rem',
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--page-bg)',
                      color: 'var(--gold)',
                    }}
                  />
                  <button type="button" className={styles.primaryBtn} onClick={copyToken}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copié' : 'Copier'}
                  </button>
                </div>
              </div>

              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: 'var(--overlay-soft)',
                  border: '1px solid var(--border)',
                  fontSize: '0.72rem',
                  lineHeight: 1.5,
                  color: 'var(--muted)',
                }}
              >
                <strong style={{ display: 'block', color: 'var(--text)', marginBottom: 4 }}>
                  Instructions d’enrôlement :
                </strong>
                Ce jeton permet à la passerelle matérielle physique de s’associer au club et d’échanger ses clés de signature ED25519.
                Il est à usage unique et expire dans 15 minutes. Il n’est jamais sauvegardé dans le navigateur.
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" className={styles.secondaryBtn} onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}
