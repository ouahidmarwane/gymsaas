# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

GymFlow sert les propriétaires, administrateurs et équipes de clubs de sport, ainsi que les Superadmins de la plateforme. Dans la messagerie, ils coordonnent leur équipe, échangent en privé avec des collègues autorisés, contactent le support GymFlow et consultent les annonces officielles.

## Product Purpose

GymFlow centralise l’exploitation quotidienne de plusieurs clubs dans un SaaS sécurisé. La communication doit rester proche du contexte opérationnel du club afin que les utilisateurs puissent agir rapidement sans quitter la plateforme.

## Positioning

Chaque club possède un espace métier et conversationnel physiquement isolé dans son propre Durable Object, tandis que les fonctions plateforme restent dans le plan de contrôle D1. Cette séparation native du stockage est une frontière de sécurité et un mécanisme central du produit.

## Operating Context

- Utilisation fréquente sur ordinateur pour administrer un club, avec adaptation mobile complète.
- Conversations directes entre membres autorisés d’un même club, groupes privés et canal interne Équipe.
- Support privé entre les administrateurs du club et les Superadmins GymFlow.
- Annonces globales officielles en lecture seule pour les clubs.
- Un thème principal clair crème/noir/orange, des habillages de club configurables et un mode nuit personnel disponible partout.

## Capabilities and Constraints

- Next.js 16, React 19, TypeScript et Cloudflare Workers via OpenNext.
- D1 pour le plan de contrôle, un Durable Object SQLite par club pour les données métier et R2 pour les fichiers.
- Authentification propriétaire existante ; aucun système d’authentification parallèle.
- Isolation stricte des tenants, autorisation côté serveur, protection IDOR et identité d’expéditeur dérivée de la session.
- SQL brut paramétré uniquement ; aucun ORM.
- La messagerie doit préserver les messages, groupes, membres, administrateurs, mentions, réponses, réactions, pièces jointes, pagination, états non lus, support et annonces déjà implémentés.
- Aucun déploiement ni changement de ressource Cloudflare de production pendant le travail local.

## Brand Commitments

Le produit s’appelle GymFlow. La messagerie doit conserver l’identité et les thèmes GymFlow tout en adoptant la familiarité opérationnelle de Telegram et WhatsApp, sans copier leur marque ni ajouter des fonctions d’appel audio ou vidéo.

## Evidence on Hand

- Architecture et règles de sécurité : `AGENTS.md` et `README.md`.
- Spécification de la messagerie : `.ai/requests/messaging.md`.
- Implémentation actuelle : `app/messagerie/page.tsx` et `app/globals.css`.
- Référence historique de composition : `team-chat-mockup.html` et les captures fournies dans la conversation.
- Tests de sécurité et de comportement : `test/messaging.test.mjs` et `test/contrast.test.mjs`.

## Product Principles

- La confidentialité et l’isolation d’un club ne sont jamais sacrifiées à la commodité.
- La communication doit être instantanément compréhensible et rapide à utiliser.
- Une seule grammaire d’interface doit fonctionner dans tous les thèmes et toutes les tailles d’écran.
- Les actions visibles doivent être fonctionnelles, autorisées et accompagnées d’états explicites.
- La plateforme reste GymFlow : les références aux messageries grand public servent l’ergonomie, pas l’identité.

## Accessibility & Inclusion

Les modes jour et nuit doivent conserver un contraste lisible, les contrôles doivent rester accessibles au clavier et aux technologies d’assistance, et la mise en page doit fonctionner sans perte de fonctionnalité sur mobile.
