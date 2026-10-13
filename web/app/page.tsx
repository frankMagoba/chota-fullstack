'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { call, WS, type Booking, type Driver, type Experiment, type Flag, type Slot } from './api';

// Demo ops account created by the backend seed script.
const DEMO_OPS_PHONE = '+254700000001';

export default function Page() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => setToken(localStorage.getItem('ops_token')), []);
  if (!token) return <Login onToken={(t) => { localStorage.setItem('ops_token', t); setToken(t); }} />;
  return <Dashboard token={token} onLogout={() => { localStorage.removeItem('ops_token'); setToken(null); }} />;
}

function Login({ onToken }: { onToken: (t: string) => void }) {
  const [phone, setPhone] = useState(DEMO_OPS_PHONE);
  const [error, setError] = useState('');
  return (
    <div className="login">
      <h2>Chota Ops</h2>
      <p className="muted">Demo login with the seeded ops phone number.</p>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} />
      <button
        onClick={async () => {
          try {
            const r = await call(null, '/auth/login', { method: 'POST', body: JSON.stringify({ phone }) });
            if (r.user.role !== 'ops') throw new Error('That account is not an ops user');
            onToken(r.token);
          } catch (e) { setError((e as Error).message); }
        }}
      >Sign in</button>
      {error && <p style={{ color: '#b3261e' }}>{error}</p>}
    </div>
  );
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [exps, setExps] = useState<Experiment[]>([]);
  const [holdout, setHoldout] = useState(0);
  const [results, setResults] = useState<Record<string, any[]>>({});
  const [live, setLive] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const load = useCallback(async () => {
    const [b, d, s, f] = await Promise.all([
      call(token, '/ops/bookings'), call(token, '/ops/drivers'), call(token, '/ops/slots'), call(token, '/ops/flags'),
    ]);
    setBookings(b.bookings); setDrivers(d.drivers); setSlots(s.slots);
    setFlags(f.flags); setExps(f.experiments); setHoldout(f.holdoutPercent);
    const r: Record<string, any[]> = {};
    for (const e of f.experiments as Experiment[]) r[e.key] = (await call(token, `/ops/experiments/${e.key}/results`)).results;
    setResults(r);
  }, [token]);

  useEffect(() => {
    load().catch((e) => { if (String(e).includes('Sign in') || String(e).includes('role')) onLogout(); });
    const slow = setInterval(() => load().catch(() => {}), 15000);
    return () => clearInterval(slow);
  }, [load, onLogout]);

  // Live updates: booking changes and driver status come over the same WebSocket the app uses.
  useEffect(() => {
    let stop = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const ws = new WebSocket(`${WS}/ws?token=${token}`);
      wsRef.current = ws;
      ws.onopen = () => { setLive(true); ws.send(JSON.stringify({ type: 'subscribe_ops' })); };
      ws.onclose = () => { setLive(false); if (!stop) retry = setTimeout(connect, 2000); };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.type === 'booking') {
          setBookings((prev) => {
            const rest = prev.filter((b) => b.id !== m.booking.id);
            return [m.booking, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
          });
        } else if (m.type === 'availability' || (m.type === 'driver_location' && m.status)) {
          setDrivers((prev) => prev.map((d) => (d.id === m.driverId ? { ...d, status: m.status } : d)));
        }
      };
    };
    connect();
    return () => { stop = true; clearTimeout(retry); wsRef.current?.close(); };
  }, [token]);

  const updateFlag = async (f: Flag, patch: Partial<Flag>) => {
    const next = { ...f, ...patch };
    setFlags((prev) => prev.map((x) => (x.key === f.key ? next : x)));
    await call(token, `/ops/flags/${f.key}`, {
      method: 'PUT', body: JSON.stringify({ enabled: next.enabled, rolloutPercent: Number(next.rollout_percent) }),
    });
  };

  const active = bookings.filter((b) => ['assigned', 'en_route', 'arrived'].includes(b.status)).length;
  const avail = drivers.filter((d) => d.status === 'available').length;
  const done = bookings.filter((b) => b.status === 'completed').length;
  const noDriver = bookings.filter((b) => b.status === 'no_driver').length;

  return (
    <>
      <header>
        <h1>Chota Ops</h1>
        <span><span className="dot" style={{ background: live ? '#34a853' : '#ea4335' }} />{live ? 'live' : 'reconnecting'}</span>
        <span style={{ flex: 1 }} />
        <a href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/metrics`} style={{ color: '#bbb' }} target="_blank">/metrics</a>
        <button onClick={onLogout} style={{ background: 'none', color: '#bbb', border: 0, cursor: 'pointer' }}>Sign out</button>
      </header>
      <main>
        <section className="kpis">
          <div className="kpi"><b>{active}</b><span>active jobs</span></div>
          <div className="kpi"><b>{avail}/{drivers.length}</b><span>trucks available</span></div>
          <div className="kpi"><b>{done}</b><span>completed (last 50)</span></div>
          <div className="kpi"><b>{noDriver}</b><span>no truck found (last 50)</span></div>
        </section>

        <section>
          <h2>Live bookings</h2>
          <table>
            <thead><tr><th>Status</th><th>Service</th><th>Litres</th><th>Driver</th><th>Address</th><th>KES</th><th>Updated</th></tr></thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td><span className={`pill ${b.status}`}>{b.status.replace('_', ' ')}</span></td>
                  <td>{b.service}</td>
                  <td>{b.quantityLitres.toLocaleString()}</td>
                  <td>{b.driverName ? `${b.driverName} · ${b.driverPlate}` : '-'}</td>
                  <td>{b.address}</td>
                  <td>{b.priceKes.toLocaleString()}{b.surge > 1 ? ` (${b.surge}x)` : ''}</td>
                  <td>{new Date(b.updatedAt).toLocaleTimeString()}</td>
                </tr>
              ))}
              {bookings.length === 0 && <tr><td colSpan={7} className="muted">No bookings yet. Place one from the app.</td></tr>}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Flags <span className="muted">· global holdout {holdout}%</span></h2>
          {flags.map((f) => (
            <div className="flag" key={f.key}>
              <strong>{f.key}</strong>
              <label><input type="checkbox" checked={f.enabled} onChange={(e) => updateFlag(f, { enabled: e.target.checked })} /> on</label>
              <small>{f.description}{f.respect_holdout ? '' : ' (ignores holdout)'}</small>
              <input type="range" min={0} max={100} step={5} value={f.rollout_percent}
                onChange={(e) => setFlags((prev) => prev.map((x) => (x.key === f.key ? { ...x, rollout_percent: Number(e.target.value) } : x)))}
                onMouseUp={(e) => updateFlag(f, { rollout_percent: Number((e.target as HTMLInputElement).value) })}
              />
              <small>rollout {f.rollout_percent}%</small>
            </div>
          ))}
        </section>

        <section>
          <h2>Trucks</h2>
          <table>
            <thead><tr><th>Driver</th><th>Service</th><th>Status</th><th>Trust</th><th>Jobs</th></tr></thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}<div className="muted">{d.plate}</div></td>
                  <td>{d.service}</td>
                  <td><span className={`pill ${d.status}`}>{d.status}</span></td>
                  <td>{Math.round(d.trustScore)}</td>
                  <td>{d.completedJobs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Experiments</h2>
          {exps.map((e) => (
            <div key={e.key} style={{ marginBottom: 16 }}>
              <strong>{e.key}</strong>
              <div className="muted">{e.description} Metric: {e.metric}.</div>
              <table>
                <thead><tr><th>Variant</th><th>Users</th><th>Converted</th><th>Rate</th></tr></thead>
                <tbody>
                  {(results[e.key] ?? []).map((r) => (
                    <tr key={`${r.variant}-${r.holdout}`}>
                      <td>{r.variant}{r.holdout ? ' (holdout)' : ''}</td>
                      <td>{r.users}</td><td>{r.converted}</td>
                      <td>{r.users ? `${Math.round((100 * r.converted) / r.users)}%` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <h2 style={{ marginTop: 20 }}>Slot capacity (this hour)</h2>
          <table>
            <thead><tr><th>Zone</th><th>Service</th><th>Booked</th></tr></thead>
            <tbody>
              {slots.map((s) => (
                <tr key={`${s.zone}-${s.service}-${s.startsAt}`}>
                  <td>{s.zone}</td><td>{s.service}</td><td>{s.booked}/{s.capacity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}
