'use client'

import { RotateCw } from 'lucide-react'

/**
 * Bandeau d'erreur unique pour toutes les pages.
 *
 * Il existait en six exemplaires, chacun avec ses styles en ligne : une
 * correction de ton ou d'accessibilite devait etre repetee six fois, et la
 * septieme copie avait deja divergé. Un seul endroit, un seul comportement —
 * annonce aux lecteurs d'ecran, et une action de reprise quand elle a du sens.
 */
export default function PageState({
  error, onRetry,
}: { error: string | null; onRetry?: () => void }) {
  return (
    <div aria-live="polite">
      {error && (
        <div role="alert" style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '0.7rem 1rem', borderRadius: 14,
          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#fca5a5', fontSize: '0.85rem', fontWeight: 600,
        }}>
          <span style={{ flex: 1, minWidth: 0 }}>{error}</span>
          {onRetry && (
            <button className="btn-ghost" onClick={onRetry}
                    style={{ padding: '0.3rem 0.8rem', fontSize: '0.75rem', flex: 'none' }}>
              <RotateCw size={13} strokeWidth={2.2} /> Reessayer
            </button>
          )}
        </div>
      )}
    </div>
  )
}
