// lib/whatsapp.ts

export function formatMoroccanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('212')) return digits
  if (digits.startsWith('0')) return '212' + digits.slice(1)
  return '212' + digits
}

export function generateWhatsAppLink(phone: string, message: string): string {
  const number = formatMoroccanPhone(phone)
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
}

// Choisit le bon message selon la situation du membre :
// abonnement expiré > abonnement qui expire > assurance expirée >
// assurance qui expire > pas d'assurance > tout en règle (message générique).
export function whatsappForMember(m: {
  name: string
  sub_status: string
  ins_status: string
  sub_days_left?: number | null
  ins_days_left?: number | null
}): { message: string; label: string } {
  if (m.sub_status === 'expired') {
    return { message: WHATSAPP_TEMPLATES.sub_expired(m.name), label: 'Rappel : abonnement expiré' }
  }
  if (m.sub_status === 'expiring') {
    return { message: WHATSAPP_TEMPLATES.sub_expiring(m.name, Math.max(0, m.sub_days_left ?? 0)), label: 'Rappel : abonnement expire bientôt' }
  }
  if (m.ins_status === 'expired') {
    return { message: WHATSAPP_TEMPLATES.ins_expired(m.name), label: 'Rappel : assurance expirée' }
  }
  if (m.ins_status === 'expiring') {
    return { message: WHATSAPP_TEMPLATES.ins_expiring(m.name, Math.max(0, m.ins_days_left ?? 0)), label: 'Rappel : assurance expire bientôt' }
  }
  if (m.ins_status === 'uninsured') {
    return { message: WHATSAPP_TEMPLATES.ins_missing(m.name), label: 'Rappel : assurance manquante' }
  }
  return { message: WHATSAPP_TEMPLATES.generic(m.name), label: 'Message WhatsApp' }
}

export const WHATSAPP_TEMPLATES = {
  sub_expiring: (name: string, days: number) => `Bonjour ${name},

Votre abonnement à notre salle de sport expire dans ${days} jour(s).
Merci de nous contacter pour le renouveler avant la date d'expiration.
Nous restons à votre disposition.

— Association Noujoum el Chaouia

---

مرحبا ${name}،

اشتراكك في قاعتنا الرياضية سينتهي خلال ${days} يوم/أيام.
نرجو منك التواصل معنا لتجديده قبل انتهاء المدة.
نحن في خدمتك دائماً.

— جمعية نجوم الشاوية`,

  sub_expired: (name: string) => `Bonjour ${name},

Votre abonnement à notre salle de sport a expiré.
Nous serions ravis de vous revoir parmi nous !
Contactez-nous pour renouveler votre abonnement.

— Association Noujoum el Chaouia

---

مرحبا ${name}،

لقد انتهى اشتراكك في قاعتنا الرياضية.
يسعدنا استقبالك مجدداً في صفوفنا!
تواصل معنا لتجديد اشتراكك.

— جمعية نجوم الشاوية`,

  ins_expiring: (name: string, days: number) => `Bonjour ${name},

Votre assurance sportive expire dans ${days} jour(s).
Rappel : l'assurance est obligatoire pour accéder à notre salle.
Merci de la renouveler avant la date d'expiration.

— Association Noujoum el Chaouia

---

مرحبا ${name}،

تأمينك الرياضي سينتهي خلال ${days} يوم/أيام.
تذكير: التأمين إلزامي للدخول إلى قاعتنا الرياضية.
نرجو منك تجديده قبل انتهاء المدة.

— جمعية نجوم الشاوية`,

  ins_expired: (name: string) => `Bonjour ${name},

Votre assurance sportive a expiré.
L'assurance est obligatoire pour continuer à accéder à notre salle.
Merci de la renouveler dans les plus brefs délais.

— Association Noujoum el Chaouia

---

مرحبا ${name}،

لقد انتهى تأمينك الرياضي.
التأمين إلزامي لمواصلة الدخول إلى قاعتنا الرياضية.
نرجو منك تجديده في أقرب وقت ممكن.

— جمعية نجوم الشاوية`,

  ins_missing: (name: string) => `Bonjour ${name},

Nous n'avons pas encore reçu votre assurance sportive.
L'assurance est obligatoire pour accéder à notre salle de sport.
Merci de nous communiquer votre attestation d'assurance.

— Association Noujoum el Chaouia

---

مرحبا ${name}،

لم نتلقَّ بعد وثيقة تأمينك الرياضي.
التأمين إلزامي للدخول إلى قاعتنا الرياضية.
نرجو منك إرسال شهادة التأمين الخاصة بك.

— جمعية نجوم الشاوية`,

  generic: (name: string) => `Bonjour ${name},

Nous vous contactons de la part de notre salle de sport.
N'hésitez pas à nous contacter pour toute question.

— Association Noujoum el Chaouia

---

مرحبا ${name}،

نتواصل معك من طرف قاعتنا الرياضية.
لا تتردد في التواصل معنا لأي استفسار.

— جمعية نجوم الشاوية`,
}
