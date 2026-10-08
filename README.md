# The Gathering Table

A static Angular application for finding groups and scheduling sessions for Iron Crown Enterprises tabletop games. Includes Rolemaster Classic, RMSS, RMFRP, RMU, Space Master, MERP, and HARP. No payments, VTT implementation, or game rules engine.

## Run the working sample

Requires Node.js 22.12+ or Node.js 24 and npm. Angular 20 is intentionally paired with AngularFire 20's supported peer range; versions are locked in package-lock.json.

```sh
npm ci
npm start
```

Open http://127.0.0.1:4200/. The checked-in runtime configuration selects **sample preview**. The banner is visible throughout the app. Sample identities and campaign changes exist only in memory and reset on a full reload; they never contact Firebase. No account is created when choosing a demo identity.

Choose **Alex · Player** to apply to a rolling-start table, join a fixed-start table, ask the GM questions, or leave and become Retired. Choose **Mara · Game master** to accept applicants, schedule The Ashen Frontier, confirm or reschedule its next session, manage its lifecycle, or host a new campaign. Switch roles through My account → Sign out. Inbox conversations are private to their two participants. Account preferences control incoming questions from prospective players; Finch is an example retired player who accepts messages. Changes reset on reload.

## Connect a new Firebase project

1. Create a project in the [Firebase console](https://console.firebase.google.com/). Register a Web app and copy its public Firebase options. Do not provide service-account/private keys.
2. Enable **Authentication → Email/Password**.
3. Create a **Cloud Firestore** database. Choose its location deliberately; use production/locked rules initially.
4. Replace `public/firebase-config.json` with the public web options, following `public/firebase-config.example.json`. Its `mode: demo` property must be removed. Do not use the example placeholder values.
5. Authenticate the Firebase CLI and deploy the included rules and index configuration to your project:

   ```sh
   npx firebase login
   npx firebase deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID
   ```

6. In Authentication settings, add your Pages hostname and any custom domain to **Authorized domains**. Add `localhost` / `127.0.0.1` if testing locally and they are not already authorized.
7. Restart the local server or rebuild. The sample banner disappears only when valid live Firebase options are loaded. Sign up, save a player profile, and publish a campaign. The live database starts empty; sample campaigns are never seeded into it.
8. Before inviting users, exercise signup/signin, profile creation, hosting, joins from separate accounts, leaving, rescheduling, confirmation, completion and reviews against your configured project. Local emulator tests do not verify a deployed project's configuration.

Public Firebase web configuration is not an administrator credential. Firestore rules enforce access. Never put a service-account JSON file in `public/` or GitHub repository variables. A malformed supplied configuration produces a startup error rather than silently falling back to demo mode.

## Deploy to GitHub Pages

The app has no SSR and no application server. Firebase runs authentication and database operations directly from the browser. Hash routing makes routes such as `/the-gathering-table/#/games/abc` compatible with Pages without rewrite rules.

1. Create a GitHub repository and copy this directory's source files into its root. Commit package-lock.json, firestore.rules, firebase.json, and `.github/workflows/pages.yml`.
2. In the repository's Settings → Pages, select **GitHub Actions** as the source.
3. For a live build, add a repository **variable** named `FIREBASE_CONFIG`, containing the public Firebase options as a JSON object. Without it, the workflow deliberately publishes the labeled demo. Deploy Firestore rules to your Firebase project separately before publishing live.
4. Push to `main`, or run the Pages workflow manually. It runs the domain tests, Firestore emulator tests, and the production build before deployment.
5. The workflow derives the correct base path from the repository name. User/organization `.github.io` repositories use `/`. For a custom domain, set `PAGES_BASE_HREF: /` in the build step's environment and configure GitHub Pages' custom domain.

Manual project-site build:

```sh
npm run build:pages
```

This defaults to `/the-gathering-table/` outside Actions. Set `PAGES_BASE_HREF` to your actual repository path if different. The deployable directory is `dist/the-gathering-table/browser`. Serve the files over HTTP; opening index.html with file:// is not supported.

To preview the production build and its Pages base path locally, run `node scripts/preview.mjs` and open http://127.0.0.1:4201/the-gathering-table/.

## Tests

```sh
npm test
npm run test:rules
npm run build
```

Rules tests require Java 21 in PATH; the Firebase CLI downloads its local emulator on first use. On Windows, if npm reports a corporate TLS certificate error, use Node's trusted system CA store rather than disabling certificate verification:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
```

The rules tests use only the `demo-the-gathering-table` emulator project, never a live database. Permission-denied logs in negative tests are expected. The suite includes simultaneous last-seat reservations, self-only membership changes, protected scheduling, minimum-player confirmation, immutable completion, native Timestamp validation, profile protection, participant-only reviews, duplicate prevention and bounded review caches. Domain tests cover the DST gap and overlap cases and seat invariants.

## Code map

```text
src/app/core/
  auth.service.ts        Firebase Auth and explicit demo identities
  campaign.service.ts   AngularFire reads, transactional writes, demo repository
  message.service.ts    Private two-person campaign conversations
  models.ts             Database types and seat invariants
  time.ts               IANA timezone and DST-safe conversion
src/app/features/
  finder.component.*    Search/filter dashboard and My tables
  editor.component.*    Create campaigns and schedule next sessions
  detail.component.*    Markdown, roster, reservations, GM controls, calendar
  account.component.*   Signin/signup/reset and profile editing
  profile.component.*   Public biography and verified participant reviews
  inbox.component.*     Private conversations and message composer
src/app/shared/
  game-card.component.ts
docs/architecture.md
firestore.rules
tests/
```

## Scope and practical limits

- Table listings specify Physical (public location required), Virtual (Fantasy Grounds, FoundryVTT, Roll20 or Other), or Theater of the Mind (voice only). Remote tables require Discord, Zoom, Google Meet, Microsoft Teams or a custom voice service. Recording and broadcasting have separate visible disclosures; the app does not perform either service.
- GM accept/decline actions prompt for optional feedback and atomically deliver the decision to the applicant's inbox, even if unsolicited messages are disabled. Cancelling leaves the application unchanged.
- Each session is scheduled explicitly by the GM. Frequency records intent; there are no automated recurring writes, email notifications, payments, or integrations with a VTT.
- Rolling-start campaigns can be published without a date. Applications do not occupy seats: the GM accepts players before the minimum unlocks first-session scheduling. Fixed-start campaigns allow direct seat reservations. The start policy is immutable after publication.
- The minimum excludes the GM. Reaching it enables scheduling/confirmation; it does not automatically book or start play. Falling below the minimum clears confirmation. Previously scheduled campaigns can be rescheduled even below the minimum, but cannot be confirmed until enough players are accepted. Edits reset confirmation.
- Lifecycle is New, Established, Closed, or Completed, separate from capacity and scheduling. Closed stops recruitment while preserving play and GM scheduling; it can reopen. Completed freezes the roster and schedule.
- Leaving records a Retired player and frees their seat. Retired players remain eligible for reviews after completion. My tables includes hosted, accepted, pending and retired memberships. GMs see a pending-applications badge linking to tables awaiting decisions; it clears on acceptance, decline or withdrawal.
- The GM always accepts campaign questions. Current and retired players receive unsolicited questions only if they opt in. Starting a conversation consents to replies in that conversation. Message content is private to its two participants; the Inbox badge counts unread incoming messages, and opening a conversation clears its count. Read state is private to the reader. There is no group chat, moderation, blocking or deletion UI.
- Profiles, campaigns, participant IDs and reviews are public. Private contact information must not be entered into these documents.
- The discovery catalog reads all four recruitment statuses and filters locally, with recruiting campaigns shown by default. For a large community, move filtering and pagination into indexed queries. Reviews and message histories also need pagination at scale. Rules cap pending applications at 50 and retired history at 500 per campaign.
- Usernames are display names, not globally unique handles. Ratings are not aggregated into a reputation score.
- `pastPlayerReviews` contains at most the first 20 verified reviews. Its canonical subcollection holds all reviews and supplies the profile UI. Reviews are immutable, one per reviewer/target/campaign. No moderation UI or account-deletion workflow is included.
- Timezone validity and agreement between recurrence metadata and Timestamp are checked in the app. Rules enforce the Timestamp type, future scheduling, bounds, and authorization; they cannot validate IANA timezone calculations. Browser clocks must be accurate for the review timestamp check (within five minutes of server time).
- This is an independent community app. Publisher association and the availability of the app name have not been established.

## References

[AngularFire Firestore](https://github.com/angular/angularfire/blob/main/docs/firestore.md), [Angular DatePipe](https://angular.dev/api/common/DatePipe), [Tailwind Angular setup](https://tailwindcss.com/docs/installation/framework-guides/angular), [Firebase transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), [Firebase rule testing](https://firebase.google.com/docs/firestore/security/test-rules-emulator).

- Paid game is a filterable campaign flag. GMs arrange any charges directly; this app does not process payments.


Campaign preparation and artwork: new campaigns default to Preparing (publicly visible but no applications or seat reservations). The GM opens recruitment to move to New; creation can optionally open immediately. Existing tables retain their status. Campaign backgrounds accept JPG/PNG/WebP up to 5 MB, preserve the full composition with proportional resizing up to 1600 x 1200 JPEG, and store an optional bounded backgroundImageURL (300,000 characters maximum). Only the GM can save/remove artwork through the campaign editor.


Roles and moderation are described in [docs/security-and-moderation.md](docs/security-and-moderation.md). Verified email is required for participation. Trusted owner initialization must follow verified email and security-rule deployment; do not grant owner privileges through public profile fields.
