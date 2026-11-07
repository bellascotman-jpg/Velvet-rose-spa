import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getDatabase } from "@netlify/database";

const DEPOSIT_NGN = 10000;
const HOLD_MINUTES = 10;
const SLOT_STEP_MINUTES = 90;
const BUCKET_MINUTES = 15;
const SERVICES = [
  { id: 0, name: "Swedish Relaxation Massage", duration: 60, price: 45000 },
  { id: 1, name: "Deep Tissue Massage", duration: 60, price: 55000 },
  { id: 2, name: "Aromatherapy Massage", duration: 60, price: 50000 },
  { id: 3, name: "Hot Stone Massage", duration: 75, price: 65000 },
  { id: 4, name: "Couples Massage", duration: 90, price: 140000 },
  { id: 5, name: "Signature Hydrating Facial", duration: 60, price: 50000 },
  { id: 6, name: "Deep Cleansing Facial", duration: 75, price: 60000 },
  { id: 7, name: "Radiance Glow Facial", duration: 60, price: 55000 },
  { id: 8, name: "Salt Glow Body Scrub", duration: 45, price: 40000 },
  { id: 9, name: "Scrub and Wrap Ritual", duration: 75, price: 60000 },
  { id: 10, name: "Classic Manicure", duration: 45, price: 15000 },
  { id: 11, name: "Classic Pedicure", duration: 60, price: 20000 },
  { id: 12, name: "Spa Pedicure", duration: 75, price: 28000 },
  { id: 13, name: "The Velvet Ritual", duration: 150, price: 120000 },
  { id: 14, name: "Couples Escape", duration: 120, price: 180000 },
  { id: 15, name: "Bridal Glow", duration: 180, price: 150000 },
  { id: 16, name: "Executive Reset", duration: 90, price: 75000 }
];
const ADDONS = [
  { id: 0, name: "Scalp massage", price: 8000 },
  { id: 1, name: "Paraffin hand treatment", price: 10000 },
  { id: 2, name: "Aromatherapy upgrade", price: 6000 }
];
const HOURS = {
  0: [720, 1080],
  1: [540, 1200],
  2: [540, 1200],
  3: [540, 1200],
  4: [540, 1200],
  5: [540, 1200],
  6: [540, 1140]
};

const db = () => getDatabase();
const json = (data, status = 200) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store" }
});
const fail = (message, status = 400) => json({ error: message }, status);
const mins = (value) => {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
};
const clock = (value) => String(Math.floor(value / 60)).padStart(2, "0") + ":" + String(value % 60).padStart(2, "0");
const localDay = (date) => new Date(date + "T12:00:00+01:00").getDay();
const lagosToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());

function candidateTimes(date, duration) {
  const hours = HOURS[localDay(date)];
  if (!hours) return [];
  const result = [];
  for (let start = hours[0]; start + duration <= hours[1]; start += SLOT_STEP_MINUTES) {
    result.push(clock(start));
  }
  return result;
}
function slotBuckets(time, duration) {
  const start = mins(time);
  const roundedEnd = Math.ceil((start + duration) / BUCKET_MINUTES) * BUCKET_MINUTES;
  const buckets = [];
  for (let value = start; value < roundedEnd; value += BUCKET_MINUTES) buckets.push(clock(value));
  return buckets;
}
function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + "T12:00:00+01:00");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
async function cleanupExpired(database) {
  await database.pool.query(
    "UPDATE bookings SET status = 'expired' WHERE status = 'pending_payment' AND expires_at <= NOW()"
  );
  await database.pool.query(
    "DELETE FROM booking_slot_locks WHERE expires_at IS NOT NULL AND expires_at <= NOW()"
  );
}
function normalizePhone(value) {
  return String(value || "").replace(/[\s()-]/g, "");
}
function getService(id) {
  const service = SERVICES[Number(id)];
  return service && service.id === Number(id) ? service : null;
}
function getAddons(ids) {
  if (!Array.isArray(ids) || ids.length > ADDONS.length) return null;
  const unique = [...new Set(ids.map(Number))];
  if (unique.some((id) => !Number.isInteger(id) || !ADDONS[id])) return null;
  return unique.map((id) => ADDONS[id]);
}
function reference() {
  return "VRS-" + randomUUID().replaceAll("-", "").slice(0, 18).toUpperCase();
}
async function paystackRequest(path, options = {}) {
  const secret = Netlify.env.get("PAYSTACK_SECRET_KEY");
  if (!secret) throw new Error("Paystack has not been configured on this site yet.");
  const response = await fetch("https://api.paystack.co" + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + secret,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status !== true) {
    throw new Error(data.message || "Paystack could not complete the request.");
  }
  return data.data;
}

async function health() {
  const database = db();
  await database.pool.query("SELECT 1");
  return json({
    ok: true,
    database: "connected",
    paystackConfigured: Boolean(Netlify.env.get("PAYSTACK_SECRET_KEY"))
  });
}

async function availability(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || "";
  const service = getService(url.searchParams.get("service"));
  if (!validDate(date) || !service) return fail("Choose a valid date and treatment.");
  if (date <= lagosToday()) return json({ date, times: [] });
  const database = db();
  await cleanupExpired(database);
  const times = candidateTimes(date, service.duration);
  if (!times.length) return json({ date, times: [] });
  const bucketSet = [...new Set(times.flatMap((time) => slotBuckets(time, service.duration)))];
  const { rows } = await database.pool.query(
    "SELECT slot_start::text AS slot_start FROM booking_slot_locks WHERE appointment_date = $1 AND slot_start = ANY($2::time[]) AND (expires_at IS NULL OR expires_at > NOW())",
    [date, bucketSet]
  );
  const occupied = new Set(rows.map((row) => String(row.slot_start).slice(0, 5)));
  return json({
    date,
    times: times.map((time) => ({
      time,
      available: slotBuckets(time, service.duration).every((bucket) => !occupied.has(bucket))
    }))
  });
}

async function createBooking(request) {
  if (!sameOrigin(request)) return fail("Invalid request origin.", 403);
  let payload;
  try {
    const raw = await request.text();
    if (raw.length > 20000) return fail("Booking details are too large.", 413);
    payload = JSON.parse(raw);
  } catch {
    return fail("Invalid booking details.");
  }

  const service = getService(payload.serviceId);
  const addons = getAddons(payload.addonIds || []);
  const customer = payload.customer || {};
  const name = String(customer.name || "").trim().slice(0, 120);
  const phone = normalizePhone(customer.phone);
  const email = String(customer.email || "").trim().toLowerCase().slice(0, 254);
  const note = String(customer.note || "").trim().slice(0, 1200);
  const date = String(payload.date || "");
  const time = String(payload.time || "");
  if (!service || !addons) return fail("The selected treatment or add-ons are invalid.");
  if (name.length < 2) return fail("Enter your full name.");
  if (!/^(?:\+234|0)[789][01]\d{8}$/.test(phone)) return fail("Enter a valid Nigerian phone number.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("A valid email address is required for the Paystack receipt.");
  if (!validDate(date) || date <= lagosToday()) return fail("Choose a future appointment date.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return fail("Choose a valid appointment time.");
  if (!candidateTimes(date, service.duration).includes(time)) return fail("That time is outside the treatment opening hours.", 409);

  const totalNgn = service.price + addons.reduce((sum, addon) => sum + addon.price, 0);
  const bookingId = randomUUID();
  const bookingReference = reference();
  const paymentReference = bookingReference + "-PAY";
  const expiry = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);
  const database = db();
  const buckets = slotBuckets(time, service.duration);

  const client = await database.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE bookings SET status = 'expired' WHERE status = 'pending_payment' AND expires_at <= NOW()"
    );
    await client.query(
      "DELETE FROM booking_slot_locks WHERE expires_at IS NOT NULL AND expires_at <= NOW()"
    );
    await client.query(
      `INSERT INTO bookings
       (id, reference, service_id, service_name, service_price_ngn, addon_items,
        appointment_date, start_time, duration_minutes, customer_name, customer_phone,
        customer_email, customer_note, therapist_preference, occasion, total_ngn,
        deposit_ngn, status, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pending_payment',$18)`,
      [
        bookingId, bookingReference, service.id, service.name, service.price,
        JSON.stringify(addons), date, time, service.duration, name, phone, email,
        note || null, String(payload.therapistPreference || "Any available").slice(0, 60),
        String(payload.occasion || "None").slice(0, 60), totalNgn, DEPOSIT_NGN, expiry
      ]
    );

    for (const bucket of buckets) {
      const locked = await client.query(
        `INSERT INTO booking_slot_locks (appointment_date, slot_start, booking_id, expires_at)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING slot_start`,
        [date, bucket, bookingId, expiry]
      );
      if (locked.rowCount !== 1) {
        const error = new Error("That appointment time has just been taken. Please choose another time.");
        error.statusCode = 409;
        throw error;
      }
    }
    await client.query(
      "INSERT INTO payments (booking_id, reference, amount_kobo, currency, status) VALUES ($1,$2,$3,'NGN','pending')",
      [bookingId, paymentReference, DEPOSIT_NGN * 100]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.statusCode === 409) return fail(error.message, 409);
    throw error;
  } finally {
    client.release();
  }

  try {
    const origin = new URL(request.url).origin;
    const checkout = await paystackRequest("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email,
        amount: DEPOSIT_NGN * 100,
        currency: "NGN",
        reference: paymentReference,
        callback_url: origin + "/payment-return.html",
        metadata: {
          booking_reference: bookingReference,
          service_name: service.name,
          appointment_date: date,
          appointment_time: time,
          custom_fields: [
            { display_name: "Booking reference", variable_name: "booking_reference", value: bookingReference }
          ]
        }
      })
    });
    return json({
      bookingReference,
      paymentReference,
      authorizationUrl: checkout.authorization_url,
      holdExpiresAt: expiry.toISOString(),
      depositNgn: DEPOSIT_NGN
    }, 201);
  } catch (error) {
    await database.pool.query("UPDATE bookings SET status='cancelled' WHERE id=$1", [bookingId]);
    await database.pool.query("DELETE FROM booking_slot_locks WHERE booking_id=$1", [bookingId]);
    await database.pool.query("UPDATE payments SET status='failed' WHERE booking_id=$1", [bookingId]);
    return fail(error.message || "Could not start Paystack checkout.", 502);
  }
}

async function verifyWithPaystack(referenceValue) {
  const encoded = encodeURIComponent(referenceValue);
  const verified = await paystackRequest("/transaction/verify/" + encoded);
  if (verified.status !== "success" || verified.currency !== "NGN") {
    throw new Error("Payment is not successful.");
  }
  return verified;
}

async function completePayment(referenceValue, verified) {
  const database = db();
  const { rows } = await database.pool.query(
    `SELECT p.*, b.id AS booking_id, b.status AS booking_status,
            b.expires_at, b.appointment_date, b.start_time, b.duration_minutes,
            b.customer_email, b.deposit_ngn
     FROM payments p JOIN bookings b ON b.id=p.booking_id
     WHERE p.reference=$1 LIMIT 1`,
    [referenceValue]
  );
  const payment = rows[0];
  if (!payment) throw new Error("Payment reference was not found.");
  if (verified.reference !== referenceValue ||
      Number(verified.amount) !== Number(payment.amount_kobo) ||
      verified.currency !== "NGN" ||
      String(verified.customer?.email || "").toLowerCase() !== String(payment.customer_email || "").toLowerCase()) {
    throw new Error("Paystack verification did not match this booking.");
  }
  if (payment.status === "success" && payment.booking_status === "confirmed") {
    return { status: "confirmed", bookingReference: (await database.pool.query("SELECT reference FROM bookings WHERE id=$1", [payment.booking_id])).rows[0]?.reference };
  }

  const client = await database.pool.connect();
  try {
    await client.query("BEGIN");
    const bookingResult = await client.query("SELECT * FROM bookings WHERE id=$1 FOR UPDATE", [payment.booking_id]);
    const booking = bookingResult.rows[0];
    if (!booking) throw new Error("Booking record was not found.");

    if (booking.status !== "confirmed") {
      const buckets = slotBuckets(String(booking.start_time).slice(0, 5), booking.duration_minutes);
      if (new Date(booking.expires_at).getTime() <= Date.now() || booking.status === "expired") {
        await client.query("DELETE FROM booking_slot_locks WHERE expires_at IS NOT NULL AND expires_at <= NOW()");
        let acquired = 0;
        for (const bucket of buckets) {
          const result = await client.query(
            `INSERT INTO booking_slot_locks (appointment_date, slot_start, booking_id, expires_at)
             VALUES ($1,$2,$3,NULL) ON CONFLICT DO NOTHING RETURNING slot_start`,
            [booking.appointment_date, bucket, booking.id]
          );
          acquired += result.rowCount;
        }
        if (acquired !== buckets.length) {
          await client.query("UPDATE bookings SET status='payment_review' WHERE id=$1", [booking.id]);
          await client.query("UPDATE payments SET status='success_review', gateway_response=$2::jsonb, paid_at=NOW() WHERE reference=$1", [referenceValue, JSON.stringify(verified)]);
          await client.query("COMMIT");
          return { status: "payment_received_review", bookingReference: booking.reference };
        }
      } else {
        await client.query("UPDATE booking_slot_locks SET expires_at=NULL WHERE booking_id=$1", [booking.id]);
      }
      await client.query("UPDATE bookings SET status='confirmed', confirmed_at=NOW() WHERE id=$1", [booking.id]);
    }
    await client.query(
      "UPDATE payments SET status='success', paystack_transaction_id=$2, gateway_response=$3::jsonb, paid_at=COALESCE(paid_at,NOW()) WHERE reference=$1",
      [referenceValue, String(verified.id), JSON.stringify(verified)]
    );
    await client.query("COMMIT");
    return { status: "confirmed", bookingReference: booking.reference };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function verifyPayment(request) {
  const url = new URL(request.url);
  const referenceValue = String(url.searchParams.get("reference") || "").slice(0, 100);
  if (!/^VRS-[A-Z0-9-]+-PAY$/.test(referenceValue)) return fail("Invalid payment reference.");
  try {
    const verified = await verifyWithPaystack(referenceValue);
    const result = await completePayment(referenceValue, verified);
    return json(result);
  } catch (error) {
    return fail(error.message || "Payment verification failed.", 402);
  }
}

function validWebhookSignature(raw, request, secret) {
  const signature = request.headers.get("x-paystack-signature");
  if (!signature) return false;
  const expected = createHmac("sha512", secret).update(raw).digest();
  let received;
  try { received = Buffer.from(signature, "hex"); } catch { return false; }
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function webhook(request) {
  const secret = Netlify.env.get("PAYSTACK_SECRET_KEY");
  if (!secret) return fail("Webhook is not configured.", 503);
  const raw = await request.text();
  if (!validWebhookSignature(raw, request, secret)) return fail("Invalid Paystack signature.", 401);
  let event;
  try { event = JSON.parse(raw); } catch { return fail("Invalid webhook payload."); }
  if (event.event !== "charge.success" || !event.data?.reference) return json({ received: true });

  const database = db();
  const eventId = "charge.success:" + String(event.data.reference);
  const inserted = await database.pool.query(
    "INSERT INTO paystack_webhook_events (event_id,event_type) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING event_id",
    [eventId, event.event]
  );
  if (inserted.rowCount === 0) return json({ received: true, duplicate: true });

  try {
    const verified = await verifyWithPaystack(String(event.data.reference));
    await completePayment(String(event.data.reference), verified);
    return json({ received: true });
  } catch (error) {
    // Return a non-2xx so Paystack retries transient verification/database failures.
    await database.pool.query("DELETE FROM paystack_webhook_events WHERE event_id=$1", [eventId]);
    return fail(error.message || "Webhook processing failed.", 500);
  }
}

export default async (request) => {
  try {
    const path = new URL(request.url).pathname;
    if (path === "/api/health" && request.method === "GET") return await health();
    if (path === "/api/availability" && request.method === "GET") return await availability(request);
    if (path === "/api/bookings" && request.method === "POST") return await createBooking(request);
    if (path === "/api/payments/verify" && request.method === "GET") return await verifyPayment(request);
    if (path === "/api/paystack/webhook" && request.method === "POST") return await webhook(request);
    if (path.startsWith("/api/")) return fail("Method not allowed.", 405);
    return fail("Not found.", 404);
  } catch (error) {
    console.error("Velvet Rose API error:", error.message);
    return fail("The booking service is temporarily unavailable. Please try again.", 500);
  }
};

export const config = { path: "/api/*" };
