import { defineCloudflareConfig } from '@opennextjs/cloudflare'

export default defineCloudflareConfig({
  // Pas de cache incrementiel : toutes les pages sont rendues a la demande,
  // par definition (elles dependent du club et de la session). Le brancher
  // ajouterait un etage sans rien mettre en cache.
})
