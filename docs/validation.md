# Validation record

Verified October 7, 2026.

- Angular 20 production build: passed.
- GitHub Pages base-path production build (`/the-gathering-table/`): passed.
- Domain tests: 13 passed, including Timestamp round-trip, explicit IANA conversion, DST gap/overlap handling, seat bounds, application/acceptance separation, retirement and Closed-state preservation.
- Firestore emulator security tests: 29 passed. Includes concurrent fixed reservations and GM acceptances for the last seat, rolling first-date gates, pending applications excluded from the minimum, GM scheduling below minimum after initial booking, Closed-state preservation, retirement/reviews, participant-only inbox access, preference revocation, reply consent, forged senders and immutable messages.
- Browser checks: filtering, sample sign-in, rolling application without occupying a seat, GM acceptance, first scheduling and confirmation, Established/Closed lifecycle changes, Closed rescheduling to a different day/time, private question and GM reply, opt-in preferences, and retirement roster verified.
- Mobile dashboard: no horizontal overflow at a 390px viewport.
- Built static app served under `/the-gathering-table/`; six sample campaigns supplied, with full tables hidden by default.

The polyfill's transitive `jsbi` dependency produces an Angular CommonJS optimization warning; the build succeeds. Firebase project the-gathering-table-afd96 is configured. Firestore rules/indexes deployed successfully; email/password sign-in enabled and GitHub Pages hostname authorized. GitHub Actions passed all 42 tests and deployed commit 9c76131 at https://deerbuster.github.io/the-gathering-table/. Live browser discovery reads an empty Firestore catalog without errors and has no demo banner. Creating real accounts and exercising live authenticated player/GM writes remain pilot verification tasks.

- Notification checks: GM sees one pending application and one unread incoming message; inbox opening alone preserves unread status, selecting the conversation clears it, and accepting the applicant clears the application alert. Read receipt security tests cover self-only access, future/backwards timestamps and extra fields.


- Added checks: atomic acceptance/decline inbox updates, feedback delivery, opted-out applicants, forged/replayed status updates, physical location requirements, custom virtual/voice service names, and boolean recording/broadcast flags. Browser checks verified cancellation, acceptance feedback, physical location persistence, remote defaults, conditional required fields and FoundryVTT/Discord recording/broadcast disclosures.

- Applicant browser check: opted-out Alex received an unread inbox alert; opening the GM conversation displayed Application accepted and the welcome feedback, then cleared the badge. No console errors; no horizontal overflow at 390px.

- Profile-picture update: 14 domain and 30 Firestore emulator tests passed. Browser upload/save/public-display verified in an isolated demo; existing opt-out remained false. New registrations default incoming messages to true.
- Paid flag: 15 domain and 31 emulator tests pass. Paid-only demo search returns one table; Free-only returns four non-full tables; All restores both. Mobile filter width verified at 390px with no overflow. Legacy campaign reads and membership changes remain valid.
