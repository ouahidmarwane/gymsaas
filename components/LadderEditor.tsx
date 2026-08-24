'use client'

import { useState } from 'react'
import { Plus, Trash2, ChevronUp, ChevronDown, Check } from 'lucide-react'
import { api, ApiError } from '@/lib/client'

/**
 * Echelle de grades d'une discipline.
 *
 * Les echelles etaient choisies dans une liste figee — karate, judo,
 * taekwondo — et seulement a la creation du sport. Un club qui enseigne
 * autre chose repartait avec des ceintures qui ne sont pas les siennes, et
 * personne ne pouvait plus y toucher : la route `PUT
 * /api/disciplines/:id/grades` existait sans qu'aucun ecran ne l'appelle.
 *
 * L'ORDRE EST LE GRADE. Le rang d'un niveau, c'est sa position dans la
 * liste : premier = debutant, dernier = plus haut. D'ou les fleches plutot
 * qu'un champ « rang » a remplir — un numero qu'on saisit se contredit tot
 * ou tard avec l'ordre affiche.
 *
 * Les identifiants des niveaux existants repartent avec la liste. C'est ce
 * qui permet de renommer une ceinture sans que les membres qui la portent
 * perdent leur grade : le serveur reconnait la ligne au lieu d'en creer une
 * nouvelle.
 */

export interface Level {
  /** Absent pour un niveau qui n'a pas encore ete enregistre. */
  id?: string
  label: string
  color?: string | null
}

/** Couleurs de ceinture usuelles. Un niveau peut n'en avoir aucune. */
const SWATCHES = [
  '#f8fafc', '#facc15', '#fb923c', '#22c55e',
  '#3b82f6', '#a855f7', '#92400e', '#dc2626', '#111827',
]

export default function LadderEditor({
  disciplineId, initial, onSaved,
}: {
  disciplineId: string
  initial: Level[]
  onSaved: () => void | Promise<void>
}) {
  const [levels, setLevels] = useState<Level[]>(initial)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // La liste locale peut differer de celle du serveur tant qu'on n'a pas
  // enregistre : le bouton ne doit pas dire « a jour » pendant ce temps.
  const dirty = JSON.stringify(levels) !== JSON.stringify(initial)

  function edit(next: Level[]) { setLevels(next); setSaved(false) }

  function move(index: number, by: number) {
    const target = index + by
    if (target < 0 || target >= levels.length) return
    const next = [...levels]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    edit(next)
  }

  async function persist() {
    setBusy(true); setError(null)
    try {
      // Les niveaux partent avec leur id : sans lui, le serveur les prendrait
      // pour des nouveaux et chaque membre perdrait sa ceinture.
      await api.put(`/api/disciplines/${disciplineId}/grades`, {
        grades: levels.map(l => ({ id: l.id, label: l.label, color: l.color ?? null })),
      })
      await onSaved()
      setSaved(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Enregistrement impossible')
    } finally { setBusy(false) }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <ol className="ladder-list">
        {levels.map((level, i) => (
          <li key={level.id ?? `new-${i}`} className="ladder-row">
            <span className="ladder-rank" aria-hidden="true">{i + 1}</span>

            <input
              className="input-dark ladder-label"
              value={level.label}
              maxLength={60}
              aria-label={`Nom du niveau ${i + 1}`}
              onChange={e => edit(levels.map((l, k) => k === i ? { ...l, label: e.target.value } : l))}
            />

            {/* La couleur est une donnee, pas une decoration : une ceinture
                verte reste verte dans les cinq habillages. C'est la seule
                chose de cet ecran qui ne suit pas var(--gold). */}
            <span className="ladder-swatches" role="group" aria-label={`Couleur du niveau ${i + 1}`}>
              {SWATCHES.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`ladder-swatch${level.color === c ? ' on' : ''}`}
                  style={{ background: c }}
                  aria-label={c}
                  aria-pressed={level.color === c}
                  onClick={() => edit(levels.map((l, k) =>
                    k === i ? { ...l, color: l.color === c ? null : c } : l))}
                />
              ))}
            </span>

            <span className="ladder-actions">
              <button type="button" className="gf-hide" disabled={i === 0}
                      aria-label={`Monter ${level.label || `le niveau ${i + 1}`}`}
                      onClick={() => move(i, -1)}>
                <ChevronUp size={14} strokeWidth={2.3} />
              </button>
              <button type="button" className="gf-hide" disabled={i === levels.length - 1}
                      aria-label={`Descendre ${level.label || `le niveau ${i + 1}`}`}
                      onClick={() => move(i, 1)}>
                <ChevronDown size={14} strokeWidth={2.3} />
              </button>
              <button type="button" className="gf-hide"
                      aria-label={`Retirer ${level.label || `le niveau ${i + 1}`}`}
                      onClick={() => edit(levels.filter((_, k) => k !== i))}>
                <Trash2 size={14} strokeWidth={2.2} />
              </button>
            </span>
          </li>
        ))}
        {levels.length === 0 && (
          <li className="dz-card-note">
            Aucun niveau. Ajoutez le premier ci-dessous — il sera le plus bas de l&apos;échelle.
          </li>
        )}
      </ol>

      <div className="ladder-add">
        <input
          className="input-dark"
          placeholder="Nom du niveau, ex. Ceinture blanche"
          value={label}
          maxLength={60}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => {
            // Entree ajoute : saisir dix ceintures a la souris est une corvee.
            // Pas de <form> ici — il serait imbrique dans celui du sport.
            if (e.key !== 'Enter' || !label.trim()) return
            e.preventDefault()
            edit([...levels, { label: label.trim(), color: null }])
            setLabel('')
          }}
        />
        <button type="button" className="btn-ghost"
                style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}
                disabled={!label.trim()}
                onClick={() => { edit([...levels, { label: label.trim(), color: null }]); setLabel('') }}>
          <Plus size={14} strokeWidth={2.4} /> Ajouter un niveau
        </button>

        <button type="button" className="btn-dark"
                style={{ padding: '0.5rem 1rem', fontSize: '0.8rem',
                         background: 'var(--gold)', borderColor: 'transparent' }}
                disabled={busy || !dirty || levels.some(l => !l.label.trim())}
                onClick={persist}>
          {busy ? 'Enregistrement…' : saved && !dirty ? <><Check size={14} strokeWidth={2.4} /> À jour</> : 'Enregistrer l’échelle'}
        </button>
      </div>

      <div aria-live="polite">
        {error && <p role="alert" className="mdet-problem" style={{ marginTop: 8 }}>{error}</p>}
      </div>
    </div>
  )
}
