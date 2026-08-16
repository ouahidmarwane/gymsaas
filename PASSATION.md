# GymFlow — dossier de passation

> Document de contexte destiné à un assistant qui reprendrait le projet sans
> historique. Il décrit ce qu'est le produit, comment il est bâti, pourquoi les
> décisions ont été prises, ce qui a été corrigé, et ce qui reste à faire.
>
> État au 13 août 2026 · 31 commits · 74 fichiers · ~18 400 lignes · 110 tests verts

---

## 1. Le produit

GymFlow est un logiciel de gestion de clubs sportifs, vendu en abonnement à des
salles marocaines. Il gère les membres, les abonnements, les paiements, les
passages de grade et les championnats.

**Propriétaire du projet :** Marwane Ouahid (Maroc). Interface en français,
avec de l'arabe là où un gérant peut en avoir besoin. Monnaie : dirham (DH).

### Le point de départ

Une application mono-club en **Next.js + Supabase + Vercel**, écrite pour un
seul club (Noujoum El Chaouia). Le karaté, deux salles nommées « Sbata » et
« Rachad », et sept ceintures étaient codés en dur — parfois jusque dans des
contraintes `CHECK` de la base. La revendre à un club de judo aurait demandé de
la réécrire.

### Contrainte absolue

**L'ancienne Supabase et l'ancien Vercel ne doivent jamais être modifiés.**
Ils tournent encore pour le club d'origine. Tout le nouveau travail se fait à
côté, sur une infrastructure séparée.

*Séquelle connue et assumée :* les photos de membres de l'ancienne application
en production sont cassées. Une migration de fichiers a été lancée avant que le
code sachant lire les nouvelles références ne soit déployé. Marwane a choisi de
ne pas réparer un système qu'il abandonne.

---

## 2. Architecture

Tout tourne sur **Cloudflare**. Le code vit dans `platform/`.

| Couche | Technologie | Rôle |
|---|---|---|
| Plan de contrôle | D1 (SQLite) — une seule base | Identités, clubs, appartenances, sessions, sécurité, facturation |
| Base d'un club | **Un Durable Object SQLite par club** | Membres, paiements, grades, championnats, réglages |
| Fichiers | R2 (bucket `gymsaas`) | Photos, documents, logos, justificatifs |
| Application | Next.js 16 + React 19 sur Workers via `@opennextjs/cloudflare` | |
| Tâche planifiée | Cron toutes les 5 min | Agrégats, purges, émission automatique des échéances |

### Pourquoi un Durable Object par club, et pas une base D1 par club

Les liaisons D1 sont **statiques** : elles se déclarent dans
`wrangler.jsonc`. Une base par club exigerait donc un redéploiement du Worker à
chaque inscription — l'auto-inscription serait impossible.

Un Durable Object s'adresse par son nom : `env.CLUB.idFromName(orgId)`.
L'instance se crée à la première utilisation, sans configuration.

**La conséquence est la plus importante :** comme chaque club possède sa propre
base, **aucune requête ne comporte de colonne `org_id`**. L'isolation n'est pas
une règle applicative qu'on peut oublier dans une clause `WHERE` — c'est une
propriété du stockage. Un test (`test/provisioning.test.mjs`) le vérifie en
comparant l'empreinte d'un club avant et après la création d'un autre.

### Rien n'est présupposé du sport

Salles (`branches`), disciplines et échelles de grades (`grade_levels`) sont
déclarées par chaque club. Un drapeau `has_grading` distingue un art martial
gradé d'une activité qui ne l'est pas : c'est ce qui permet de vendre à une
salle de boxe, dont l'écran « Passage de grade » n'apparaît tout simplement pas
dans la navigation.

---

## 3. Identité, rôles, sécurité

### Comptes

- **Exploitant de plateforme** (`is_platform_admin = 1`) : **ne possède aucun
  club**. Il supervise, facture et dépanne. Créé hors application par
  `scripts/create-operator.mjs` — jamais par une route HTTP.
- **Membres d'un club** : rôles `owner`, `admin`, `staff`, `receptionist`,
  `viewer`. Une même identité peut appartenir à plusieurs clubs.

### Mode support

Pour intervenir chez un client, l'exploitant « entre » dans un club. Ce n'est
**pas une usurpation d'identité** : une portée est greffée sur sa session
existante (`sessions.support_org_id`). Il reste lui-même, l'action est tracée
sous son nom, et le club en voit la trace dans son propre journal.

- Bannière rouge permanente nommant le club visité.
- Le rail de navigation devient celui du club, rien d'autre.
- La portée expire, et perdre le statut plateforme la coupe immédiatement.
- Elle vit sur la **session**, pas sur l'utilisateur : deux onglets peuvent
  visiter deux clubs différents sans se mélanger.

### Mécanismes en place

- Mots de passe : PBKDF2-SHA256, 210 000 itérations.
- Sessions : jetons opaques stockés hachés en SHA-256, cookie préfixé
  `__Host-`, comparaison à temps constant.
- Plafonds de tentatives : un bas par adresse IP, un plus haut par compte —
  compter serré sur le seul compte offrait un déni de service.
- Liste noire d'adresses IP, appliquée **avant** tout comptage et toute lecture
  de compte, pour ne pas laisser deviner l'existence d'un compte par le temps
  de réponse. Elle couvre aussi l'inscription et coupe les sessions en cours.
- Journal de sécurité : connexion depuis une adresse jamais vue, rafale
  d'échecs, écriture en mode support.

---

## 4. Les écrans

### Espace club

| Route | Contenu |
|---|---|
| `/dashboard` | Douze cartes sur données réelles, graphiques SVG dessinés à la main |
| `/members` | Liste, recherche, création, modification, archivage, renouvellement |
| `/grades` | Éligibles, convocation, réussite ou échec — le grade ne monte qu'en cas de réussite. Masqué si le club n'a aucune discipline gradée |
| `/championships` | Sélection, catégories, poids, podiums |
| `/comptabilite` | Estimations tarifaires **et** encaissements réels, filtres par salle / année / mois |
| `/staff` | Comptes et rôles, via le plan de contrôle |
| `/account` | Mot de passe, sessions actives, journal des accès plateforme |
| `/abonnement` | Échéances, virement, dépôt de justificatif — **bilingue FR/AR** |
| `/setup` | Salles, disciplines, échelles de grades |

### Espace plateforme

| Route | Contenu |
|---|---|
| `/admin` | Liste des clubs : créer, entrer en support, supprimer |
| `/facturation` | Abonnements des clubs, échéances, relances, encaissements |
| `/supervision` | Sessions, événements de sécurité, adresses bloquées, carte des salles |

### Mode modification

Les cartes se déplacent sur une grille de 12 colonnes, en `transform` pur
(aucun recalcul de mise en page pendant le geste), avec une palette latérale.

- **Chaque écran a sa propre disposition et son propre catalogue.** La recette
  n'est pas proposée dans les championnats ; les cartes de grade n'apparaissent
  jamais pour un club sans grade.
- La disposition envoyée par le navigateur n'est **jamais stockée telle
  quelle** : elle est reconstruite champ par champ contre le catalogue de
  l'écran visé. Carte inconnue, carte en double, coordonnée non numérique sont
  refusées ; une taille hors bornes est ramenée dans la grille.
- **Réservé à l'exploitant de plateforme**, côté interface *et* côté serveur.
  Un club peut lire sa disposition (sinon ses écrans ne se dessinent pas) mais
  reçoit 403 sur `PUT` et `DELETE`.

---

## 5. Le système visuel

Le design est la **copie exacte** de l'application d'origine, à la demande
expresse de Marwane. Une refonte avait été proposée et refusée.

- Rail flottant en pilule de 78 px, fond sombre, accent bleu `#2f6bff`.
- Polices : Inter et Outfit.
- `app/globals.css` est la feuille d'origine reprise telle quelle (~5 700
  lignes, dont 189 sélecteurs pour le thème clair, écrits à la main).
  `app/platform.css` contient les ajouts propres au multi-clubs, pour que
  `globals.css` reste recopiable.

### Les cinq habillages

`sombre`, `clair`, `chaleureux` (beige et braise), `sport` (couloirs de piste,
vert terrain), `tatami` (trame tissée, rouge du dojo).

Un habillage n'est pas un mode : il choisit une base claire ou sombre **et** une
palette de surfaces. Les deux bases existaient déjà dans la feuille d'origine ;
l'habillage n'ajoute qu'une couche de variables. Reproduire la feuille claire
cinq fois n'était pas envisageable.

Deux attributs sur `<html>` : `data-theme` porte la base (`light` / `dark`),
`data-skin` porte la palette. Un script en tête de `app/layout.tsx` repose le
dernier habillage connu **avant la première peinture**, sinon un rechargement
complet affiche du sombre transitoire.

**La lisibilité est vérifiée par calcul, pas à l'œil** :
`test/contrast.test.mjs` lit les cinq palettes, compose les couches
translucides sur leur fond et calcule le contraste WCAG du texte principal et
secondaire sur cinq surfaces par thème. Une cinquantaine de couples ; le plus
bas est à 4,83 pour un minimum de 4,5.

---

## 6. Facturation

Deux comptabilités distinctes, à ne jamais confondre :

- **`/comptabilite`** — ce que les membres doivent à leur club. Vit dans la
  base du club.
- **`/facturation`** — ce que chaque club doit à la plateforme. Vit dans le
  plan de contrôle.

### Modèle

- `org_billing` : tarif, durée du cycle, numéro WhatsApp, date de fin de
  couverture (`expires_at`).
- `org_invoices` : une ligne par période facturée. C'est elle qui donne un sens
  au filtre par mois — sans elle, « payé / pas payé » ne serait qu'un booléen
  sur le club, et « mars » serait sans réponse.
- `org_invoice_proofs` : justificatif de virement déposé par le club, avec son
  cycle de revue.

### Deux règles de conception à respecter

1. **`expires_at` est recalculée** depuis la dernière période réglée, jamais
   incrémentée. Annuler un paiement doit faire reculer la date ; un compteur
   qui n'avance que finit par mentir.
2. **L'état est déduit à la lecture**, jamais stocké. Un statut figé se
   désynchronise dès que le temps passe ; une date se compare.

### Cinq états

| État | Signification | Geste attendu |
|---|---|---|
| `active` | Couvert au-delà de 14 jours | rien |
| `soon` | Couvert, mais moins de 14 jours | relancer |
| `expired` | Couverture passée **et** échéance impayée | relancer |
| `renew` | Couverture passée, **tout est réglé** | émettre l'échéance suivante |
| `unset` | Aucun tarif défini | définir le tarif |

La distinction `expired` / `renew` est importante : les confondre affichait
« expiré » à un club qui venait de tout régler, et lui réclamait un montant
jamais facturé.

### Paiement — choix explicite de Marwane

**Aucun prestataire de paiement.** Stripe ne verse pas sur un compte marocain ;
CMI demande un contrat bancaire qu'il n'a pas. Les clubs paient par virement ou
espèces et téléversent leur reçu ; l'exploitant accepte ou refuse d'un clic, ce
qui marque l'échéance payée et avance la couverture. Le refus porte un motif.

**Ne pas proposer d'intégration carte sans qu'il la demande.**

### Ce qui n'est pas automatique — à dire clairement, jamais laisser croire

- **Aucune banque marocaine n'expose d'API ici.** Rien ne peut confirmer qu'un
  virement est arrivé. Ce qui est automatique, c'est le *déblocage* : la page
  club réinterroge nos propres registres toutes les 20 secondes et au retour
  sur l'onglet, et bascule seule dès que l'exploitant valide.
- **L'envoi WhatsApp est manuel.** Les relances sont des liens `wa.me` avec le
  message prérempli à partir des vraies données du club. L'API WhatsApp
  Business exigerait un compte vérifié, des modèles approuvés et facturerait
  chaque message.
- **Le renouvellement automatique crée l'échéance** sept jours avant
  l'expiration (cron), avec son lien prêt. Il ne l'envoie pas. Garde-fou :
  une clause `NOT EXISTS` empêche de re-facturer — sans elle, tournant toutes
  les cinq minutes, il facturerait le même club 288 fois par jour.

### Club expiré

Il **peut se connecter**, puis est redirigé vers `/abonnement`. C'est une
**redirection, pas un verrou** : l'API reste ouverte. Couper réellement un club
sur une donnée de facturation ferait sortir un bon client au premier décalage
de validation. Le mode support en est exempté — regarder un club qui n'a pas
payé est précisément le travail.

---

## 7. Défauts trouvés et corrigés

| Défaut | Pourquoi il comptait |
|---|---|
| Fuseau horaire | `datetime('now')` sans marqueur de zone, lu comme heure locale : à UTC+1, toutes les sessions expiraient instantanément. Utiliser `strftime('%Y-%m-%dT%H:%M:%SZ','now')` **partout** |
| Cookie sur http | Le préfixe `__Host-` exige `Secure` : la connexion échouait en silence dans un vrai navigateur, invisible pour les tests qui ne pilotaient pas un vrai bocal à cookies |
| Fixation de session | Un jeton non strict pouvait être imposé à la victime avant connexion |
| Contournement en support | `atLeast()` accordait silencieusement le niveau propriétaire en mode support sans vérifier le statut plateforme |
| XSS stocké par SVG | Un SVG porte du script ; servi depuis notre origine il s'exécutait avec les droits de qui l'ouvrait — y compris l'exploitant. Les logos et justificatifs n'acceptent que PNG / JPEG / WebP (+ PDF pour les reçus) |
| Déni de service par verrouillage | Le plafond ne comptait que par compte : vingt requêtes verrouillaient un propriétaire depuis n'importe où |
| Corps non borné | Un envoi de 100 Mo était entièrement chargé en mémoire avant d'être refusé. Vérifier `Content-Length` **avant** de lire |
| Verrou global à l'inscription | Compter sur `signup:inconnu` quand l'IP est absente créait un compteur commun bloquant tout le monde |
| `NaN` dans un `LIMIT` | `Math.min(Math.max(NaN, 1), 200)` vaut `NaN`, ce qui vide la limite de son sens |
| Logos orphelins | Chaque remplacement laissait l'ancien fichier dans R2 |
| Filtres inopérants | Sur seize états de filtre en comptabilité, six seulement donnaient un résultat différent. L'effectif se mesure désormais à la fin de la période retenue — onze sur seize |
| `join_date` non modifiable | Un club reprenant son fichier papier aurait vu tous ses membres comptés comme inscrits le jour de la saisie |
| Date sans validation réelle | Le format seul laisse passer le 31 février ; SQLite le stocke tel quel et `strftime` n'en tire aucun mois — le membre disparaît du graphique sans erreur |
| Habillage perdu | Chaque page monte sa propre coquille : réappliquer un défaut à chaque navigation repassait l'application en sombre |
| Habillage débordant | Sans repli explicite, la plateforme gardait les couleurs du dernier club visité — brouillant la frontière que le support existe pour marquer |
| Jetons CSS auto-référents | Un remplacement automatique a écrit `--card-border: var(--card-border)` — aucune erreur au build, la variable ne valait plus rien |
| Tests concurrents | Huit fichiers contre un seul serveur : les échecs changeaient à chaque exécution. Les passages au vert précédents relevaient de la chance. Ils tournent maintenant en séquence (`--test-concurrency=1`) |

---

## 8. Les tests

110 tests, exécutés par HTTP contre un serveur lancé à part, donc indépendants
de la manière dont l'API est servie.

```bash
npm run dev      # dans un terminal
npm test         # dans un autre
```

| Fichier | Ce qu'il garantit |
|---|---|
| `isolation` | Un club ne voit ni un autre club ni la base centrale ; un `orgId` fourni par le client est ignoré |
| `provisioning` | Créer un club ne modifie aucun club existant — vérifié par empreinte |
| `superadmin` | La plateforme supervise tous les clubs, l'accès laisse une trace |
| `support-mode` | Entrée, escalade pour écrire, sortie, expiration, révocation immédiate |
| `capabilities` | Un club sans grade ne voit pas les écrans de grade |
| `layout` | La disposition est reconstruite depuis le catalogue ; seule la plateforme peut l'écrire |
| `finance` | Somme des salles = global, somme des mois = année, les tarifs ne fuient pas |
| `theme` | L'habillage d'un club n'atteint ni son voisin ni la plateforme |
| `contrast` | Les cinq habillages vérifiés par calcul WCAG (aucun serveur requis) |
| `blocklist` | Une adresse bloquée ne se connecte plus, ne s'inscrit plus, perd ses sessions |
| `screens` | Chaque écran est servi et reçoit les données qu'il consomme |
| `supervision` | Sessions plateforme et club sur le même écran, alertes, coupure de sessions |

---

## 9. Environnement de développement

**Windows + PowerShell.** Plusieurs frictions se reproduiront :

- L'outil Bash ne fonctionne pas sur cette machine (erreurs de `fork`). Tout
  passe par PowerShell.
- PowerShell 5.1 n'a ni `&&` ni `??`, et ses chaînes multilignes cassent sur
  les guillemets. Les messages de commit s'écrivent dans un fichier
  (`git commit -F fichier`).
- **Ne jamais réécrire du texte accentué via `Get-Content` / `Set-Content`** :
  cinq fichiers ont été corrompus en double encodage UTF-8.
- Node 24 sur Windows échoue en `EINVAL` sur `npx.cmd` ; invoquer wrangler par
  son entrée JS : `node node_modules/wrangler/bin/wrangler.js`.
- `wrangler d1 execute` fait brièvement tomber le serveur de développement :
  attendre `/api/health` avant de continuer.
- `next dev` est inutilisable : il tourne dans Node, où `cloudflare:workers` ne
  se résout pas et où les Durable Objects n'existent pas. `npm run dev`
  construit avec OpenNext puis sert dans workerd.

### Commandes

```bash
npm install
npm run db:apply:local              # crée et remplit la base centrale locale
npm run dev                         # build OpenNext + workerd sur :8787
npm test                            # 110 tests, séquentiels
npm run typecheck
node scripts/seed-demo.mjs --reset  # données de démonstration
```

### Comptes de démonstration

Mot de passe commun : `demo-motdepasse-2026`

- `admin@demo.ma` — exploitant de plateforme, sans club
- `karate@demo.ma` — Noujoum El Chaouia, 2 salles, karaté gradé + aérobic
- `judo@demo.ma` — Judo Club Atlas, 1 dojo
- `boxe@demo.ma` — Ring Casablanca, boxe **sans grades**

Les trois clubs portent volontairement trois états d'abonnement différents :
à jour, expire bientôt, expiré avec impayé.

---

## 10. Conventions de code

- **Commentaires en français**, et ils expliquent le *pourquoi*, pas le
  *quoi*. Un commentaire qui paraphrase le code est du bruit.
- Requêtes toujours paramétrées ; l'entrée utilisateur ne rejoint jamais le
  texte SQL.
- Les montants sont des **entiers en centimes**. SQLite n'a pas de type
  décimal, et stocker de l'argent en flottant finit par coûter un centime.
- Horodatages en ISO-8601 UTC via `strftime`, jamais `datetime('now')`.
- Les valeurs venant du client sont **reconstruites champ par champ**, jamais
  recopiées : ni thème, ni disposition, ni clé R2.
- Les clés R2 sont fabriquées côté serveur et portent l'identifiant du club.
- Aucune bibliothèque de graphiques pour les petites cartes : SVG écrit à la
  main. Recharts est utilisé pour les grands graphiques de comptabilité et de
  facturation, parce que l'original s'en servait.

---

## 11. Ce qui reste avant la mise en ligne

1. **Créer la base D1 distante** — `wrangler d1 create gymflow-control`, puis
   reporter l'identifiant réel dans `wrangler.jsonc`, qui contient encore
   `00000000-0000-0000-0000-000000000000`.
2. **Appliquer le schéma** — `npm run db:apply:remote`.
3. **Ne jamais poser `TRUST_FORWARDED_IP` en production** : cet en-tête y est
   choisi par l'appelant, et l'accepter permettrait de contourner les plafonds
   de tentatives et la liste noire. Aucun autre secret n'est requis.
4. **Créer le compte exploitant** à la main, via
   `scripts/create-operator.mjs`.
5. **Régler le CORS du bucket R2** sur le domaine réel
   (`scripts/set-r2-cors.mjs`).
6. **Pousser le dépôt** — les 31 commits sont locaux. Le dépôt GitHub est
   public et vide ; le passer en privé avant de pousser.

### Déploiement automatique (Cloudflare Workers Builds)

Chaque push sur `main` construit et déploie. Le réglage vit dans le tableau de
bord Cloudflare, mais **la commande de construction vit dans le dépôt** :
`npm run build:ci`. C'est volontaire — un enchaînement écrit dans un champ
d'interface n'est ni relu, ni versionné, ni exécutable en local.

| Champ | Valeur |
|---|---|
| Root directory | `platform` |
| Build command | `npm run build:ci` |
| Deploy command | `npx wrangler deploy` (défaut) |
| Branche | `main` |

`build:ci` enchaîne `typecheck`, `test:static` et la construction OpenNext.
`test:static` est le sous-ensemble des tests qui ne demande **aucun serveur**
— le reste de la suite parle en HTTP à un worker lancé à part, ce qu'un
conteneur de build n'a pas.

**Ce que la barrière n'attrape pas, et il faut le savoir.** Elle ne voit ni
les régressions de comportement, ni ce qui ne casse qu'en production : le
plafond PBKDF2 de workerd (100 000 itérations) est passé au travers de toute
la suite locale, parce que le workerd local ne l'applique pas. Un déploiement
automatique rend donc le contrôle *après* mise en ligne plus important, pas
moins : connexion, ouverture d'un club, envoi d'un fichier.

`.node-version` fixe Node 24, la famille préinstallée dans l'image de build.
Sans lui, une rotation de l'image changerait la version sous le projet sans
qu'aucun commit ne le dise.

### La carte

**OpenStreetMap via Leaflet** — ni compte, ni clé, ni facturation. Leaflet est
importé dans l'effet, jamais au niveau du module : il touche `window` dès son
évaluation et le rendu serveur échouerait.

Les marqueurs sont des `divIcon`, donc des nœuds du DOM : c'est ce qui permet
le halo néon en CSS, qu'une image de marqueur ne permettrait pas. Ils sont mis
à jour **en place** — sur un rafraîchissement toutes les dix secondes, les
recréer ferait clignoter la carte.

**L'attribution OpenStreetMap est obligatoire et ne doit pas être masquée.**
Sur un habillage sombre, les tuiles sont inversées en CSS plutôt que de
dépendre d'un second fournisseur et de ses conditions. Les tuiles gratuites
suffisent à cette charge ; en gros trafic, seul l'URL du `tileLayer` serait à
changer.

---

## 12. Préférences de travail de Marwane

- **Réponses courtes.** Donner le résultat, pas le raisonnement complet.
- Il teste lui-même. Ne pas dérouler de longues campagnes de vérification sans
  qu'il les demande.
- Il attend qu'on lui dise franchement ce qui n'a pas été fait ou pas pu être
  vérifié, plutôt que de le découvrir à l'usage.
- Critères posés au départ : « secure, perform et do exactly what i want ».
