'use client'
// components/MetricSpark.tsx — mini-courbe (chargée en différé pour sortir
// recharts du bundle initial du dashboard).
import { AreaChart, Area, ResponsiveContainer } from 'recharts'

export default function MetricSpark({ data, color }: { data: Array<{ v: number }>; color: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 2, left: 2, bottom: 0 }}>
        <defs>
          <linearGradient id={`dzfill-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2.2}
          fill={`url(#dzfill-${color.slice(1)})`} dot={{ r: 2, fill: color, strokeWidth: 0 }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
