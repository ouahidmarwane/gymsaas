'use client'
// lib/use-anim-presence.ts
// Orchestration React des états .is-open / .is-closing des snippets
// transitions.dev (dropdown, modal) : monte l'élément, ajoute is-open à la
// frame suivante (pour que la transition parte de l'état repos), puis joue
// is-closing avant de démonter.
import { useEffect, useRef, useState } from 'react'

export function useAnimPresence(closeMs = 160) {
  const [mounted, setMounted] = useState(false)
  const [openCls, setOpenCls] = useState(false)
  const [closing, setClosing] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const raf = useRef<number>(0)

  const open = () => {
    if (timer.current) clearTimeout(timer.current)
    setClosing(false)
    setMounted(true)
    // double rAF : garantit un paint dans l'état repos avant is-open
    raf.current = requestAnimationFrame(() => {
      raf.current = requestAnimationFrame(() => setOpenCls(true))
    })
  }

  const close = (after?: () => void) => {
    setOpenCls(false)
    setClosing(true)
    timer.current = setTimeout(() => {
      setClosing(false)
      setMounted(false)
      after?.()
    }, closeMs)
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    cancelAnimationFrame(raf.current)
  }, [])

  const stateClass = openCls ? 'is-open' : closing ? 'is-closing' : ''
  return { mounted, stateClass, open, close, isOpen: openCls }
}
