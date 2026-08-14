'use client'

import Link from 'next/link'

// Le contenu des cartes du tableau de bord.
//
// Aucune bibliotheque de graphiques : ces visuels sont de petites surfaces
// (une sparkline, un anneau, quelques barres) que du SVG rend mieux qu'un
// moteur generaliste — et sans 200 Ko de plus dans le paquet, ce qui compte
// sur un telephone en 3G.

export interface Stats {
  membersTotal: number
  membersActive: number
  subsExpiring: number
  insuranceMissing: number
  revenueMonthCents: number
  alertsCount: number
  growth: Array<{ month: string; total: number }>
  revenue: Array<{ month: string; cents: number }>
  grades: Array<{ label: string; color: string | null; count: number }>
  recentMembers: Array<{ id: string; name: string; join_date: string }>
  upcomingGrades: Array<{ id: string; member_name: string; scheduled_date: string; to_label: string | null }>
  branchSplit: Array<{ name: string; count: number }>
}

const dh = (cents: number) => `${(cents / 100).toLocaleString('fr-MA')} DH`
const AVATAR_COLORS = ['#2f6bff', '#4d8cff', '#9b72ff', '#7ea5ff', '#8b5cf6', '#16a34a']

export function renderCard(id: string, stats: Stats, label: string) {
  switch (id) {
    case 'members_total':
      return <Metric label={label} value={stats.membersTotal} note="inscrits" />
    case 'members_active':
      return <Metric label={label} value={stats.membersActive} note="abonnement a jour" />
    case 'subs_expiring':
      return <Metric label={label} value={stats.subsExpiring} note="sous 7 jours"
                     tone={stats.subsExpiring > 0 ? 'warn' : undefined} href="/members" />
    case 'insurance_missing':
      return <Metric label={label} value={stats.insuranceMissing} note="a regulariser"
                     tone={stats.insuranceMissing > 0 ? 'danger' : undefined} href="/members" />
    case 'revenue_month':
      return <Metric label={label} value={dh(stats.revenueMonthCents)} note="ce mois-ci" href="/comptabilite" />
    case 'alerts_unread':
      return <Metric label={label} value={stats.alertsCount} note="a traiter"
                     tone={stats.alertsCount > 0 ? 'warn' : undefined} href="/members" />

    case 'growth_chart':
      return <Sparkline label={label} points={stats.growth.map(g => g.total)}
                        captions={stats.growth.map(g => g.month)} suffix="membres" />
    case 'revenue_chart':
      return <Bars label={label} values={stats.revenue.map(r => r.cents)}
                   captions={stats.revenue.map(r => r.month)} format={dh} />
    case 'grade_progress':
      return <GradeBars label={label} grades={stats.grades} />
    case 'recent_members':
      return <RecentMembers label={label} members={stats.recentMembers} />
    case 'upcoming_grades':
      return <UpcomingGrades label={label} sessions={stats.upcomingGrades} />
    case 'branch_split':
      return <BranchSplit label={label} branches={stats.branchSplit} />
    default:
      return <Metric label={label} value="—" />
  }
}

// Blocs -----------------------------------------------------------------

function Metric({
  label, value, note, tone, href,
}: {
  label: string; value: number | string; note?: string
  tone?: 'warn' | 'danger'; href?: string
}) {
  const color = tone === 'danger' ? '#fca5a5' : tone === 'warn' ? '#fcd34d' : 'var(--text)'
  const body = (
    // « mini » : ces trois lignes tiennent dans une rangee de grille. Aux
    // tailles de la page d'accueil elles debordaient, et le trop-plein etait
    // simplement coupe par la carte.
    <div className="dz-metric-mini"
         style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' }}>
      <span className="dz-metric-name">{label}</span>
      <span className="dz-metric-value" style={{ margin: '2px 0 1px', color }}>
        {typeof value === 'number' ? value.toLocaleString('fr-MA') : value}
      </span>
      {note && <span className="dz-card-note">{note}</span>}
    </div>
  )
  // Une carte qui compte un probleme mene a l'ecran ou on le corrige.
  return href
    ? <Link href={href} style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%' }}>{body}</Link>
    : body
}

function Frame({ label, children, footer }: {
  label: string; children: React.ReactNode; footer?: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <span className="dz-metric-name">{label}</span>
      <div style={{ flex: 1, minHeight: 0, marginTop: 8 }}>{children}</div>
      {footer && <div className="dz-card-note" style={{ marginTop: 6 }}>{footer}</div>}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--muted)', fontSize: '0.8rem', textAlign: 'center', padding: '0 8px',
    }}>{children}</div>
  )
}

/** Courbe cumulee. Trace en viewBox pour s'etirer a la taille de la carte. */
function Sparkline({ label, points, captions, suffix }: {
  label: string; points: number[]; captions: string[]; suffix: string
}) {
  if (points.length < 2 || points.every(p => p === 0)) {
    return <Frame label={label}><Empty>Pas encore assez d&apos;historique.</Empty></Frame>
  }

  const max = Math.max(...points, 1)
  const min = Math.min(...points, 0)
  const span = max - min || 1
  const step = 100 / (points.length - 1)
  const y = (v: number) => 100 - ((v - min) / span) * 92 - 4

  const line = points.map((p, i) => `${i * step},${y(p)}`).join(' ')
  const area = `0,100 ${line} 100,100`
  const last = points[points.length - 1]!

  return (
    <Frame
      label={label}
      footer={`${captions[0]} → ${captions[captions.length - 1]} · ${last} ${suffix}`}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none"
           style={{ width: '100%', height: '100%', display: 'block' }} aria-hidden="true">
        <defs>
          <linearGradient id="gf-spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#gf-spark)" />
        <polyline points={line} fill="none" stroke="var(--gold)" strokeWidth="1.6"
                  vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{last} {suffix} au dernier mois.</span>
    </Frame>
  )
}

function Bars({ label, values, captions, format }: {
  label: string; values: number[]; captions: string[]; format: (n: number) => string
}) {
  if (values.length === 0 || values.every(v => v === 0)) {
    return <Frame label={label}><Empty>Aucun encaissement enregistre.</Empty></Frame>
  }
  const max = Math.max(...values, 1)
  const total = values.reduce((a, b) => a + b, 0)

  return (
    <Frame label={label} footer={`${format(total)} sur la periode`}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: '100%' }}>
        {values.map((v, i) => (
          <div key={i} title={`${captions[i]} · ${format(v)}`}
               style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
            <div style={{
              height: `${Math.max((v / max) * 100, 2)}%`,
              background: 'linear-gradient(180deg, var(--gold), rgba(47,107,255,0.35))',
              borderRadius: '5px 5px 0 0', minHeight: 3,
            }} />
          </div>
        ))}
      </div>
    </Frame>
  )
}

function GradeBars({ label, grades }: {
  label: string; grades: Array<{ label: string; color: string | null; count: number }>
}) {
  if (grades.length === 0) {
    return <Frame label={label}><Empty>Aucun membre grade pour l&apos;instant.</Empty></Frame>
  }
  const max = Math.max(...grades.map(g => g.count), 1)

  return (
    <Frame label={label}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflow: 'auto', height: '100%' }}>
        {grades.map(g => (
          <div key={g.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem' }}>
            <span style={{
              width: 9, height: 9, borderRadius: '50%', flex: 'none',
              background: g.color ?? 'var(--muted)',
              boxShadow: 'inset 0 0 0 1px var(--border-hover)',
            }} />
            <span style={{ flex: '0 0 5.5rem', color: 'var(--muted)', overflow: 'hidden',
                           textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.label}</span>
            <span style={{ flex: 1, height: 6, borderRadius: 999, background: 'var(--overlay)' }}>
              <span style={{
                display: 'block', height: '100%', borderRadius: 999,
                width: `${(g.count / max) * 100}%`, background: g.color ?? 'var(--gold)',
              }} />
            </span>
            <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{g.count}</span>
          </div>
        ))}
      </div>
    </Frame>
  )
}

function RecentMembers({ label, members }: {
  label: string; members: Array<{ id: string; name: string; join_date: string }>
}) {
  if (members.length === 0) {
    return <Frame label={label}><Empty>Aucun membre inscrit.</Empty></Frame>
  }
  return (
    <Frame label={label}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, overflow: 'auto', height: '100%' }}>
        {members.map(m => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{
              width: 26, height: 26, borderRadius: '50%', flex: 'none',
              display: 'grid', placeItems: 'center',
              background: AVATAR_COLORS[m.name.charCodeAt(0) % AVATAR_COLORS.length],
              color: '#fff', fontSize: '0.62rem', fontWeight: 700,
            }}>{m.name.slice(0, 2).toUpperCase()}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: '0.82rem', fontWeight: 600,
                           overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.name}
            </span>
            <span className="dz-card-note" style={{ flex: 'none' }}>
              {new Date(m.join_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
            </span>
          </div>
        ))}
      </div>
    </Frame>
  )
}

function UpcomingGrades({ label, sessions }: {
  label: string
  sessions: Array<{ id: string; member_name: string; scheduled_date: string; to_label: string | null }>
}) {
  if (sessions.length === 0) {
    return <Frame label={label}><Empty>Aucun passage programme.</Empty></Frame>
  }
  return (
    <Frame label={label}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, overflow: 'auto', height: '100%' }}>
        {sessions.map(s => {
          const days = Math.ceil((Date.parse(s.scheduled_date) - Date.now()) / 86_400_000)
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: '0.82rem' }}>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden',
                             textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.member_name}</span>
              {s.to_label && <span className="dz-card-note" style={{ flex: 'none' }}>{s.to_label}</span>}
              <span className={`badge ${days < 0 ? 'text-red-300 bg-red-500/10 ring-red-500/30' : ''}`}
                    style={{ fontSize: '0.58rem', flex: 'none' }}>
                {days < 0 ? 'en retard' : days === 0 ? "aujourd'hui" : `J-${days}`}
              </span>
            </div>
          )
        })}
      </div>
    </Frame>
  )
}

function BranchSplit({ label, branches }: {
  label: string; branches: Array<{ name: string; count: number }>
}) {
  const total = branches.reduce((a, b) => a + b.count, 0)
  if (total === 0) {
    return <Frame label={label}><Empty>Aucun membre rattache a une salle.</Empty></Frame>
  }
  const palette = ['#2f6bff', '#9b72ff', '#16a34a', '#f59e0b', '#ef4444', '#0d9488']

  return (
    <Frame label={label} footer={`${total} membres au total`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
        {/* Barre empilee : la proportion se lit d'un coup, sans legende a croiser. */}
        <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden',
                      background: 'var(--overlay)' }}>
          {branches.map((b, i) => (
            <span key={b.name} title={`${b.name} · ${b.count}`}
                  style={{ width: `${(b.count / total) * 100}%`, background: palette[i % palette.length] }} />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, overflow: 'auto' }}>
          {branches.map((b, i) => (
            <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none',
                             background: palette[i % palette.length] }} />
              <span style={{ flex: 1, minWidth: 0, color: 'var(--muted)', overflow: 'hidden',
                             textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{b.count}</span>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  )
}
