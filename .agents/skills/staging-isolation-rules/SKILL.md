---
name: staging-isolation-rules
description: Rules for any code change in this app. The app runs a staging environment (branch main, Firestore database "staging") and production (branch production, database "(default)") in the same Firebase project. Apply these rules whenever you add or change Firestore access, emails, Cloud Functions, environment variables, storage, auth, or external API calls.
---

# Keep staging and production isolated

- Never call `getFirestore(app)`, `admin.firestore()`, or `initializeFirestore` without the database id. Always use the existing `FIRESTORE_DB_ID` from `src/firebase/index.ts` (client) or `adminDb` from `src/lib/firebaseAdmin.ts` (server). Never create a new Firestore instance in another file.
- Never hard-code `'(default)'` or `'staging'` as a database name in app code.
- Never edit `apphosting.staging.yaml` or add `NEXT_PUBLIC_FIRESTORE_DATABASE_ID` / `EMAIL_REDIRECT_TO` to `apphosting.yaml`.
- Any new email (writes to the `mail` collection, Gmail, SMTP): if `process.env.EMAIL_REDIRECT_TO` is set, send to that address instead and prefix the subject with `[STAGING] `. Redirect cc/bcc too.
- Cloud Functions in `functions/src/index.ts`: new Firestore-triggered functions go through `makeTicketEmailFunctions` (or the same factory pattern) so both prod and the `staging` group get them, with `database`, `baseUrl`, `redirectTo`, `requireRedirect`. Never remove `requireRedirect`, never rename existing prod exports, never use `admin.firestore()` inside handlers, never hard-code the production URL.
- Never add scheduled or HTTP functions to the `staging` group.
- Storage uploads/deletes: the bucket is shared; prefix paths with `staging/` when `NEXT_PUBLIC_FIRESTORE_DATABASE_ID === 'staging'`.
- Never create, delete or change Firebase Auth users or custom claims without telling the user (Auth is shared with production).
- Never commit `.env` files, service-account JSON, SMTP URIs, or API keys.
- Never edit `firebase.json`, `.firebaserc`, `firestore.rules`, or `firestore.indexes.json` unless explicitly asked.

If a request would break one of these rules, say so and propose a compliant version.
