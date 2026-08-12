# GymFlow Platform

Plateforme multi-clubs sur Cloudflare : Next.js 16 servi par un Worker via
OpenNext, base centrale D1, et une base SQLite par club dans un Durable Object.

## Architecture

**Plan de controle (D1, une seule base)** : identite, catalogue des clubs,
appartenances, sessions, abonnements, agregats en cache, journal plateforme.
Aucune donnee metier.

**Un Durable Object par club** : membres, paiements, alertes, disciplines,
succursales, grades, journal du club. Adresse par `idFromName(orgId)`, cree a
la premiere utilisation.

L'isolation est physique. Un club ne peut pas atteindre les donnees d'un autre :
ce n'est pas une politique a respecter, c'est une base de donnees distincte.
Des Durable Objects plutot qu'une base D1 par club parce que les bindings D1
sont statiques : un club par base imposerait de redeployer le Worker a chaque
inscription, ce qui exclut l'inscription self-service.

**Fichiers** : bucket R2 unique, cles prefixees par club.

## Developpement local

```bash
npm install
npm run db:apply:local     # cree et remplit la base centrale locale
npm run dev                # build OpenNext + workerd sur le port 8787
```

`npm run dev` construit puis sert dans workerd. C'est le seul environnement
local fidele : `next dev` s'execute dans Node, ou `cloudflare:workers` ne se
resout pas et ou les Durable Objects ne fonctionnent pas. `npm run dev:ui`
reste disponible pour iterer vite sur l'interface, sans API ni base.

## Tests

```bash
npm run dev      # dans un terminal
npm test         # dans un autre
```

Les tests interrogent l'API par HTTP, ce qui les rend independants de la
maniere dont elle est servie : ils ont valide la version Worker seule comme la
version Next, sans modification.

Ce qu'ils couvrent, dans les deux sens :

- `isolation` : un club ne voit ni un autre club ni la base centrale ; un
  `orgId` fourni par le client est ignore ; sessions, throttling, mots de passe.
- `superadmin` : la plateforme supervise tous les clubs, et l'acces est trace.
- `provisioning` : creer un club en production ne modifie aucun club existant,
  verifie par empreinte avant/apres.
- `support-mode` : entree en lecture seule, escalade explicite pour ecrire,
  sortie, expiration, revocation immediate du statut plateforme.
- `layout` : la disposition envoyee par le client est reconstruite a partir du
  registre des cartes ; rien d'arbitraire ne persiste.

## Deploiement

```bash
wrangler d1 create gymflow-control      # reporter l'identifiant dans wrangler.jsonc
npm run db:apply:remote
npm run deploy
```

Le compte exploitant de la plateforme se pose a la main, jamais par une route :

```sql
UPDATE users SET is_platform_admin = 1 WHERE email_norm = 'vous@exemple.ma';
```

Aucun bug applicatif ne peut donc conduire a cette escalade.
