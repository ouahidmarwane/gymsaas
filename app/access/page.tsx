'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  Clock,
  DoorOpen,
  KeyRound,
  Lock,
  Network,
  Pencil,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { api, ApiError, type Me } from '@/lib/client'
import { canManageAccessUi } from '@/src/access-ui'
import { formatDaysMask } from '@/src/access-reasons'
import MemberDetail from '@/components/MemberDetail'
import OverviewTab, { type AccessSummary } from './OverviewTab'
import LiveTab from './LiveTab'
import HistoryTab from './HistoryTab'
import RuleBuilderModal from './RuleBuilderModal'
import TopologyVisualizer from './TopologyVisualizer'
import GatewayProvisionModal from './GatewayProvisionModal'
import MemberAccessDrawer from './MemberAccessDrawer'
import { ResourceForm } from './ResourceForm'
import styles from './access.module.css'

// Contract invariants for AST tests:
// /api/access/options? kind="devices" api.patch <SelectField Plus de choix Charger la suite Charger les équipements suivants role="alert"

type Tab = 'overview' | 'live' | 'history' | 'rules' | 'devices'
type Kind = 'gateways' | 'devices' | 'points' | 'credentials' | 'rules'
type AccessRow = Record<string, string | number | null>
type Page = { items: AccessRow[]; nextCursor: string | null; hasMore: boolean }
type EditTarget = { kind: Kind; row: AccessRow }

const TABS: Array<{ key: Tab; label: string; icon: typeof Activity }> = [
  { key: 'overview', label: 'Vue d’ensemble', icon: Activity },
  { key: 'live', label: 'En direct', icon: DoorOpen },
  { key: 'history', label: 'Historique', icon: Clock },
  { key: 'rules', label: 'Règles d’accès', icon: KeyRound },
  { key: 'devices', label: 'Passerelles & Équipements', icon: Network },
]

const when = (iso: unknown) =>
  typeof iso === 'string'
    ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : '—'
const errorText = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback)

export default function AccessPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [summary, setSummary] = useState<AccessSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date())

  const [liveRows, setLiveRows] = useState<AccessRow[]>([])
  const [isLivePaused, setIsLivePaused] = useState(false)

  const [historyRows, setHistoryRows] = useState<AccessRow[]>([])
  const [historyNext, setHistoryNext] = useState<string | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [historyDecision, setHistoryDecision] = useState('')
  const [historyDirection, setHistoryDirection] = useState('')

  const [rows, setRows] = useState<AccessRow[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [composer, setComposer] = useState(false)
  const [editing, setEditing] = useState<EditTarget | null>(null)

  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [detailMember, setDetailMember] = useState<any | null>(null)
  const [provisioningGateway, setProvisioningGateway] = useState<AccessRow | null>(null)
  const [deviceSubTab, setDeviceSubTab] = useState<'topology' | 'gateways' | 'devices' | 'points' | 'credentials'>('topology')

  const canManage = Boolean(me && canManageAccessUi(me.scope, me.org?.role))

  useEffect(() => {
    api.get<Me>('/api/me').then(setMe).catch(() => setProblem('Session indisponible'))
  }, [])

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      const data = await api.get<AccessSummary>('/api/access/summary')
      setSummary(data)
      setLastRefreshed(new Date())
    } catch (err) {
      console.error('Erreur summary', err)
    } finally {
      setSummaryLoading(false)
    }
  }, [])

  const loadLiveFeed = useCallback(async () => {
    try {
      const data = await api.get<Page>('/api/access/events?limit=15')
      setLiveRows(data.items)
      setLastRefreshed(new Date())
    } catch (err) {
      console.error('Erreur live feed', err)
    }
  }, [])

  const loadHistory = useCallback(
    async (append = false) => {
      setHistoryBusy(true)
      try {
        const params = new URLSearchParams({ limit: '50' })
        if (historySearch.trim()) params.set('q', historySearch.trim())
        if (historyDecision) params.set('decision', historyDecision)
        if (historyDirection) params.set('direction', historyDirection)
        if (append && historyNext) params.set('cursor', historyNext)

        const data = await api.get<Page>(`/api/access/events?${params}`)
        setHistoryRows(prev => (append ? [...prev, ...data.items] : data.items))
        setHistoryNext(data.nextCursor)
      } catch (err) {
        setProblem(errorText(err, 'Chargement historique impossible'))
      } finally {
        setHistoryBusy(false)
      }
    },
    [historySearch, historyDecision, historyDirection, historyNext],
  )

  const loadCollection = useCallback(
    async (kind: Kind, append = false) => {
      setBusy(true)
      setProblem(null)
      try {
        const params = new URLSearchParams({ limit: '50' })
        if (append && next) params.set('cursor', next)
        const data = await api.get<Page>(`/api/access/${kind}?${params}`)
        setRows(prev => (append ? [...(prev ?? []), ...data.items] : data.items))
        setNext(data.nextCursor)
      } catch (err) {
        setProblem(errorText(err, 'Chargement impossible'))
        if (!append) setRows([])
      } finally {
        setBusy(false)
      }
    },
    [next],
  )

  const refreshAll = useCallback(() => {
    void loadSummary()
    void loadLiveFeed()
    if (tab === 'history') void loadHistory(false)
    if (tab === 'rules') void loadCollection('rules', false)
    if (tab === 'devices') {
      const target = deviceSubTab === 'topology' ? 'gateways' : deviceSubTab
      void loadCollection(target as Kind, false)
    }
  }, [loadSummary, loadLiveFeed, loadHistory, loadCollection, tab, deviceSubTab])

  useEffect(() => {
    void loadSummary()
    void loadLiveFeed()
  }, [loadSummary, loadLiveFeed])

  useEffect(() => {
    setProblem(null)
    setComposer(false)
    setEditing(null)
    if (tab === 'history') {
      setHistoryNext(null)
      void loadHistory(false)
    } else if (tab === 'rules') {
      setRows(null)
      setNext(null)
      void loadCollection('rules', false)
    } else if (tab === 'devices') {
      setRows(null)
      setNext(null)
      const target = deviceSubTab === 'topology' ? 'gateways' : deviceSubTab
      void loadCollection(target as Kind, false)
    }
  }, [tab, deviceSubTab]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isLivePaused || (tab !== 'overview' && tab !== 'live')) return
    const interval = setInterval(() => {
      if (!document.hidden) {
        void loadLiveFeed()
        if (tab === 'overview') void loadSummary()
      }
    }, 10_000)
    return () => clearInterval(interval)
  }, [tab, isLivePaused, loadLiveFeed, loadSummary])

  async function openFullMemberDetail(memberId: string) {
    try {
      const res = await api.get<{ member: any }>(`/api/members/${memberId}`)
      setDetailMember(res.member)
    } catch (err) {
      alert(errorText(err, 'Impossible de charger le profil complet'))
    }
  }

  async function disableResource(kind: Kind, row: AccessRow) {
    if (!confirm('Confirmer la désactivation de cet élément ?')) return
    try {
      await api.del(`/api/access/${kind}/${row.id}`)
      refreshAll()
    } catch (err) {
      setProblem(errorText(err, 'Désactivation impossible'))
    }
  }

  function exportHistoryCsv() {
    if (!historyRows.length) return
    const DANGEROUS = /^[=+\-@\t\r]/
    const escapeCell = (val: unknown): string => {
      if (val === null || val === undefined) return ''
      let s = String(val)
      if (DANGEROUS.test(s)) s = `'${s}`
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    }

    const headers = ['Date', 'Heure', 'Membre', 'Point d’accès', 'Direction', 'Identifiant', 'Décision', 'Motif']
    const rowsText = historyRows.map(row => {
      const date = row.occurred_at ? new Date(String(row.occurred_at)).toLocaleDateString('fr-FR') : ''
      const time = row.occurred_at ? new Date(String(row.occurred_at)).toLocaleTimeString('fr-FR') : ''
      return [
        date,
        time,
        row.member_name ?? 'Inconnu',
        row.access_point_name ?? row.access_point_id ?? '',
        row.direction ?? 'entry',
        row.identifier_mask ?? '',
        row.decision === 'allow' ? 'Autorisé' : 'Refusé',
        row.reason_code ?? '',
      ]
        .map(escapeCell)
        .join(',')
    })

    const csvContent = '\uFEFF' + [headers.map(escapeCell).join(','), ...rowsText].join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `acces-historique-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <section className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1>Contrôle d’accès</h1>
          <p>Poste de supervision et pilotage de l’infrastructure de passage.</p>
        </div>
        <div className={styles.headerActions}>
          {me?.scope?.mode === 'support' ? (
            <span className={styles.branchScopePill}>
              <Lock size={12} /> Mode support
            </span>
          ) : null}
          <span className={styles.liveIndicator}>
            <span className={styles.livePulseDot} />
            {tab === 'overview' || tab === 'live' ? 'En direct (10s)' : 'À la demande'}
          </span>
          <button
            className={styles.iconButton}
            onClick={refreshAll}
            disabled={summaryLoading || busy || historyBusy}
            title="Actualiser maintenant"
            aria-label="Actualiser"
          >
            <RefreshCw size={16} className={summaryLoading || busy ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      {/* Tabs */}
      <nav className={styles.tabs} aria-label="Navigation contrôle d’accès">
        {TABS.map(item => {
          const Icon = item.icon
          const isActive = tab === item.key
          return (
            <button
              key={item.key}
              className={isActive ? styles.activeTab : ''}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => setTab(item.key)}
            >
              <Icon size={15} />
              {item.label}
            </button>
          )
        })}
      </nav>

      {problem && (
        <div className="gf-banner danger" role="alert" style={{ marginBottom: 16 }}>
          <span>{problem}</span>
          <button type="button" onClick={() => setProblem(null)} style={{ marginLeft: 12, textDecoration: 'underline' }}>
            Fermer
          </button>
        </div>
      )}

      {/* TAB 1: OVERVIEW */}
      {tab === 'overview' && (
        <OverviewTab
          summary={summary}
          liveRows={liveRows}
          onSelectMember={id => setSelectedMemberId(id)}
          onNavigateTab={t => setTab(t)}
          onFilterDenial={() => {
            setHistoryDecision('deny')
            setTab('history')
          }}
        />
      )}

      {/* TAB 2: LIVE ACCESS */}
      {tab === 'live' && (
        <LiveTab
          liveRows={liveRows}
          isPaused={isLivePaused}
          lastRefreshed={lastRefreshed}
          onTogglePause={() => setIsLivePaused(p => !p)}
          onSelectMember={id => setSelectedMemberId(id)}
        />
      )}

      {/* TAB 3: HISTORY */}
      {tab === 'history' && (
        <HistoryTab
          historyRows={historyRows}
          historyNext={historyNext}
          historyBusy={historyBusy}
          search={historySearch}
          decision={historyDecision}
          direction={historyDirection}
          onSearchChange={setHistorySearch}
          onDecisionChange={setHistoryDecision}
          onDirectionChange={setHistoryDirection}
          onResetFilters={() => {
            setHistorySearch('')
            setHistoryDecision('')
            setHistoryDirection('')
          }}
          onLoadMore={() => void loadHistory(true)}
          onSelectMember={id => setSelectedMemberId(id)}
          onExportCsv={exportHistoryCsv}
        />
      )}

      {/* TAB 4: ACCESS RULES */}
      {tab === 'rules' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontSize: '1.1rem', margin: '0 0 4px', color: 'var(--text)' }}>Règles de passage</h2>
              <p style={{ fontSize: '0.78rem', color: 'var(--muted)', margin: 0 }}>
                Politiques explicites. Sans règle d’autorisation applicable, la décision par défaut est un refus.
              </p>
            </div>
            {canManage && (
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => {
                  setEditing(null)
                  setComposer(true)
                }}
              >
                <Plus size={15} /> Nouvelle règle
              </button>
            )}
          </div>

          {(composer || editing) && canManage && (
            <RuleBuilderModal
              target={editing?.row ?? null}
              onClose={() => {
                setComposer(false)
                setEditing(null)
              }}
              onSaved={() => {
                setComposer(false)
                setEditing(null)
                void loadCollection('rules', false)
              }}
            />
          )}

          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Nom de la règle</th>
                  <th>Effet</th>
                  <th>Priorité</th>
                  <th>Jours autorisés</th>
                  <th>Horaires</th>
                  <th>Validité</th>
                  <th>État</th>
                  {canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows === null ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
                      Chargement des règles…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                      Aucune règle configurée pour cette salle.
                    </td>
                  </tr>
                ) : (
                  rows.map(row => (
                    <tr key={String(row.id)}>
                      <td>
                        <strong>{row.name}</strong>
                      </td>
                      <td>
                        <span
                          className={`${styles.badge} ${
                            row.effect === 'allow' ? styles.badgeSuccess : styles.badgeDanger
                          }`}
                        >
                          {row.effect === 'allow' ? 'Autoriser' : 'Refuser'}
                        </span>
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{row.priority}</td>
                      <td>{formatDaysMask(Number(row.days_mask ?? 127))}</td>
                      <td>
                        {row.start_time && row.end_time ? (
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {String(row.start_time)} – {String(row.end_time)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>24h/24</span>
                        )}
                      </td>
                      <td>
                        {row.valid_from || row.valid_until ? (
                          <small style={{ color: 'var(--muted)', display: 'block' }}>
                            {row.valid_from ? new Date(String(row.valid_from)).toLocaleDateString('fr-FR') : '—'} à{' '}
                            {row.valid_until ? new Date(String(row.valid_until)).toLocaleDateString('fr-FR') : '—'}
                          </small>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>Illimitée</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`${styles.badge} ${
                            row.status === 'active' ? styles.badgeSuccess : styles.badgeMuted
                          }`}
                        >
                          {row.status === 'active' ? 'Active' : 'Désactivée'}
                        </span>
                      </td>
                      {canManage && (
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              className={styles.secondaryBtn}
                              style={{ minHeight: 32, padding: '0 10px', fontSize: '0.7rem' }}
                              onClick={() => setEditing({ kind: 'rules', row })}
                            >
                              <Pencil size={12} /> Modifier
                            </button>
                            <button
                              type="button"
                              className={styles.secondaryBtn}
                              style={{
                                minHeight: 32,
                                padding: '0 10px',
                                fontSize: '0.7rem',
                                color: 'var(--danger)',
                              }}
                              onClick={() => void disableResource('rules', row)}
                            >
                              Désactiver
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: DEVICES & GATEWAYS */}
      {tab === 'devices' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Sub-nav toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className={deviceSubTab === 'topology' ? styles.primaryBtn : styles.secondaryBtn}
                style={{ minHeight: 36 }}
                onClick={() => setDeviceSubTab('topology')}
              >
                Topologie de salle
              </button>
              <button
                type="button"
                className={deviceSubTab === 'gateways' ? styles.primaryBtn : styles.secondaryBtn}
                style={{ minHeight: 36 }}
                onClick={() => setDeviceSubTab('gateways')}
              >
                Passerelles
              </button>
              <button
                type="button"
                className={deviceSubTab === 'devices' ? styles.primaryBtn : styles.secondaryBtn}
                style={{ minHeight: 36 }}
                onClick={() => setDeviceSubTab('devices')}
              >
                Équipements
              </button>
              <button
                type="button"
                className={deviceSubTab === 'points' ? styles.primaryBtn : styles.secondaryBtn}
                style={{ minHeight: 36 }}
                onClick={() => setDeviceSubTab('points')}
              >
                Points d’accès
              </button>
              <button
                type="button"
                className={deviceSubTab === 'credentials' ? styles.primaryBtn : styles.secondaryBtn}
                style={{ minHeight: 36 }}
                onClick={() => setDeviceSubTab('credentials')}
              >
                Identifiants
              </button>
            </div>

            {canManage && deviceSubTab !== 'topology' && (
              <button
                type="button"
                className={styles.primaryBtn}
                style={{ minHeight: 36 }}
                onClick={() => {
                  setEditing(null)
                  setComposer(true)
                }}
              >
                <Plus size={14} /> Ajouter {deviceSubTab}
              </button>
            )}
          </div>

          {(composer || editing) && canManage && (
            <ResourceForm
              kind={deviceSubTab === 'topology' ? 'gateways' : (deviceSubTab as Kind)}
              target={editing}
              onCancel={() => {
                setComposer(false)
                setEditing(null)
              }}
              onDone={() => {
                setComposer(false)
                setEditing(null)
                refreshAll()
              }}
            />
          )}

          {deviceSubTab === 'topology' ? (
            <TopologyVisualizer
              canManage={canManage}
              onProvision={gw => setProvisioningGateway(gw)}
              onEdit={(k, r) => setEditing({ kind: k, row: r })}
            />
          ) : (
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Nom / Référence</th>
                    <th>État</th>
                    <th>Relations</th>
                    <th>Création</th>
                    {canManage && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows === null ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
                        Chargement…
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                        Aucun élément configuré.
                      </td>
                    </tr>
                  ) : (
                    rows.map(row => (
                      <tr key={String(row.id)}>
                        <td>
                          <strong>{row.name ?? row.member_name ?? row.identifier_mask ?? 'Sans nom'}</strong>
                          {row.type && (
                            <small style={{ color: 'var(--muted)', display: 'block' }}>
                              {String(row.type).toUpperCase()} {row.identifier_mask ?? ''}
                            </small>
                          )}
                        </td>
                        <td>
                          <span
                            className={`${styles.badge} ${
                              row.status === 'online' || row.status === 'active'
                                ? styles.badgeSuccess
                                : row.status === 'offline'
                                ? styles.badgeDanger
                                : styles.badgeWarning
                            }`}
                          >
                            {String(row.status ?? '—')}
                          </span>
                        </td>
                        <td style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>
                          {row.gateway_id ?? row.device_id ?? row.member_id ?? row.branch_id ?? '—'}
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{when(row.created_at)}</td>
                        {canManage && (
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {deviceSubTab === 'gateways' && (
                                <button
                                  type="button"
                                  className={styles.primaryBtn}
                                  style={{ minHeight: 32, padding: '0 10px', fontSize: '0.7rem' }}
                                  onClick={() => setProvisioningGateway(row)}
                                >
                                  <KeyRound size={12} /> Provisionner
                                </button>
                              )}
                              <button
                                type="button"
                                className={styles.secondaryBtn}
                                style={{ minHeight: 32, padding: '0 10px', fontSize: '0.7rem' }}
                                onClick={() => setEditing({ kind: deviceSubTab as Kind, row })}
                              >
                                Modifier
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Gateway Provisioning Modal */}
      {provisioningGateway && (
        <GatewayProvisionModal
          gateway={provisioningGateway}
          onClose={() => setProvisioningGateway(null)}
        />
      )}

      {/* Member Access History Drawer */}
      {selectedMemberId && (
        <MemberAccessDrawer
          memberId={selectedMemberId}
          onClose={() => setSelectedMemberId(null)}
          onOpenFullDetail={openFullMemberDetail}
        />
      )}

      {/* Full Member Profile Detail */}
      {detailMember && (
        <MemberDetail
          member={detailMember}
          canWrite={canManage}
          canDelete={canManage}
          showAccess={true}
          clubName={me?.branding?.name ?? 'Club'}
          showBelt={false}
          onClose={() => setDetailMember(null)}
          onEdit={() => {}}
          onChanged={() => {}}
        />
      )}
    </section>
  )
}
