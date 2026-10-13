export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const WS = API.replace(/^http/, 'ws');

export async function call<T = any>(token: string | null, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
  return data as T;
}

export interface Booking {
  id: string; status: string; service: string; quantityLitres: number; address: string; priceKes: number;
  surge: number; driverName: string | null; driverPlate: string | null; createdAt: string; updatedAt: string; version: number;
}
export interface Driver { id: string; name: string; plate: string; service: string; status: string; trustScore: number; completedJobs: number }
export interface Flag { key: string; description: string; enabled: boolean; rollout_percent: number; respect_holdout: boolean }
export interface Experiment { key: string; description: string; active: boolean; variants: { name: string; weight: number }[]; metric: string }
export interface Slot { zone: string; service: string; startsAt: string; capacity: number; booked: number }
