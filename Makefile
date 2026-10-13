# Default path is lean: Postgres + Redis in Docker, API with node.
.PHONY: db api up up-docker down reset logs test simulate race web app app-macos

db:            ## Postgres + Redis only (capped memory)
	docker compose up -d postgres redis
	@until docker compose exec -T postgres pg_isready -U chota >/dev/null 2>&1; do sleep 1; done

api: db        ## Migrate, seed and run the API with node on :4000
	cd backend && npm install --no-audit --no-fund && npm run migrate && npm run seed && npm run dev

up: api

up-docker:     ## Everything in Docker, API included
	docker compose --profile api up -d --build
	@until curl -sf localhost:4000/ready >/dev/null; do sleep 1; done; echo "API ready on http://localhost:4000"

down:
	docker compose --profile api down

reset:         ## Drop the database volume
	docker compose --profile api down -v

test: db       ## Backend lint, typecheck, unit + concurrency tests
	cd backend && npm install --no-audit --no-fund && npm run lint && npm run typecheck && npm test

simulate:      ## 6 trucks, 3s tick (SIM_DRIVERS=12 for all of them)
	cd backend && SIM_DRIVERS=$${SIM_DRIVERS:-6} SIM_TICK_MS=$${SIM_TICK_MS:-3000} npm run simulate

race:          ## 25 simultaneous bookings against the running API
	cd backend && npm run race

web:           ## Optional ops dashboard on :3001
	cd web && npm install --no-audit --no-fund && npm run dev -- -p 3001

app:           ## Flutter app in Chrome
	cd mobile && flutter pub get && flutter run -d chrome

app-macos:     ## Flutter app as a macOS window (needs Xcode)
	cd mobile && flutter pub get && flutter run -d macos
