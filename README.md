# Velvet Rose Spa & Wellness

This repository contains the standalone Velvet Rose Spa & Wellness website. Ivory Dental Studio is maintained separately in its own repository.

## Source of truth

`index.html` is the HTML file supplied by the project owner. It contains the page styling and browser-side booking-request experience in one file. Do not replace it with the previous demo interface or redesign it without approval.

## Local preview

Requirements: Node.js 20+ and npm.

1. Run `npm run build`.
2. Run `npm run dev`.
3. Open `http://localhost:4173`.

The build copies only `index.html` into `public/` for Netlify. No Firebase SDK, Firebase project, Auth, Firestore, or emulator is used by this site.

## Current booking behaviour

The uploaded HTML currently collects a preferred appointment date/time and prepares a booking request for the spa team to confirm. WhatsApp, phone, email, address, bank transfer details and payment link are blank configuration values in the HTML and must be supplied by the business owner before real customer use. The page does not yet provide a server-backed booking database, guaranteed live availability, or verified online payment processing.

## Netlify

Netlify publishes the `public/` directory using `netlify.toml`. The site is kept separate from the Ivory Dental Studio project.
