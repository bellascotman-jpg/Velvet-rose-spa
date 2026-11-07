CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL UNIQUE,
  service_id INTEGER NOT NULL,
  service_name TEXT NOT NULL,
  service_price_ngn INTEGER NOT NULL CHECK (service_price_ngn > 0),
  addon_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_note TEXT,
  therapist_preference TEXT,
  occasion TEXT,
  total_ngn INTEGER NOT NULL CHECK (total_ngn > 0),
  deposit_ngn INTEGER NOT NULL CHECK (deposit_ngn > 0),
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment','confirmed','expired','cancelled','payment_review')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS bookings_customer_email_idx ON bookings (customer_email, created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_appointment_idx ON bookings (appointment_date, start_time);
CREATE INDEX IF NOT EXISTS bookings_status_expiry_idx ON bookings (status, expires_at);

CREATE TABLE IF NOT EXISTS booking_slot_locks (
  appointment_date DATE NOT NULL,
  slot_start TIME NOT NULL,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (appointment_date, slot_start)
);

CREATE INDEX IF NOT EXISTS booking_slot_locks_booking_idx ON booking_slot_locks (booking_id);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  reference TEXT NOT NULL UNIQUE,
  amount_kobo INTEGER NOT NULL CHECK (amount_kobo > 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','success','failed','success_review')),
  paystack_transaction_id TEXT,
  gateway_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS paystack_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
