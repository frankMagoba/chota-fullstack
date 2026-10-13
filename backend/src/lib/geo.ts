/** Haversine distance in km. Used for ETA estimates and the simulator. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Coarse zone used for slot capacity. A ~5.5km grid cell is enough for a city-level demo. */
export function zoneFor(lat: number, lng: number): string {
  return `${(Math.floor(lat * 20) / 20).toFixed(2)}:${(Math.floor(lng * 20) / 20).toFixed(2)}`;
}

/** Rough city driving ETA: 25 km/h average plus 3 minutes to get moving. */
export function etaMinutes(km: number): number {
  return Math.round(3 + (km / 25) * 60);
}
