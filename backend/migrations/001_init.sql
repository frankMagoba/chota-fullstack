-- Chota core schema. PostGIS is used for the fallback geo query and for
-- storing booking pickup points; live driver positions also live in Redis GEO.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('customer', 'driver', 'ops');
CREATE TYPE service_type AS ENUM ('water', 'sewage');
CREATE TYPE driver_status AS ENUM ('offline', 'available', 'busy');
CREATE TYPE booking_status AS ENUM (
  'requested', 'assigned', 'en_route', 'arrived', 'completed', 'cancelled', 'no_driver'
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone          text NOT NULL UNIQUE,
  name           text NOT NULL,
  role           user_role NOT NULL DEFAULT 'customer',
  invite_code    text NOT NULL UNIQUE,
  invited_by     uuid REFERENCES users(id),
  -- Trust inputs. trust_score is recomputed from these, never written directly by clients.
  rating_sum     integer NOT NULL DEFAULT 0,
  rating_count   integer NOT NULL DEFAULT 0,
  completed_jobs integer NOT NULL DEFAULT 0,
  cancelled_jobs integer NOT NULL DEFAULT 0,
  trust_score    numeric(5,2) NOT NULL DEFAULT 50.00,
  credit_kes     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE drivers (
  user_id         uuid PRIMARY KEY REFERENCES users(id),
  service_type    service_type NOT NULL,
  plate           text NOT NULL,
  capacity_litres integer NOT NULL,
  status          driver_status NOT NULL DEFAULT 'offline',
  location        geography(Point, 4326),
  location_at     timestamptz,
  -- Optimistic version, bumped on every status change.
  version         integer NOT NULL DEFAULT 0
);
CREATE INDEX drivers_location_gix ON drivers USING gist (location);
CREATE INDEX drivers_available_idx ON drivers (service_type) WHERE status = 'available';

-- Capacity per zone per hour window. Used to stop overselling during surges.
CREATE TABLE slots (
  id           bigserial PRIMARY KEY,
  zone         text NOT NULL,
  service_type service_type NOT NULL,
  starts_at    timestamptz NOT NULL,
  capacity     integer NOT NULL CHECK (capacity >= 0),
  booked       integer NOT NULL DEFAULT 0,
  CONSTRAINT slots_not_oversold CHECK (booked <= capacity),
  UNIQUE (zone, service_type, starts_at)
);

CREATE TABLE bookings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      uuid NOT NULL REFERENCES users(id),
  driver_id        uuid REFERENCES users(id),
  slot_id          bigint REFERENCES slots(id),
  service_type     service_type NOT NULL,
  quantity_litres  integer NOT NULL CHECK (quantity_litres > 0),
  pickup           geography(Point, 4326) NOT NULL,
  address          text NOT NULL,
  status           booking_status NOT NULL DEFAULT 'requested',
  price_kes        integer NOT NULL,
  surge_multiplier numeric(3,2) NOT NULL DEFAULT 1.00,
  idempotency_key  text NOT NULL,
  version          integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, idempotency_key)
);
-- Hard guarantee: a driver can hold at most one active booking. Even if the
-- application locking had a bug, the database refuses the double booking.
CREATE UNIQUE INDEX bookings_one_active_per_driver
  ON bookings (driver_id)
  WHERE status IN ('assigned', 'en_route', 'arrived');
CREATE INDEX bookings_customer_idx ON bookings (customer_id, created_at DESC);

CREATE TABLE booking_events (
  id         bigserial PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id),
  status     booking_status NOT NULL,
  actor_id   uuid REFERENCES users(id),
  at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ratings (
  id         bigserial PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id),
  rater_id   uuid NOT NULL REFERENCES users(id),
  ratee_id   uuid NOT NULL REFERENCES users(id),
  stars      smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, rater_id)
);

CREATE TABLE referrals (
  id            bigserial PRIMARY KEY,
  inviter_id    uuid NOT NULL REFERENCES users(id),
  invitee_id    uuid NOT NULL UNIQUE REFERENCES users(id),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rewarded', 'rejected')),
  reward_kes    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  rewarded_at   timestamptz
);

CREATE TABLE feature_flags (
  key             text PRIMARY KEY,
  description     text NOT NULL DEFAULT '',
  enabled         boolean NOT NULL DEFAULT false,
  rollout_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  respect_holdout boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE experiments (
  key         text PRIMARY KEY,
  description text NOT NULL DEFAULT '',
  active      boolean NOT NULL DEFAULT true,
  -- [{"name":"control","weight":50},{"name":"treatment","weight":50}]
  variants    jsonb NOT NULL,
  metric      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE analytics_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id),
  name        text NOT NULL,
  props       jsonb NOT NULL DEFAULT '{}',
  -- Snapshot of flag/experiment assignment at the time of the event.
  assignments jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_name_idx ON analytics_events (name, created_at);

CREATE TABLE schema_settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
-- Global holdout: this share of users never sees any flagged feature or
-- experiment treatment, so we can measure the combined effect of everything we ship.
INSERT INTO schema_settings (key, value) VALUES ('holdout_percent', '5');
