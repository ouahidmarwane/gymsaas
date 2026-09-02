'use client'

import { useEffect, useState } from 'react'
import { DoorOpen, KeyRound, Network, Server } from 'lucide-react'
import { api } from '@/lib/client'
import { formatDirection } from '@/src/access-reasons'
import styles from './access.module.css'

type AccessRow = Record<string, string | number | null>
type Page = { items: AccessRow[]; nextCursor: string | null; hasMore: boolean }

export default function TopologyVisualizer({
  canManage,
  onProvision,
  onEdit,
}: {
  canManage: boolean
  onProvision: (gw: AccessRow) => void
  onEdit: (kind: 'gateways' | 'devices' | 'points', row: AccessRow) => void
}) {
  const [gateways, setGateways] = useState<AccessRow[]>([])
  const [devices, setDevices] = useState<AccessRow[]>([])
  const [points, setPoints] = useState<AccessRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadTopology() {
      setLoading(true)
      try {
        const [gRes, dRes, pRes] = await Promise.all([
          api.get<Page>('/api/access/gateways?limit=50'),
          api.get<Page>('/api/access/devices?limit=50'),
          api.get<Page>('/api/access/points?limit=50'),
        ])
        setGateways(gRes.items)
        setDevices(dRes.items)
        setPoints(pRes.items)
      } catch (err) {
        console.error('Erreur chargement topologie', err)
      } finally {
        setLoading(false)
      }
    }
    void loadTopology()
  }, [])

  if (loading) {
    return <p style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>Chargement de la topologie…</p>
  }

  if (!gateways.length) {
    return (
      <div style={{ textAlign: 'center', padding: 40, border: '1px dashed var(--border)', borderRadius: 14 }}>
        <Network size={32} style={{ margin: '0 auto 10px', color: 'var(--muted)' }} />
        <h3 style={{ fontSize: '0.95rem', margin: '0 0 4px', color: 'var(--text)' }}>Aucune passerelle déclarée</h3>
        <p style={{ fontSize: '0.76rem', color: 'var(--muted)', margin: 0 }}>
          Déclarez votre première passerelle matérielle pour connecter contrôleurs et tourniquets.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.topologyTree}>
      {gateways.map(gw => {
        const attachedDevices = devices.filter(d => String(d.gateway_id) === String(gw.id))
        const isOnline = gw.status === 'online'
        return (
          <div key={String(gw.id)} className={styles.topologyBranchNode}>
            {/* Gateway level */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Server size={18} color="var(--gold)" />
                <div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text)' }}>{gw.name}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
                    Passerelle ID : <code>{String(gw.id).slice(0, 8)}…</code> · Version : {gw.version || 'v2.0'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={`${styles.badge} ${isOnline ? styles.badgeSuccess : styles.badgeDanger}`}>
                  {isOnline ? 'En ligne' : 'Hors ligne'}
                </span>
                {canManage && (
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    style={{ minHeight: 32, padding: '0 10px', fontSize: '0.7rem' }}
                    onClick={() => onProvision(gw)}
                  >
                    <KeyRound size={12} /> Provisionner
                  </button>
                )}
              </div>
            </div>

            {/* Devices level */}
            {attachedDevices.length === 0 ? (
              <p style={{ fontSize: '0.72rem', color: 'var(--muted)', margin: '14px 0 0 20px' }}>
                Aucun équipement rattaché à cette passerelle.
              </p>
            ) : (
              attachedDevices.map(dev => {
                const attachedPoints = points.filter(p => String(p.device_id) === String(dev.id))
                return (
                  <div key={String(dev.id)} className={styles.topologyDeviceNode}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Network size={15} color="var(--muted)" />
                        <div>
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)' }}>{dev.name}</span>
                          <span style={{ fontSize: '0.68rem', color: 'var(--muted)', marginLeft: 8 }}>
                            Type: {dev.device_type} · Adaptateur: {dev.adapter_type}
                          </span>
                        </div>
                      </div>
                      <span className={`${styles.badge} ${styles.badgeMuted}`}>{String(dev.status)}</span>
                    </div>

                    {/* Points level */}
                    {attachedPoints.map(pt => (
                      <div key={String(pt.id)} className={styles.topologyPointNode}>
                        <DoorOpen size={14} color="var(--gold)" />
                        <span style={{ fontWeight: 600, color: 'var(--text)' }}>{pt.name}</span>
                        <span style={{ color: 'var(--muted)' }}>·</span>
                        <span style={{ color: 'var(--muted)' }}>
                          Direction : {formatDirection(pt.direction as string).label}
                        </span>
                        <span className={`${styles.badge} ${styles.badgeSuccess}`} style={{ marginLeft: 'auto' }}>
                          {String(pt.status)}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              })
            )}
          </div>
        )
      })}
    </div>
  )
}
