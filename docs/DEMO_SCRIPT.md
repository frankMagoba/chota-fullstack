# Demo script (5 to 7 minutes)

Setup before the call (2 minutes):

```bash
cd ~/Desktop/chota-app
make api                # Postgres + Redis in Docker, API with node
make simulate           # terminal 2: trucks move
make app                # terminal 3: Flutter app in Chrome (narrow the window to phone width)
make web                # terminal 4, only if you'll show the dashboard
```

Have open: Chrome with the app, the dashboard tab, VS Code on `backend/src/services/bookings.ts`, and a terminal in `backend/`.

---

## 1. Context (30 s)

"Quick note first: this is a sanitized example. The data is seeded, so no real customers or drivers, and there are no production keys in it. Chota is an on-demand water and exhauster truck app for Nairobi. I built the Flutter customer app in 2021, frontend only. For this I modernised it and built the backend: Node and TypeScript, Postgres, Redis, WebSockets, plus a small Next.js ops dashboard. It touches most of what's in your role: real-time availability, bookings under load, location, invites and trust, and flags and experiments."

## 2. The app (1.5 min)

- Home map. "These trucks are live. The simulator drives them through the same API a driver app would use. Locations go into Redis GEO and fan out over Redis pub/sub to WebSockets."
- Switch to Exhauster: the markers change. "Separate GEO set per service. Only available trucks are in the set, so nearby means bookable."
- Tap the map to move the pin. "The socket subscription moves with the pin."
- Order clean water, pick 10k litres, Request.
- Tracking screen: the truck moves, the ETA drops, the status bar fills: assigned, on the way, arrived, completed. "The app ignores out-of-order messages using the booking version, and on reconnect it re-subscribes and does one REST catch-up."
- Rating screen. "Ratings feed a trust score; I'll show the formula."

## 3. The hard part: no double booking (2 min)

Open `backend/src/services/bookings.ts`, `createBooking`.

"One transaction. Three races:
1. Double tap or retry: idempotency key, unique per customer, `ON CONFLICT DO NOTHING` returns the first booking.
2. Two people want the same nearest truck: `FOR UPDATE SKIP LOCKED`. The second request skips the locked truck and takes the next one in the same pass, so a surge doesn't turn into a retry storm.
3. Surge: slot capacity per zone and hour, decremented with `booked < capacity`, with a check constraint behind it.

And a partial unique index means the database itself refuses two active jobs for one truck, even if the code had a bug."

In the terminal:

```bash
npm run race
```

"Twenty-five customers, same spot, same moment. Eight free trucks, eight assigned, eight distinct trucks, the rest told no truck is free. The same thing is in the test suite against real Postgres." Optionally run `npm test` (about 5 seconds).

Mention optimistic versioning for status changes: "If a driver marks en route just as the customer cancels, the version check returns 409 instead of overwriting the cancel."

## 4. Experiments, flags, holdout (1 min)

Dashboard tab.
- Live bookings updating over the same WebSocket.
- Flags with rollout sliders. "Deterministic hash buckets per user, so raising 30% to 60% only adds people. 5% global holdout never gets flagged features, which lets us measure the combined effect of everything we ship."
- Experiment table: `request_button_copy`, "Request truck" vs "Get water now", conversion by variant. "Every analytics event stores the user's assignments at that moment, so analysis is a GROUP BY."

## 5. Observability and invites (45 s)

- Open `localhost:4000/metrics`. "Latency histogram per route, error counter, uptime, bookings by outcome, time inside the dispatch transaction. `/ready` checks Postgres and Redis for the load balancer."
- In the app drawer, Invite friends. "Reward pays on the friend's first completed order, not sign-up, so fake accounts earn nothing. The payout is a conditional update, so it can only happen once."

## 6. Close (30 s)

"The design doc in `docs/DESIGN.md` covers the architecture and the locking design, plus a table mapping each of your requirements to the code. Next I'd add a driver accept step with re-dispatch, M-Pesa, and road-based ETAs."

## 7. Transition (10 s)

"That's Chota. Next I'll show Keyhold, my own TypeScript project," then switch windows.

---

## Likely questions

- **Why not optimistic locking for assignment?** In a surge everyone races for the same nearest truck and all but one retry. SKIP LOCKED gives each request a different truck in one pass. I use optimistic versions where conflicts are rare: status transitions.
- **What if Redis dies?** Positions are rebuilt from the next location pings; dispatch falls back to a PostGIS nearest-neighbour query. Pub/sub loss is covered by REST catch-up.
- **Multiple API instances?** Stateless. Each instance subscribes to Redis and only forwards to its own sockets.
- **Is the LLM in the booking path?** No. Status copy only, behind a flag, 2.5 s timeout, template fallback.
- **What's mocked?** OTP, payments, and the driver app UI (the simulator uses the real driver endpoints).
