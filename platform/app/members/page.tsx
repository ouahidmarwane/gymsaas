'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, MessageCircle, MoreHorizontal, Pencil, Trash2, TriangleAlert,
  ChevronDown, ArrowUp, ArrowDown, Download, Target, Upload, CreditCard,
} from 'lucide-react'
import { useDiscipline } from '@/lib/discipline'
import { api, ApiError, type Me } from '@/lib/client'
import EditablePage from '@/components/EditablePage'
import PageState from '@/components/PageState'
import SlidingTabs from '@/components/SlidingTabs'
import MemberModal from '@/components/MemberModal'
import MemberExportModal from '@/components/MemberExportModal'
import MemberImportModal from '@/components/MemberImportModal'
import { toCsv, download } from '@/lib/csv'
import {
  type MemberRow, subStatus, insStatus, isDormant, daysUntil,
  SUB_LABEL, INS_LABEL, SUB_TONE, INS_TONE, whatsappFor, waLink,
} from '@/lib/member-status'

interface Branch { id: string; name: string }
interface Discipline { id: string; name: string; has_grading: number }

const AVATAR_COLORS = ['#818cf8', '#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa']
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—')

export default function MembersPage() {
  const { active } = useDiscipline()
  const [me, setMe] = useState<Me | null>(null)
  const [members, setMembers] = useState<MemberRow[] | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [disciplines, setDisciplines] = useState<Discipline[]>([])

  const [branch, setBranch] = useState('all')
  const [search, setSearch] = useState('')
  const [quick, setQuick] = useState('all')
  const [sortBy, setSortBy] = useState<'name' | 'sub_expiry' | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)

  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [editing, setEditing] = useState<MemberRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)

  const reload = useCallback(async () => {
    const [m, b, d] = await Promise.all([
      api.get<{ members: MemberRow[] }>(`/api/members?limit=500&disciplineId=${active}`),
      api.get<{ branches: Branch[] }>('/api/branches'),
      api.get<{ disciplines: Discipline[] }>('/api/disciplines'),
    ])
    setMembers(m.members); setBranches(b.branches); setDisciplines(d.disciplines)
  }, [active])

  useEffect(() => {
    Promise.all([api.get<Me>('/api/me'), reload()])
      .then(([meData]) => setMe(meData))
      .catch(e => {
        setError(e instanceof ApiError ? e.message : 'Chargement impossible')
        setMembers([])
      })
  }, [reload])

  // Ferme le menu ⋯ au clic ailleurs.
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.('[data-rowmenu]')) setMenuFor(null)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  const canWrite = me
    ? (me.scope.mode === 'support' ? me.scope.canWrite : ['owner', 'admin', 'staff'].includes(me.org?.role ?? ''))
    : false

  const clubName = me?.branding?.name ?? 'votre club'
  const all = useMemo(() => members ?? [], [members])

  // La colonne ceinture n'a de sens que si la discipline retenue est gradee.
  // Un club de boxe ne doit pas voir une colonne vide sur toute sa liste.
  const showBelt = active === 'all'
    ? disciplines.some(d => d.has_grading === 1)
    : disciplines.find(d => d.id === active)?.has_grading === 1

  const inBranch = useMemo(
    () => (branch === 'all' ? all : all.filter(m => m.branch_id === branch)),
    [all, branch],
  )

  const counts = useMemo(() => ({
    all: inBranch.length,
    active: inBranch.filter(m => subStatus(m) === 'active').length,
    expiring: inBranch.filter(m => subStatus(m) === 'expiring').length,
    expired: inBranch.filter(m => subStatus(m) === 'expired').length,
    uninsured: inBranch.filter(m => insStatus(m) === 'uninsured').length,
    ins_expiring: inBranch.filter(m => insStatus(m) === 'expiring').length,
    dormant: inBranch.filter(isDormant).length,
  }), [inBranch])

  const filterItems = useMemo(() => [
    { key: 'all', label: <>Tous les résultats <b>{counts.all}</b></> },
    { key: 'active', label: <>Actif <b>{counts.active}</b></> },
    { key: 'expiring', label: <>Expire bientôt <b>{counts.expiring}</b></> },
    { key: 'expired', label: <>Expiré <b>{counts.expired}</b></> },
    { key: 'uninsured', label: <>Non assuré <b>{counts.uninsured}</b></> },
    { key: 'ins_expiring', label: <>Assurance expire <b>{counts.ins_expiring}</b></> },
    { key: 'dormant', label: <>Inactifs +3&nbsp;mois <b>{counts.dormant}</b></> },
  ], [counts])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = inBranch.filter(m => {
      const matchQ = !q || m.name.toLowerCase().includes(q)
        || m.phone.includes(q) || (m.email ?? '').toLowerCase().includes(q)
      const matchF =
        quick === 'all' ? true
          : quick === 'uninsured' ? insStatus(m) === 'uninsured'
          : quick === 'ins_expiring' ? insStatus(m) === 'expiring'
          : quick === 'dormant' ? isDormant(m)
          : subStatus(m) === quick
      return matchQ && matchF
    })
    if (sortBy) {
      list.sort((a, b) => {
        const va = (sortBy === 'name' ? a.name : a.sub_expiry ?? '') || ''
        const vb = (sortBy === 'name' ? b.name : b.sub_expiry ?? '') || ''
        return va.localeCompare(vb, 'fr') * sortDir
      })
    }
    return list
  }, [inBranch, search, quick, sortBy, sortDir])

  function toggleSort(key: 'name' | 'sub_expiry') {
    if (sortBy !== key) { setSortBy(key); setSortDir(1); return }
    if (sortDir === 1) setSortDir(-1)
    else { setSortBy(null); setSortDir(1) }
  }

  async function act(key: string, run: () => Promise<unknown>, done: string) {
    setBusy(key); setError(null); setNotice(null)
    try { await run(); await reload(); setNotice(done) }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Action impossible') }
    finally { setBusy(null) }
  }

  /**
   * Export de la vue affichee.
   *
   * Le BOM et le desamorcage des formules vivent dans `toCsv` : une cellule
   * qui commence par « = » s'execute a l'ouverture dans un tableur, et un
   * fichier exporte finit toujours par etre ouvert quelque part.
   */
  function exportCsv() {
    if (filtered.length === 0) return
    const rows: unknown[][] = [
      ['Nom', 'Téléphone', 'E-mail', 'Salle', 'Discipline', 'Grade',
       'Inscription', 'Abonnement', 'Fin abonnement', 'Assurance', 'Fin assurance'],
      ...filtered.map(m => [
        m.name, m.phone, m.email ?? '', m.branch_name ?? '',
        m.discipline_name ?? '', m.grade_label ?? '',
        day(m.join_date), SUB_LABEL[subStatus(m)], day(m.sub_expiry),
        INS_LABEL[insStatus(m)], m.is_insured ? day(m.ins_expiry) : '',
      ]),
    ]
    download(toCsv(rows), `membres-${quick}-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <EditablePage
      page="members"
      me={me}
      title="Membres"
      subtitle={members ? `${all.length} inscrit${all.length > 1 ? 's' : ''}` : 'Chargement…'}
      actions={
        <>
          <button className="btn-ghost" onClick={exportCsv} disabled={filtered.length === 0}
                  title="Exporter la vue affichée">
            <Download size={15} strokeWidth={2.2} /> Exporter CSV
          </button>
          <button className="btn-ghost" onClick={() => setExporting(true)}
                  disabled={all.length === 0}
                  title="Choisir précisément qui exporter">
            <Target size={15} strokeWidth={2.2} /> Export filtré
          </button>
          {canWrite && (
            <button className="btn-ghost" onClick={() => setImporting(true)}>
              <Upload size={15} strokeWidth={2.2} /> Importer CSV
            </button>
          )}
          {canWrite && (
            <button className="btn-dark" style={{ background: 'var(--gold)', borderColor: 'transparent' }}
                    onClick={() => { setEditing(null); setAdding(true) }}>
              <Plus size={16} strokeWidth={2.4} /> Ajouter un membre
            </button>
          )}
        </>
      }
    >
      <PageState error={error} onRetry={reload} />

      <div aria-live="polite">
        {notice && !error && (
          <p role="status" style={{
            padding: '0.7rem 1rem', borderRadius: 14,
            background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)',
            color: '#6ee7b7', fontSize: '0.85rem', fontWeight: 600,
          }}>{notice}</p>
        )}
      </div>

      <AlertsBanner members={inBranch} />

      {/* Filtres : salle, recherche, statut. */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {branches.length > 1 && (
          <SlidingTabs
            items={[{ key: 'all', label: 'Toutes' }, ...branches.map(b => ({ key: b.id, label: b.name }))]}
            value={branch}
            onChange={setBranch}
          />
        )}
        <input className="members-search-input" placeholder="Nom, téléphone, e-mail…"
               value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <SlidingTabs items={filterItems} value={quick} onChange={setQuick} />

      {!members && (
        <div className="members-skeleton-row" style={{ height: 220, border: 'none', borderRadius: 22 }} />
      )}

      {members && filtered.length === 0 && (
        <section className="dz-card">
          <div className="members-empty">
            <div className="members-empty-icon">👥</div>
            <div className="members-empty-text">
              {all.length === 0
                ? 'Aucun membre pour l’instant.'
                : 'Aucun membre ne correspond à ce filtre.'}
            </div>
          </div>
        </section>
      )}

      {members && filtered.length > 0 && (
        <div className="dz-card members-page-table" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead className="members-page-table-head">
                <tr>
                  <Th label="Membre" sort="name" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <Th label="Contact" />
                  {showBelt && <Th label="Ceinture" />}
                  <Th label="Abonnement" sort="sub_expiry" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  <Th label="Assurance" />
                  <Th label="" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => {
                  const sub = subStatus(m)
                  const ins = insStatus(m)
                  const wa = whatsappFor(m, clubName)
                  return (
                    <tr key={m.id} className="members-row">
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                          <Avatar name={m.name} />
                          <div style={{ minWidth: 0 }}>
                            <div className="members-name-btn" style={{
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>{m.name}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: 2 }}>
                              {day(m.join_date)}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td style={{ padding: '0.85rem 1rem' }}>
                        <div style={{ fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums' }}>{m.phone}</div>
                        {m.email && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{m.email}</div>
                        )}
                      </td>

                      {showBelt && (
                        <td style={{ padding: '0.85rem 1rem' }}>
                          {m.grade_label ? <BeltBadge label={m.grade_label} color={m.grade_color} />
                            : <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>—</span>}
                        </td>
                      )}

                      <td style={{ padding: '0.85rem 1rem' }}>
                        <span className={`badge ${SUB_TONE[sub]}`}>{SUB_LABEL[sub]}</span>
                        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: 4 }}>
                          {m.sub_expiry ? `Exp. ${day(m.sub_expiry)}` : '—'}
                        </div>
                      </td>

                      <td style={{ padding: '0.85rem 1rem' }}>
                        <span className={`badge ${INS_TONE[ins]}`}>{INS_LABEL[ins]}</span>
                        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: 4 }}>
                          {m.is_insured && m.ins_expiry ? `Exp. ${day(m.ins_expiry)}` : 'Non souscrite'}
                        </div>
                      </td>

                      <td style={{ padding: '0.85rem 1rem', position: 'relative' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {canWrite && (sub === 'expired' || sub === 'expiring') && (
                            <button className="gf-mini-btn" disabled={busy !== null}
                                    style={{ background: 'var(--gold)', borderColor: 'transparent', color: '#fff' }}
                                    onClick={() => act(`sub-${m.id}`,
                                      () => api.post(`/api/members/${m.id}/renew`, {}),
                                      `Abonnement de ${m.name} renouvelé.`)}>
                              Renouveler abo
                            </button>
                          )}
                          {canWrite && (ins === 'uninsured' || ins === 'expired' || ins === 'expiring') && (
                            <button className="gf-mini-btn" disabled={busy !== null}
                                    onClick={() => act(`ins-${m.id}`,
                                      () => api.post(`/api/members/${m.id}/insurance`, { months: 12 }),
                                      `Assurance de ${m.name} renouvelée.`)}>
                              Assurance
                            </button>
                          )}

                          <a href={waLink(m.phone, wa.message)} target="_blank" rel="noopener noreferrer"
                             title={wa.label} aria-label={wa.label}
                             style={{
                               display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                               width: 30, height: 30, borderRadius: '50%', flex: 'none',
                               background: '#25D366', color: '#fff',
                             }}>
                            <MessageCircle size={15} strokeWidth={2.2} />
                          </a>

                          <div style={{ position: 'relative' }} data-rowmenu>
                            <button className="icon-btn" style={{ width: 30, height: 30 }}
                                    title="Plus d’actions" aria-label="Plus d’actions"
                                    onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}>
                              <MoreHorizontal size={15} strokeWidth={2.1} />
                            </button>
                            {menuFor === m.id && (
                              <div className="notif-dropdown" style={{ right: 0, minWidth: 190, padding: 6 }}>
                                {canWrite && (
                                  <button className="gf-palette-item" style={{ cursor: 'pointer' }}
                                          onClick={() => { setMenuFor(null); setEditing(m) }}>
                                    <Pencil size={13} strokeWidth={2.1} /> Modifier
                                  </button>
                                )}
                                {canWrite && (
                                  <button className="gf-palette-item" style={{ cursor: 'pointer' }}
                                          onClick={() => {
                                            setMenuFor(null)
                                            act(`pay-${m.id}`,
                                              () => api.post('/api/payments', {
                                                memberId: m.id, amountCents: 0, type: 'monthly',
                                              }), '')
                                          }} disabled>
                                    <CreditCard size={13} strokeWidth={2.1} /> Encaisser
                                  </button>
                                )}
                                {canWrite && (
                                  <button className="gf-palette-item" style={{ cursor: 'pointer', color: '#f87171' }}
                                          onClick={() => {
                                            setMenuFor(null)
                                            if (!confirm(`Archiver ${m.name} ? Ses encaissements sont conservés.`)) return
                                            act(`del-${m.id}`,
                                              () => api.del(`/api/members/${m.id}`),
                                              `${m.name} a été archivé.`)
                                          }}>
                                    <Trash2 size={13} strokeWidth={2.1} /> Archiver
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {exporting && (
        <MemberExportModal members={all} branches={branches} disciplines={disciplines}
                           onClose={() => setExporting(false)} />
      )}

      {importing && (
        <MemberImportModal
          branches={branches} disciplines={disciplines}
          onClose={() => setImporting(false)}
          onDone={async created => {
            setImporting(false)
            await reload()
            setNotice(`${created} membre${created > 1 ? 's' : ''} importé${created > 1 ? 's' : ''}.`)
          }}
        />
      )}

      {(adding || editing) && (
        <MemberModal
          member={editing}
          branches={branches}
          disciplines={disciplines}
          onClose={() => { setAdding(false); setEditing(null) }}
          onSaved={async () => {
            setAdding(false); setEditing(null)
            await reload()
            setNotice(editing ? 'Membre modifié.' : 'Membre ajouté.')
          }}
        />
      )}
    </EditablePage>
  )
}

// Briques ----------------------------------------------------------------

function Th({ label, sort, sortBy, sortDir, onSort }: {
  label: string
  sort?: 'name' | 'sub_expiry'
  sortBy?: 'name' | 'sub_expiry' | null
  sortDir?: 1 | -1
  onSort?: (k: 'name' | 'sub_expiry') => void
}) {
  const on = sort && sortBy === sort
  return (
    <th className="members-th" style={{
      padding: '0.75rem 1rem', textAlign: 'start',
      fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.12em', color: on ? 'var(--gold)' : 'var(--muted)',
      whiteSpace: 'nowrap',
    }}>
      {sort && onSort ? (
        <button onClick={() => onSort(sort)} title="Trier"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, font: 'inherit',
                         color: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit' }}>
          {label}
          {on && (sortDir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
        </button>
      ) : label}
    </th>
  )
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
  return (
    <span aria-hidden="true" style={{
      width: 36, height: 36, borderRadius: '50%', flex: 'none',
      display: 'grid', placeItems: 'center',
      background: color, color: '#0b111c', fontWeight: 800, fontSize: '0.8rem',
    }}>{initials}</span>
  )
}

/**
 * La ceinture porte sa vraie couleur, declaree par le club.
 * Une pastille grise pour « ceinture noire » ne dit rien a personne.
 */
function BeltBadge({ label, color }: { label: string; color: string | null }) {
  const tint = color ?? '#94a3b8'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '0.2rem 0.6rem', borderRadius: 999,
      background: 'var(--overlay-soft)', border: '1px solid var(--hairline)',
      fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase',
      letterSpacing: '0.05em', whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: tint, flex: 'none' }} />
      {label}
    </span>
  )
}

/**
 * Bandeau d'alertes, replie par defaut.
 *
 * Une ligne quand tout va bien serait du bruit permanent : il ne s'affiche
 * que s'il a quelque chose a dire, et le detail par categorie attend le clic.
 */
function AlertsBanner({ members }: { members: MemberRow[] }) {
  const [open, setOpen] = useState(false)
  const [group, setGroup] = useState<string | null>(null)

  const groups = useMemo(() => [
    { key: 'sub_expired', label: 'Abonnement expiré', tone: '#ef4444',
      list: members.filter(m => subStatus(m) === 'expired') },
    { key: 'ins_expired', label: 'Assurance expirée', tone: '#f87171',
      list: members.filter(m => insStatus(m) === 'expired') },
    { key: 'sub_expiring', label: 'Abonnement bientôt expiré', tone: '#f59e0b',
      list: members.filter(m => subStatus(m) === 'expiring') },
    { key: 'ins_expiring', label: 'Assurance bientôt expirée', tone: '#f59e0b',
      list: members.filter(m => insStatus(m) === 'expiring') },
    { key: 'uninsured', label: 'Non assuré', tone: '#a78bfa',
      list: members.filter(m => insStatus(m) === 'uninsured') },
    { key: 'passport', label: 'Passeport sportif manquant', tone: '#a78bfa',
      list: members.filter(m => !m.sport_passport_key) },
  ].filter(g => g.list.length > 0), [members])

  if (groups.length === 0) return null
  const total = groups.reduce((s, g) => s + g.list.length, 0)

  return (
    <div style={{
      borderRadius: 18, overflow: 'hidden',
      border: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.06)',
    }}>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '0.7rem 1rem', textAlign: 'start', cursor: 'pointer',
                background: 'none', border: 0,
              }}>
        <TriangleAlert size={15} style={{ color: '#f59e0b', flex: 'none' }} />
        <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.8rem' }}>
          Alertes documents &amp; abonnements
        </span>
        <span style={{
          minWidth: '1.25rem', height: '1.25rem', borderRadius: 999, padding: '0 5px',
          display: 'inline-grid', placeItems: 'center',
          background: 'rgba(245,158,11,0.22)', color: '#fbbf24',
          fontSize: '0.66rem', fontWeight: 800,
        }}>{total}</span>
        <ChevronDown size={15} style={{
          marginInlineStart: 'auto', color: 'rgba(245,158,11,0.7)',
          transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s',
        }} />
      </button>

      {open && (
        <div style={{
          padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: 6,
          borderTop: '1px solid rgba(245,158,11,0.15)',
        }}>
          {groups.map(g => {
            const isOpen = group === g.key
            return (
              <div key={g.key} style={{
                borderRadius: 12, overflow: 'hidden',
                borderInlineStart: `2px solid ${g.tone}`, background: 'var(--overlay-soft)',
              }}>
                <button onClick={() => setGroup(isOpen ? null : g.key)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                          padding: '0.5rem 0.75rem', textAlign: 'start', cursor: 'pointer',
                          background: 'none', border: 0,
                        }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, flex: 1 }}>{g.label}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                    {g.list.length} membre{g.list.length > 1 ? 's' : ''}
                  </span>
                  <ChevronDown size={13} style={{
                    color: 'var(--muted)', transform: isOpen ? 'rotate(180deg)' : 'none',
                  }} />
                </button>
                {isOpen && (
                  <div style={{
                    padding: '0.5rem 0.75rem 0.7rem', display: 'flex', flexDirection: 'column', gap: 4,
                    borderTop: '1px solid var(--hairline)',
                  }}>
                    {g.list.map(m => (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%',
                                       background: g.tone, flex: 'none' }} />
                        <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>{m.name}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--muted)',
                                       marginInlineStart: 'auto' }}>
                          {g.key.startsWith('sub')
                            ? `${Math.abs(daysUntil(m.sub_expiry) ?? 0)} j`
                            : m.phone}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
