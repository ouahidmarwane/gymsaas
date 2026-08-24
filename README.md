# GymFlow

GymFlow est une plateforme SaaS multi-clubs de gestion sportive, conçue pour
Cloudflare. L'application réunit la gestion des membres, paiements, présences,
grades, équipes, messagerie et abonnements de plateforme dans une architecture
où les données métier de chaque club sont physiquement isolées.

## Stack technique

- Next.js 16 avec App Router et React 19
- TypeScript
- Cloudflare Workers via OpenNext
- Cloudflare D1 pour le plan de contrôle
- Durable Objects avec stockage SQLite pour les données des clubs
- Cloudflare R2 pour les logos, bannières et documents
- Tailwind CSS et styles applicatifs
- Leaflet et OpenStreetMap pour la carte de supervision
- SQL paramétré sans ORM

Le point d'entrée déployé est `worker.ts`. Il enveloppe le Worker généré par
OpenNext, exporte la classe `ClubDatabase` et expose la tâche planifiée de
rafraîchissement des statistiques.

## Architecture des données

### Plan de contrôle — D1

La base D1 `gymflow-control` contient les données globales de la plateforme :

- comptes utilisateurs et appartenances aux clubs ;
- sessions, tentatives de connexion et événements de sécurité ;
- organisations, offres, limites et état des abonnements ;
- factures de plateforme et informations de facturation ;
- droits temporaires du support et journal d'audit ;
- agrégats nécessaires à la supervision multi-clubs ;
- conversations globales, support et annonces de plateforme.

Elle ne contient pas les membres, paiements ou présences d'un club.

Le schéma initial se trouve dans `src/control-plane/schema.sql`. Les évolutions
incrémentales sont stockées dans `migrations/` et appliquées par Wrangler.

### Données métier — Durable Objects

Chaque club possède une instance SQLite distincte de `ClubDatabase`, adressée
côté serveur par `idFromName(orgId)`. Elle contient notamment :

- membres et documents associés ;
- salles, disciplines et grades ;
- paiements, registre financier et tarifs ;
- présences, alertes et statistiques du tableau de bord ;
- paramètres, disposition des écrans et journal du club ;
- conversations et messages internes au club.

Le client ne choisit jamais directement le Durable Object. Le Worker résout
d'abord la session, l'appartenance, le rôle et le club actif, puis dérive
l'instance autorisée. Un identifiant de club envoyé par le navigateur ne suffit
donc jamais à accéder aux données d'un autre tenant.

### Fichiers — R2

Le bucket R2 `gymsaas`, exposé par le binding `MEDIA`, stocke les fichiers. Les
clés sont construites et validées côté serveur avec un préfixe propre au club.

## Authentification et autorisation

GymFlow utilise une authentification interne compatible Workers :

- dérivation PBKDF2-SHA256 des mots de passe avec WebCrypto ;
- jetons de session opaques dans des cookies sécurisés ;
- stockage du hash SHA-256 du jeton, jamais du jeton lui-même ;
- vérification en temps constant ;
- limitation des tentatives et blocage d'adresses IP ;
- rôles `owner`, `admin`, `staff` et `viewer` ;
- compte plateforme séparé via `is_platform_admin` ;
- mode support limité dans le temps, en lecture seule par défaut ;
- réauthentification courte (« step-up ») avant les actions sensibles.

Le projet n'utilise ni JWT, ni NextAuth, ni Supabase Auth.

## Organisation du dépôt

```text
app/                         Pages Next.js et route API catch-all
  api/[[...path]]/route.ts   Adaptateur Next.js vers le routeur métier
components/                  Composants React partagés
lib/                         Utilitaires côté interface
src/
  api.ts                     Routeur HTTP et règles d'autorisation
  auth/                      Crypto, sessions et identité
  club/                      Durable Object, schéma et logique métier
  control-plane/schema.sql   Schéma initial D1
migrations/                  Migrations D1 incrémentales
scripts/                     Démo, opérateur, entretien et configuration R2
test/                        Tests fonctionnels, sécurité et isolation
worker.ts                    Point d'entrée Cloudflare déployé
wrangler.jsonc               Bindings D1, Durable Object, R2 et cron
open-next.config.ts          Configuration OpenNext
```

## Installation locale

### Prérequis

- Node.js 24 (voir `.node-version`)
- npm
- les binaires Wrangler installés avec les dépendances du projet

```bash
npm install
npm run db:apply:local
npm run db:migrate:local
npm run dev
```

L'application complète est ensuite disponible sur :

```text
http://127.0.0.1:8787
```

`npm run dev` construit d'abord l'application avec OpenNext, puis la lance dans
Wrangler/workerd avec les bindings locaux D1, Durable Objects et R2. C'est le
mode de développement de référence.

Pour travailler uniquement sur l'interface :

```bash
npm run dev:ui
```

Ce mode sert Next.js sur `http://localhost:3000`, mais ne reproduit pas le
runtime complet. Les routes dépendantes des bindings Cloudflare peuvent y être
indisponibles. Pour tester une connexion, une API ou une fonctionnalité métier,
utilisez toujours le port `8787`.

Les variables locales non publiques sont chargées depuis `.dev.vars` et
`.env.local`. Ces fichiers ne doivent jamais être commités.

## Données de démonstration

Une fois le serveur complet lancé sur le port 8787 :

```bash
node scripts/seed-demo.mjs
```

Le script crée trois clubs représentatifs avec salles, disciplines, membres,
paiements et situations d'abonnement différentes :

- `karate@demo.ma` — Noujoum El Chaouia ;
- `judo@demo.ma` — Judo Club Atlas ;
- `boxe@demo.ma` — Ring Casablanca.

Le mot de passe local commun est affiché par le script à la fin de son
exécution. Ces comptes sont réservés au développement.

Le script `scripts/prune-demo-clubs.mjs` permet d'inspecter puis de supprimer
les clubs jetables créés par les tests. Sans `--apply`, il reste en mode
simulation.

## Fonctionnalités principales

- inscription et configuration autonome d'un club ;
- tableau de bord, statistiques et alertes ;
- gestion des membres, import/export et documents ;
- salles, disciplines, grades et passages de grade ;
- paiements, tarifs, comptabilité et registre financier ;
- gestion de l'équipe et des permissions ;
- personnalisation du thème, logo, bannière et disposition ;
- messagerie directe, groupes, support et annonces ;
- gestion des abonnements et factures SaaS ;
- supervision multi-clubs, carte, audit et sécurité ;
- mode support avec séparation lecture/écriture.

## Commandes utiles

```bash
npm run dev                 # build OpenNext + serveur local complet, port 8787
npm run dev:ui              # serveur Next.js UI uniquement, port 3000
npm run typecheck           # vérification TypeScript
npm run test:static         # tests statiques rapides
npm test                    # suite fonctionnelle complète
npm run build               # build Next.js
npm run build:ci            # typecheck + statique + build OpenNext
npm run preview             # aperçu local du bundle OpenNext
npm run cf-typegen          # types des bindings Cloudflare
npm run db:apply:local      # applique le schéma initial D1 en local
npm run db:migrate:local    # applique les migrations D1 locales
```

Les variantes `db:bootstrap:remote` et `db:migrate:remote` ciblent la base
distante. Elles ne doivent être lancées qu'explicitement et avec le bon compte
Cloudflare.

## Tests

La suite utilise un chargeur Cloudflare simulé et couvre notamment :

- isolation négative entre clubs et sélection serveur du tenant ;
- authentification, sessions, changement de mot de passe et anti-force brute ;
- autorisation par rôle, support, step-up et Superadmin ;
- idempotence financière et cohérence des écritures ;
- provisioning, suppression progressive et migrations ;
- membres, documents, grades, paiements, messagerie et personnalisation ;
- accessibilité visuelle, contraste, disposition et écrans principaux ;
- plafonds d'offre, disponibilité et montée en charge.

Pour la suite complète :

```bash
npm test
```

Pour valider un changement avant livraison :

```bash
npm run typecheck
npm run test:static
npm run build
```

## Déploiement Cloudflare

Les ressources attendues sont déclarées dans `wrangler.jsonc` :

- D1 : binding `CONTROL` ;
- Durable Object : binding `CLUB`, classe `ClubDatabase` ;
- R2 : binding `MEDIA` ;
- Assets : binding `ASSETS` ;
- cron toutes les cinq minutes pour rafraîchir les agrégats.

Après création et configuration des ressources Cloudflare :

```bash
npm run db:bootstrap:remote
npm run db:migrate:remote
npm run deploy
```

La création d'un opérateur plateforme se fait avec le script prévu à cet effet,
hors des routes publiques :

```bash
node scripts/create-operator.mjs <email> <nom> <mot-de-passe> --remote
```

Ne lancez jamais une migration distante ou un déploiement en supposant que le
compte Wrangler actif est le bon : vérifiez d'abord l'environnement ciblé.

## Principes à préserver

- D1 reste réservé au plan de contrôle.
- Les données métier restent dans le Durable Object du club.
- Toute opération tenant-scoped valide session, appartenance et rôle.
- Toute requête SQL reste paramétrée.
- Les clés R2 restent préfixées et validées par club.
- Les API Node-only ne sont pas introduites sans vérifier workerd.
- Les secrets et fichiers `.env*` ne sont jamais commités.
