export type Service = 'water' | 'sewage';

const BASE_KES: Record<Service, number> = { water: 500, sewage: 1500 };
const PER_LITRE_KES: Record<Service, number> = { water: 0.4, sewage: 0.6 };

/**
 * Surge multiplier from slot utilisation after this booking is counted.
 * Capped at 1.5x on purpose: water is an essential service and we would
 * rather run out of capacity (and say so) than price people out.
 */
export function surgeMultiplier(booked: number, capacity: number): number {
  if (capacity <= 0) return 1.5;
  const u = booked / capacity;
  if (u >= 0.95) return 1.5;
  if (u >= 0.8) return 1.25;
  return 1.0;
}

export function priceKes(service: Service, litres: number, surge = 1): number {
  return Math.round((BASE_KES[service] + PER_LITRE_KES[service] * litres) * surge);
}
