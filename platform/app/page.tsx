import { redirect } from 'next/navigation'

// Le middleware decide vraiment ou aller ; ici on renvoie simplement vers
// l'application, qui redirigera vers /login si la session manque.
export default function Home() {
  redirect('/dashboard')
}
