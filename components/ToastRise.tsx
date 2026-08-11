'use client'
// components/ToastRise.tsx — toast qui monte du bas (transition « toast »
// de transitions.dev) : monté sans is-open, la classe arrive à la frame
// suivante pour que la transition parte de l'état repos.
import { useEffect, useState, type ReactNode } from 'react'

export default function ToastRise({ className = '', children }: { className?: string; children: ReactNode }) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)))
    return () => cancelAnimationFrame(id)
  }, [])
  return <div className={`${className} t-toast${on ? ' is-open' : ''}`}>{children}</div>
}
