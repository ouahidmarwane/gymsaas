# GymFlow 🏋️

Plateforme de gestion de salle de sport — Next.js + Supabase + Vercel.

## Stack

| Couche | Outil | Coût |
|--------|-------|------|
| Frontend | Next.js 14 (App Router) | Gratuit |
| Hébergement | Vercel | Gratuit |
| Base de données | Supabase (PostgreSQL) | Gratuit |
| Auth | Supabase Auth | Gratuit |
| Emails | Resend (100/jour) | Gratuit |
| Cron rappels | Supabase Edge Functions | Gratuit |

## Fonctionnalités

- ✅ Gestion des membres (CRUD)
- 📅 Suivi des abonnements mensuels
- 🛡️ Suivi des assurances annuelles
- 🔔 Alertes & rappels automatiques (email + plateforme)
- 👥 Gestion des rôles (Admin / Réceptionniste / Lecteur)
- 🔐 Row Level Security Supabase

---

## Installation

### 1. Cloner et installer

```bash
git clone https://github.com/votre-repo/gymflow.git
cd gymflow
npm install
```

### 2. Créer le projet Supabase

1. Aller sur [supabase.com](https://supabase.com) → New Project
2. Copier l'URL et les clés API depuis Settings → API
3. Copier `.env.local.example` → `.env.local` et remplir les valeurs

### 3. Initialiser la base de données

Dans Supabase Dashboard → SQL Editor, copier-coller et exécuter :
```
supabase/migrations/001_schema.sql
```

### 4. Créer le premier compte admin

Dans Supabase Dashboard → Authentication → Users → Add User :
- Email : `admin@votresalle.ma`
- Password : (choisir un mot de passe fort)

Puis dans SQL Editor :
```sql
UPDATE profiles SET role = 'admin' WHERE email = 'admin@votresalle.ma';
```

### 5. Configurer Resend (emails)

1. Créer un compte sur [resend.com](https://resend.com) (gratuit)
2. Ajouter et vérifier votre domaine
3. Créer une clé API → mettre dans `.env.local`

### 6. Déployer la Edge Function

```bash
# Installer Supabase CLI
npm install -g supabase

# Login
supabase login

# Lier au projet
supabase link --project-ref VOTRE_PROJECT_REF

# Déployer la fonction
supabase functions deploy send-reminders

# Ajouter les secrets
supabase secrets set RESEND_API_KEY=re_XXXXXXX
supabase secrets set FROM_EMAIL="GymFlow <noreply@votresalle.ma>"
```

### 7. Configurer le cron dans Supabase

Dashboard → Edge Functions → send-reminders → Schedule :
```
0 7 * * *
```
(08h00 heure Maroc, UTC+1)

### 8. Développement local

```bash
npm run dev
# → http://localhost:3000
```

### 9. Déployer sur Vercel

```bash
# Via CLI
npx vercel

# Ajouter les variables d'environnement dans Vercel Dashboard :
# NEXT_PUBLIC_SUPABASE_URL
# NEXT_PUBLIC_SUPABASE_ANON_KEY
# SUPABASE_SERVICE_ROLE_KEY
# RESEND_API_KEY
# FROM_EMAIL
```

---

## Structure du projet

```
gymflow/
├── app/
│   ├── (protected)/
│   │   ├── layout.tsx          ← Layout protégé (auth check)
│   │   ├── dashboard/page.tsx  ← Vue d'ensemble
│   │   ├── members/page.tsx    ← Liste & gestion membres
│   │   ├── alerts/page.tsx     ← Alertes & rappels
│   │   └── staff/page.tsx      ← Équipe & droits (admin)
│   ├── login/page.tsx          ← Page de connexion
│   ├── layout.tsx              ← Root layout
│   ├── page.tsx                ← Redirect → /dashboard
│   └── globals.css
├── components/
│   └── Sidebar.tsx             ← Navigation latérale
├── lib/
│   ├── actions.ts              ← Server Actions
│   ├── gym.ts                  ← Logique métier (statuts)
│   └── supabase/
│       ├── client.ts           ← Client browser
│       └── server.ts           ← Client serveur
├── types/index.ts              ← Types TypeScript
├── middleware.ts               ← Auth middleware
└── supabase/
    ├── config.toml             ← Config + cron schedule
    ├── migrations/
    │   └── 001_schema.sql      ← Tables + RLS
    └── functions/
        └── send-reminders/
            └── index.ts        ← Cron Edge Function
```

---

## Rôles & permissions

| Action | Admin | Réceptionniste | Lecteur |
|--------|-------|----------------|---------|
| Voir membres | ✓ | ✓ | ✓ |
| Ajouter / modifier | ✓ | ✓ | ✗ |
| Supprimer un membre | ✓ | ✗ | ✗ |
| Envoyer rappels | ✓ | ✓ | ✗ |
| Voir alertes | ✓ | ✓ | ✓ |
| Gérer staff | ✓ | ✗ | ✗ |

---

## Rappels automatiques

| Événement | Délai | Canal |
|-----------|-------|-------|
| Abonnement expire bientôt | J-7 | Email + Plateforme |
| Abonnement expiré | J+1 | Email + Plateforme |
| Assurance expire bientôt | J-30 | Email + Plateforme |
| Assurance expirée | J+1 | Plateforme uniquement |
| Pas d'assurance | Quotidien | Email + Plateforme |
