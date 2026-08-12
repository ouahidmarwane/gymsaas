import { User } from 'lucide-react'
import ComingSoon from '@/components/ComingSoon'

export default function Page() {
  return (
    <ComingSoon title="Mon compte" icon={<User size={40} strokeWidth={1.6} />}>
      Nom, e-mail et mot de passe. Le changement de mot de passe passera par la meme verification qu'avant.
    </ComingSoon>
  )
}