// lib/prices.ts
// Tarifs du club — constantes/types partagés client & serveur.
// (Un module 'use server' ne peut exporter que des fonctions async,
//  d'où ce fichier séparé pour la valeur par défaut et le type.)
export const DEFAULT_PRICES = { monthly: 100, insurance: 50, registration: 150 }
export type Prices = typeof DEFAULT_PRICES
