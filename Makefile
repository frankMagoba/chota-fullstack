# One-command local setup. Needs Docker; Flutter only for the app.
.PHONY: up down logs test simulate race web app reset

up:            ## Postgres + Redis + API (migrates and seeds on start)
	docker compose up -d --build
	@echo "Waiting for API..."; until curl -sf localhost:4000/ready >/dev/null; do sleep 1; done; echo "API ready on http://localhost:4000"

down:
	docker compose down

reset:         ## Drop the database volume and start clean
	docker compose down -v && $(MAKE) up

logs:
	docker compose logs -f backend

test:          ## Backend unit + concurrency tests (needs `make up` for Postgres/Redis)
	cd backend && npm install && npm test

simulate:      ## Move the seeded trucks and run their jobs
	cd backend && npm install && npm run simulate

race:          ## Fire 25 simultaneous bookings at the live API
	cd backend && npm install && npm run race

web:           ## Ops dashboard on http://localhost:3001
	cd web && npm install && npm run dev -- -p 3001

app:           ## Flutter app in Chrome
	cd mobile && flutter pub get && flutter run -d chrome
