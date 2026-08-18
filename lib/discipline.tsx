'use client'

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react'
import { api } from '@/lib/client'

/**
 * Discipline active, partagee par toute l'application.
 *
 * L'original figeait trois disciplines dans le code. Ici la liste vient du
 * club : un club de judo en declare une, un club omnisports six, et un club
 * qui n'en a declare aucune ne voit pas le filtre du tout — afficher
 * « Toutes disciplines » quand il n'y en a aucune est un contrôle qui ne
 * contrôle rien.
 *
 * Le choix est memorise dans un cookie plutot que dans l'etat : il survit a
 * une navigation entre pages, et chaque ecran monte sa propre coquille.
 */

export interface Discipline { id: string; name: string; has_grading: number }

interface Value {
  /** Identifiant de discipline, ou 'all'. */
  active: string
  setActive: (id: string) => void
  disciplines: Discipline[]
  /** Le filtre n'a de sens qu'a partir de deux disciplines. */
  visible: boolean
  /** La discipline retenue est-elle gradee ? Sert aux ecrans de grade. */
  activeHasGrading: boolean
}

const COOKIE = 'gf-discipline'
const Ctx = createContext<Value | undefined>(undefined)

function readCookie(): string | null {
  if (typeof document === 'undefined') return null
  const hit = document.cookie.split('; ').map(c => c.split('=')).find(([n]) => n === COOKIE)
  return hit?.[1] ? decodeURIComponent(hit[1]) : null
}

function writeCookie(value: string) {
  // sameSite=Lax : ce cookie ne porte aucune autorite, seulement une
  // preference d'affichage. Il ne doit pas voyager en requete tierce.
  document.cookie = `${COOKIE}=${encodeURIComponent(value)}; path=/; max-age=31536000; sameSite=Lax`
}

export function DisciplineProvider({ children }: { children: ReactNode }) {
  const [disciplines, setDisciplines] = useState<Discipline[]>([])
  const [active, setActiveState] = useState('all')

  useEffect(() => {
    let alive = true
    api.get<{ disciplines: Discipline[] }>('/api/disciplines')
      .then(d => {
        if (!alive) return
        setDisciplines(d.disciplines)
        // Une discipline memorisee puis supprimee du club laisserait un
        // filtre actif qui ne renvoie plus rien, sans moyen de le defaire.
        const saved = readCookie()
        setActiveState(saved && d.disciplines.some(x => x.id === saved) ? saved : 'all')
      })
      .catch(() => { /* un filtre absent ne doit pas emporter la page */ })
    return () => { alive = false }
  }, [])

  const setActive = useCallback((id: string) => {
    setActiveState(id)
    writeCookie(id)
  }, [])

  const value = useMemo<Value>(() => ({
    active, setActive, disciplines,
    visible: disciplines.length > 1,
    activeHasGrading: active === 'all'
      ? disciplines.some(d => d.has_grading === 1)
      : disciplines.find(d => d.id === active)?.has_grading === 1,
  }), [active, setActive, disciplines])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Utilisable partout, y compris hors du fournisseur.
 *
 * Les ecrans de la plateforme (Clubs, Facturation, Supervision) n'ont pas de
 * club actif, donc pas de disciplines. Lever une exception les casserait ;
 * on rend un filtre inerte a la place.
 */
export function useDiscipline(): Value {
  return useContext(Ctx) ?? {
    active: 'all', setActive: () => {}, disciplines: [], visible: false, activeHasGrading: true,
  }
}
