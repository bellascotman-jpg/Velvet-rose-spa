import test, { before, after } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { readFile } from "node:fs/promises";

const projectId = "demo-velvet-rose";
let env;

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules }
  });

  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "customers/customer-a"), { displayName: "Customer A" });
    await setDoc(doc(db, "customers/customer-b"), { displayName: "Customer B" });
    await setDoc(doc(db, "bookings/booking-a"), {
      customerUid: "customer-a",
      status: "pending_payment",
      appointmentDate: "2026-12-01"
    });
    await setDoc(doc(db, "bookings/booking-b"), {
      customerUid: "customer-b",
      status: "pending_payment",
      appointmentDate: "2026-12-02"
    });
  });
});

after(async () => {
  await env?.cleanup();
});

test("a customer can read their own profile", async () => {
  const db = env.authenticatedContext("customer-a").firestore();
  await assertSucceeds(getDoc(doc(db, "customers/customer-a")));
});

test("a customer cannot read another customer's profile", async () => {
  const db = env.authenticatedContext("customer-a").firestore();
  await assertFails(getDoc(doc(db, "customers/customer-b")));
});

test("a customer can read only their own booking records", async () => {
  const db = env.authenticatedContext("customer-a").firestore();
  const own = query(collection(db, "bookings"), where("customerUid", "==", "customer-a"));
  const results = await assertSucceeds(getDocs(own));
  if (results.size !== 1) throw new Error("Expected exactly one owned booking");
});

test("a customer cannot query all bookings", async () => {
  const db = env.authenticatedContext("customer-a").firestore();
  await assertFails(getDocs(collection(db, "bookings")));
});

test("customers cannot create or modify booking records directly", async () => {
  const db = env.authenticatedContext("customer-a").firestore();
  await assertFails(setDoc(doc(db, "bookings/forged"), {
    customerUid: "customer-a",
    status: "paid"
  }));
});

test("unauthenticated clients cannot read customer or booking data", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "customers/customer-a")));
  await assertFails(getDoc(doc(db, "bookings/booking-a")));
});
