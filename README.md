# Velvet Rose Spa & Wellness

This repository is the standalone Velvet Rose Spa booking project. Ivory Dental Studio is maintained in a separate repository.

## Local development

Requirements: Node.js 20+ and npm.

1. Install dependencies:

   `npm install`

2. Build the static site into `public/`:

   `npm run build`

3. Start Firebase Auth and Firestore emulators in one terminal:

   `npm run emulators`

4. Start the local site in a second terminal:

   `npm run dev`

5. Open `http://localhost:4173`. On localhost, the client connects to the Auth emulator on port 9099 and Firestore emulator on port 8080.

6. Run the Firestore security-rule tests:

   `npm run test:rules`

Firebase emulator project ID: `demo-velvet-rose`.

## Firebase project setup

- Create a Firebase project and register a Web app.
- Enable Email/Password under Firebase Authentication.
- Create the Firestore database.
- Replace the demo values in `config.js` with that project's public Web app config.
- Keep `demoMode: true` until server-side booking, payment, customer-profile and admin flows are deployed and acceptance-tested.
- Never commit service-account JSON, private keys, Paystack keys or email-provider keys.

## Security baseline

- Firestore rules deny writes from browsers.
- Customers can read only their own customer record and bookings.
- Booking creation, slot holds, payment state, admin permissions and audit records must be enforced by trusted server functions.
- Only a verified Paystack webhook may mark a payment as paid.

## Netlify

The build copies only `index.html`, `styles.css`, `config.js` and `app.js` into `public/`. Netlify publishes `public/`; server functions live outside that directory in `netlify/functions/`.

The currently deployed Netlify version remains a clearly labelled demo until the real Firebase project and server-side integrations are configured.
