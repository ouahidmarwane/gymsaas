'use client'
import { useMemo } from 'react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { parseISO, getMonth, getYear, format, subMonths, startOfMonth } from 'date-fns'
import { fr } from 'date-fns/locale'

interface MemberData {
  id: string
  join_date: string | null
  sub_expiry: string | null
  is_insured: boolean
  sub_status: string
  ins_status: string
  branch: string
  grade?: number | null
}

interface Props {
  members: MemberData[]
  allMembers: MemberData[]
  activeBranch: string
}

const C = {
  gold:   '#2f6bff',
  green:  '#10b981',
  red:    '#ef4444',
  violet: '#9b72ff',
  blue:   '#4d8cff',
  amber:  '#f59e0b',
  muted:  '#8c95a8',
}

/* ── Shared tooltip ────────────────────────────────── */
function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(10,13,22,0.97)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 14,
      padding: '10px 14px',
      fontSize: 12,
      backdropFilter: 'blur(16px)',
      boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
    }}>
      {label && <div style={{ color: C.muted, fontWeight: 700, marginBottom: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color || p.fill }} />
          <span style={{ color: '#f5f3ef', fontWeight: 600 }}>{p.name}: </span>
          <span style={{ color: p.color || p.fill, fontWeight: 700 }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Chart card wrapper ────────────────────────────── */
function ChartCard({ title, subtitle, children, delay = 0 }: {
  title: string; subtitle?: string; children: React.ReactNode; delay?: number
}) {
  return (
    <div
      className="dash-chart-card"
      style={{ animation: `fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) forwards`, animationDelay: `${delay}ms`, opacity: 0 }}
    >
      <div className="dash-chart-header">
        <div>
          <div className="dash-chart-title">{title}</div>
          {subtitle && <div className="dash-chart-sub">{subtitle}</div>}
        </div>
      </div>
      {children}
    </div>
  )
}

export default function DashboardCharts({ members, allMembers, activeBranch }: Props) {

  /* ── 1. Member growth — last 12 months cumulative ── */
  const growthData = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 12 }, (_, i) => {
      const monthStart = startOfMonth(subMonths(now, 11 - i))
      const label = format(monthStart, 'MMM', { locale: fr })
      const cumulative = allMembers.filter(m => {
        if (!m.join_date) return false
        return parseISO(m.join_date) <= monthStart
      }).length
      const thisBranch = members.filter(m => {
        if (!m.join_date) return false
        return parseISO(m.join_date) <= monthStart
      }).length
      return { month: label, Total: cumulative, Branche: thisBranch }
    })
  }, [members, allMembers])

  /* ── 2. New members per month (last 8 months) ──── */
  const newPerMonth = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 8 }, (_, i) => {
      const monthStart = startOfMonth(subMonths(now, 7 - i))
      const y = getYear(monthStart)
      const mo = getMonth(monthStart)
      const label = format(monthStart, 'MMM yy', { locale: fr })
      const count = members.filter(m => {
        if (!m.join_date) return false
        const d = parseISO(m.join_date)
        return getYear(d) === y && getMonth(d) === mo
      }).length
      return { month: label, Nouveaux: count }
    })
  }, [members])

  /* ── 3. Subscription status donut ────────────────── */
  const subStatusData = useMemo(() => {
    const active   = members.filter(m => m.sub_status === 'active').length
    const expiring = members.filter(m => m.sub_status === 'expiring').length
    const expired  = members.filter(m => m.sub_status === 'expired').length
    return [
      { name: 'Actifs',           value: active,   color: C.green  },
      { name: 'Expire bientôt',   value: expiring, color: C.amber  },
      { name: 'Expirés',          value: expired,  color: C.red    },
    ].filter(d => d.value > 0)
  }, [members])

  /* ── 4. Insurance status donut ───────────────────── */
  const insStatusData = useMemo(() => {
    const insured   = members.filter(m => m.ins_status === 'active').length
    const expiring  = members.filter(m => m.ins_status === 'expiring').length
    const uninsured = members.filter(m => ['uninsured', 'expired'].includes(m.ins_status)).length
    return [
      { name: 'Assurés',      value: insured,   color: C.green  },
      { name: 'Expire bientôt', value: expiring, color: C.amber  },
      { name: 'Non assurés',  value: uninsured, color: C.red    },
    ].filter(d => d.value > 0)
  }, [members])

  /* ── 5. Grade distribution bar ───────────────────── */
  const gradeData = useMemo(() => {
    const LABELS = ['Débutant','Blanc','Jaune','Orange','Vert','Bleu','Violet','Marron','Noir 1','Noir 2','Noir 3','Rouge','Rouge-Blanc']
    const counts: Record<number, number> = {}
    members.forEach(m => {
      const g = m.grade ?? 0
      counts[g] = (counts[g] ?? 0) + 1
    })
    return Object.entries(counts)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([grade, count]) => ({
        grade: LABELS[Number(grade)] ?? `Grade ${grade}`,
        Membres: count,
      }))
  }, [members])

  const total = members.length

  /* ── DonutLabel renderer ─────────────────────────── */
  const renderDonutLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    if (percent < 0.08) return null
    const RADIAN = Math.PI / 180
    const r = innerRadius + (outerRadius - innerRadius) * 0.5
    const x = cx + r * Math.cos(-midAngle * RADIAN)
    const y = cy + r * Math.sin(-midAngle * RADIAN)
    return (
      <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    )
  }

  if (total === 0) return null

  return (
    <div className="dash-charts-shell">

      {/* Row 1: Growth area + new per month bar */}
      <div className="dash-charts-row-2">
        <ChartCard title="Croissance des membres" subtitle="Évolution cumulative — 12 derniers mois" delay={0}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={growthData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
              <defs>
                <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.gold}   stopOpacity={0.28} />
                  <stop offset="95%" stopColor={C.gold}   stopOpacity={0}    />
                </linearGradient>
                <linearGradient id="gradBranch" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.violet} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={C.violet} stopOpacity={0}    />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<Tip />} />
              <Area type="monotone" dataKey="Total"   stroke={C.gold}   strokeWidth={2} fill="url(#gradTotal)"   dot={false} />
              <Area type="monotone" dataKey="Branche" stroke={C.violet} strokeWidth={2} fill="url(#gradBranch)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
          <div className="dash-chart-legend">
            <span style={{ color: C.gold }}>⬤</span> <span>Tous</span>
            <span style={{ color: C.violet, marginLeft: 12 }}>⬤</span> <span>Branche</span>
          </div>
        </ChartCard>

        <ChartCard title="Nouveaux membres" subtitle="Inscriptions par mois" delay={80}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={newPerMonth} margin={{ top: 4, right: 4, left: -28, bottom: 0 }} barSize={18}>
              <defs>
                <linearGradient id="gradBar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={C.blue} stopOpacity={0.9} />
                  <stop offset="100%" stopColor={C.blue} stopOpacity={0.4} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<Tip />} cursor={{ fill: 'rgba(255,255,255,0.04)', radius: 6 }} />
              <Bar dataKey="Nouveaux" fill="url(#gradBar)" radius={[6,6,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 2: Sub donut + Ins donut + Grade bar */}
      <div className="dash-charts-row-3">
        <ChartCard title="Abonnements" subtitle={`${total} membres · branche`} delay={160}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <ResponsiveContainer width={130} height={130}>
              <PieChart>
                <Pie
                  data={subStatusData} cx="50%" cy="50%"
                  innerRadius={38} outerRadius={60}
                  dataKey="value" strokeWidth={2} stroke="rgba(0,0,0,0.4)"
                  labelLine={false} label={renderDonutLabel}
                >
                  {subStatusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip content={<Tip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="dash-donut-legend">
              {subStatusData.map((d, i) => (
                <div key={i} className="dash-donut-item">
                  <div className="dash-donut-dot" style={{ background: d.color }} />
                  <span className="dash-donut-label">{d.name}</span>
                  <span className="dash-donut-val">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </ChartCard>

        <ChartCard title="Assurances" subtitle={`Statut · branche`} delay={240}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <ResponsiveContainer width={130} height={130}>
              <PieChart>
                <Pie
                  data={insStatusData} cx="50%" cy="50%"
                  innerRadius={38} outerRadius={60}
                  dataKey="value" strokeWidth={2} stroke="rgba(0,0,0,0.4)"
                  labelLine={false} label={renderDonutLabel}
                >
                  {insStatusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip content={<Tip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="dash-donut-legend">
              {insStatusData.map((d, i) => (
                <div key={i} className="dash-donut-item">
                  <div className="dash-donut-dot" style={{ background: d.color }} />
                  <span className="dash-donut-label">{d.name}</span>
                  <span className="dash-donut-val">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </ChartCard>

        {gradeData.length > 0 && (
          <ChartCard title="Niveaux de grade" subtitle="Distribution · branche" delay={320}>
            <ResponsiveContainer width="100%" height={130}>
              <BarChart data={gradeData} margin={{ top: 4, right: 4, left: -32, bottom: 0 }} barSize={14}>
                <defs>
                  <linearGradient id="gradGrade" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={C.gold}   stopOpacity={0.9} />
                    <stop offset="100%" stopColor={C.violet} stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="grade" tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} interval={0} />
                <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<Tip />} cursor={{ fill: 'rgba(255,255,255,0.04)', radius: 6 }} />
                <Bar dataKey="Membres" fill="url(#gradGrade)" radius={[5,5,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
      </div>

    </div>
  )
}
