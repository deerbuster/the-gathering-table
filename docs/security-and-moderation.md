# Roles, moderation, and verified email

## Roles and protected owner

Member is the default for accounts without an access record. Admins may assign Member, Moderator, or Admin roles; Moderators may take actions against Members only. Admins may act against other staff. Nobody may restrict or demote the protected owner or act against themselves. The owner UID is stored in `/siteSecurity/owner`, which clients cannot write. No client-supplied email address or public profile field grants a role.

The trusted setup script looks up the designated owner in Firebase Authentication and refuses to grant Admin until that email is verified. Set `OWNER_EMAIL` in your local shell, then run `node scripts/bootstrap-owner.cjs` for a read-only inspection. After verified email and security deployment, run `node scripts/bootstrap-owner.cjs --apply`. It uses the existing Firebase CLI credential in memory, records a bootstrap audit, creates only absent records, and never prints tokens or exports passwords. Do not publish your email or credentials in configuration.

## Definitions and expiry

- Mute: messages and reviews are blocked; existing inbox content remains readable.
- Timeout: community changes are blocked; existing private content remains readable.
- Ban: community changes and private inbox access are blocked. Public listings and profiles remain public, and users can read their own restriction state and history.
- Timeout/mute durations: one hour, one day, one week.
- Ban durations: one week, 30 days, 90 days, permanent. The UI states the day counts explicitly.

A restriction stores a native server-generated Timestamp (`startedAt`), duration in seconds, and a permanent flag. Rules compare `startedAt + duration` with `request.time`. Expiry therefore requires no scheduled job, device clock, client write or document deletion. Historical restriction fields remain after expiry, and the audit history remains intact.

Firebase Authentication sign-in is not disabled by these rules. A banned user can still authenticate and view their own notice, but cannot participate or access the private inbox. Auth account disabling, token revocation, server-enforced request-rate limits and recovery controls require a trusted backend; this release stays compatible with static GitHub Pages hosting.

## Private state and append-only audit

`/accountAccess/{uid}` contains role, timeout/mute/ban records, revision, lastActionId, and updatedAt. Access records are read by their subject and staff only. `/accountAccess/{uid}/actions/{actionId}` contains actor UID, actor display name, reason, server timestamp, action kind, and before/after snapshots. Every role/restriction/lift action is an atomic transaction with a matching audit entry. Direct state writes, forged actors, replayed entries, deleted/edited history, unsupported durations and missing reasons are denied by rules.

Campaign moderation permits only name/description changes, including on completed campaigns, and changes neither scheduling confirmation nor schedule revisions. `/campaigns/{id}/actions/{actionId}` records actor, reason, time and before/after content; the campaign stores moderationRevision/lastModerationId. Only staff and the GM can read campaign history. Staff may not take over a campaign, add players or reschedule it through the moderation path.

The console browses the first 100 public profiles alphabetically; any account can also be selected by its UID from a profile link. History views show the latest 50 entries; older entries remain stored. Account actions appear in the subject's account page; campaign history appears to the GM/staff on campaign details.

## Verified email

New registrations send Firebase's verification email. Existing accounts see verification controls in My account. Refreshing verification reloads the Firebase user and forces an ID-token refresh. Profiles are created after verification. Firestore checks `request.auth.token.email_verified` for participation and private inbox access, including direct SDK/REST requests. Ordinary profile/role fields cannot impersonate that claim.

## Additional security priorities

1. MFA for staff; Firebase TOTP/SMS MFA requires Identity Platform configuration. Require recent authentication for sensitive role changes when adding the trusted backend.
2. App Check for Firestore/Auth; register the production web app/provider, observe metrics, then enforce. Do not enable enforcement before clients supply valid attestation.
3. Firebase Auth password policy and email enumeration protection. No console changes are silently claimed by this release.
4. Server-enforced rate limits for messaging, account creation and abuse reports. UI throttles alone are insufficient.
5. A private report/block/appeal workflow, staff-access reviews, backups and alerts for role grants/permanent bans.

References: https://firebase.google.com/docs/rules/basics ; https://firebase.google.com/docs/auth/web/password-auth ; https://firebase.google.com/docs/auth/web/multi-factor ; https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
