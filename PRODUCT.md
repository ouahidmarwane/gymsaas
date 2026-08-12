# GymFlow

Multi-club management platform for martial-arts and sports clubs, sold as a
SaaS. Built for Morocco first; French and Arabic, dirhams, WhatsApp.

**Register:** product. Design serves the task.

## Who uses it

**The receptionist**, at a desk in the entrance hall of a dojo, between 18h and
21h when classes run. Overhead fluorescent light, a queue of parents, a phone
in one hand. Their most common question is not "show me a chart" — it's *"is
this kid's insurance still valid?"* They need an answer in under two seconds,
readable at arm's length under glare.

**The club president**, on a phone, often outdoors, checking this month's
takings or who is due for a belt grading.

**The platform operator** (one person, for now), supervising every club from a
laptop, entering a club's dashboard to diagnose a problem while its owner is on
the phone.

## What it does

- Members, subscriptions, insurance and *passeport sportif* compliance.
- Payments and simple accounting, in dirhams.
- Belt grading, on ladders each club defines for itself.
- Championships: squads, categories, weights, results.
- Alerts, with one-click bilingual WhatsApp reminders.

## Constraints that shape the interface

- **Bilingual FR/AR with full RTL.** Layout mirrors. Nothing may depend on
  left-to-right reading order.
- **Phones matter as much as desktops.** Presidents live on their phones.
- **Density is a feature.** A receptionist scanning 200 members wants rows, not
  cards.
- **Every club looks different.** Logo, name, accent colour and dashboard
  layout are per club. The chrome must stay legible whatever colour it wears.
- **Support mode must be unmissable.** When the operator is inside a club, the
  interface has to say so continuously.

## Non-goals

- Free-canvas layout editing. Cards reorder on a grid; nothing positions by
  pixel. Absolute positioning breaks phones and fights RTL.
- Class scheduling and door access. That's commercial-gym territory, not what
  federated clubs ask for.
