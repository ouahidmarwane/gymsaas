import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Page annoncee dans la navigation mais pas encore portee.
 *
 * Mieux vaut une page honnete qu'un 404 : l'utilisateur apprend que la
 * fonction existe et ou elle en est, au lieu de croire l'application cassee.
 */
export default function ComingSoon({
  title, icon, children,
}: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="dashboard-shell">
      <div>
        <h1 className="dz-hello">{title}</h1>
      </div>
      <section className="dz-card">
        <div className="gf-placeholder">
          <span className="gf-placeholder-icon">{icon}</span>
          <h2 className="gf-placeholder-title">En cours de portage</h2>
          <p className="gf-placeholder-body">{children}</p>
          <Link className="btn-ghost" href="/dashboard" style={{ marginTop: 8 }}>
            Retour au tableau de bord
          </Link>
        </div>
      </section>
    </div>
  )
}
