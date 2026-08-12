// Page d'attente : l'interface arrive avec le portage des ecrans existants.
// Sa seule utilite pour l'instant est de confirmer que le rendu Next passe
// bien par le Worker, aux cotes de l'API.
export default function Home() {
  return (
    <main style={{ padding: '4rem 1.5rem', maxWidth: '40rem', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.6rem', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
        GymFlow
      </h1>
      <p style={{ color: 'var(--ink-muted)', lineHeight: 1.6 }}>
        Plateforme de gestion de clubs sportifs. L&apos;API est disponible sous{' '}
        <code>/api</code>.
      </p>
    </main>
  )
}
