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

### Carte de supervision (facultatif)

L'ecran Supervision affiche les salles sur une carte Google. Sans cle, il
affiche la meme information en liste : la carte est un confort, pas une
dependance, et son absence ne doit pas fermer un ecran de securite.

Pour l'activer, poser une cle **de navigateur** avec l'API « Maps JavaScript »
activee :

```bash
echo 'GOOGLE_MAPS_API_KEY=AIza...' >> .dev.vars    # local
wrangler secret put GOOGLE_MAPS_API_KEY            # production
```

Deux precautions cote Google Cloud, parce que la cle voyage jusqu'au
navigateur et ne peut donc pas rester secrete :

- la restreindre par **referent HTTP** au domaine de la plateforme ;
- la restreindre a la seule API « Maps JavaScript », et poser un plafond de
  facturation.

Le serveur ne la transmet qu'a un compte exploitant, jamais dans le bundle
des pages publiques. Les salles se placent depuis l'ecran Supervision, bouton
« Situer » : un clic droit dans Google Maps donne le couple de coordonnees a
coller.

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
  registre des cartes ; rien d'arbitraire ne persiste, et seule la plateforme
  peut l'ecrire.
- `theme` : l'habillage d'un club ne fuit ni chez le voisin ni sur la
  plateforme, dans les deux sens.
- `contrast` : les cinq habillages sont verifies par calcul WCAG sur chaque
  surface — pas a l'oeil.
- `blocklist` : une adresse bloquee ne se connecte plus, ne s'inscrit plus, et
  perd ses sessions ; on ne peut pas se bloquer soi-meme.

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
