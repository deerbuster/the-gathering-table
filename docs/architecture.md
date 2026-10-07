# Database and scheduling blueprint

## Collections

`/users/{authUid}`

| Field | Type | Meaning |
| --- | --- | --- |
| username | string | Public name, maximum 60 characters |
| biography | string | Public biography, maximum 4,000 characters |
| allowCampaignMessages | boolean | Opt into questions as a current or retired player; defaults true for new profiles; existing choices are preserved |
| pastPlayerReviews | array of Review maps | Bounded cache, first 20 verified reviews |

`/users/{targetUid}/reviews/{campaignId}_{reviewerUid}` is the canonical immutable review document. It contains `id`, integer `rating` (1–5), `text` (maximum 2,000 characters), `reviewerName` snapshot, `reviewerId`, `campaignId`, and native Timestamp `createdAt`. Both users must be accepted or retired participants of the completed campaign, or be its GM. The reviewer name must equal their current profile name. An atomic transaction creates the review and appends to the target's cache if it has fewer than 20 entries. Security rules check the post-transaction state using getAfter. Beyond 20 reviews only the canonical document is created.

`/campaigns/{campaignId}`

| Field | Firestore type | Meaning |
| --- | --- | --- |
| name | string | Campaign name, 1–120 characters |
| systemType | string enum | Rolemaster Classic, RMSS, RMFRP, RMU, Space Master, MERP, HARP |
| gmUserId | string | Immutable authenticated creator UID |
| gmName | string | Creator profile-name snapshot |
| minPlayers | integer | 1–maxPlayers; GM excluded |
| maxPlayers | integer | 1–20; GM excluded |
| currentPlayers | integer | Must equal playerIds.length |
| playerIds | array of strings | Unique player UIDs; GM excluded |
| pendingPlayerIds | array of strings | Applications awaiting GM acceptance; no occupied seats; maximum 50 |
| retiredPlayerIds | array of strings | Former accepted players; maximum 500; retained on rejoining |
| startMode | string enum | Fixed or Rolling; immutable |
| lifecycleStatus | string enum | New, Established, Closed, Completed |
| status | string enum | Open, Full, Closed, Completed; recruitment/capacity derived from lifecycle |
| scheduleState | string enum | Recruiting, Confirmed |
| scheduleRevision | integer | Starts at zero; increases on each campaign/schedule edit |
| description | string | Markdown, 1–20,000 characters |
| tableType | string enum | Physical, Virtual, Theater of the Mind |
| location | string | Required public venue/location for Physical, maximum 300 characters; empty otherwise |
| virtualPlatform | enum or null | Fantasy Grounds, FoundryVTT, Roll20, Other; null outside Virtual |
| platformOther | string | Required for Other virtual platform, maximum 100 characters; empty otherwise |
| voiceService | enum or null | Discord, Zoom, Google Meet, Microsoft Teams, Other; required remotely, null for Physical |
| voiceOther | string | Required for Other voice service, maximum 100 characters; empty otherwise |
| recorded | boolean | Explicit recording disclosure |
| broadcast | boolean | Explicit broadcasting/streaming disclosure, independent of recording |
| dayOfWeek | string enum or null | Weekday in campaign timezone; null while unscheduled |
| sessionLengthHours | number | 0.5–24 hours |
| frequency | string enum | One-shot, Weekly, Biweekly, Monthly |
| startTime | native Timestamp or null | Absolute next-session instant; null for an unscheduled rolling start |
| timeZone | string | IANA zone used to interpret the schedule |
| localStartTime | string or null | HH:mm wall-clock intent; null while unscheduled |

`id` on the client is injected by collectionData and is not stored in campaign documents. No redundant next-session date is stored.

`/campaigns/{campaignId}/sessions/{sessionId}` is reserved for future historical session records. It is not written by this version and is denied by rules. A future audited workflow can add `startTime: Timestamp`, session length and Scheduled/Completed/Cancelled status when session history becomes part of the product.

## Private messaging

`/conversations/{campaignId}_{sortedParticipantUids}` stores `campaignId`, `campaignName` snapshot, exactly two unique `participantIds`, `createdBy`, and server Timestamp `createdAt`. Only participants can read it. Inbox queries must constrain participantIds with array-contains for the authenticated UID. Conversation membership is immutable.

`/conversations/{conversationId}/messages/{messageId}` stores authenticated `senderId`, plain `text` (1–4,000 characters), and server Timestamp `createdAt`. Only the two participants read the immutable messages. A target must be the campaign GM or an opted-in current/retired player. Preferences are rechecked on every send. The conversation creator consents to replies in their initiated conversation even if their global incoming preference is off. Message bodies never enter public profiles or campaign documents.

Application decision messages additionally carry `decision: Accepted | Declined`. The GM decision form prompts for optional feedback (maximum 3,000 characters), then one Firestore transaction updates membership, creates the GM/applicant conversation if needed, and writes the status plus feedback message. A notification failure rolls back the decision. This transactional status update is allowed even when the applicant has not opted into unsolicited messages. Rules require a real pending-to-resolved application transition and a matching accepted/declined roster result; ordinary messages retain existing preference checks. The player can reply to the GM, and the standard unread badge includes the status message. Cancelling the prompt does not change the application.

## Status transitions

- Campaign creation: empty accepted, pending and retired arrays; New, Open, Recruiting. Fixed requires a future date. Rolling begins without a date.
- Fixed self-joins reserve a seat. Rolling applications only append to pendingPlayerIds; the GM accepts or declines them. Acceptance atomically moves one applicant into playerIds and recomputes currentPlayers/status. Concurrent last-seat requests are protected by transactions and rules.
- First scheduling of a rolling campaign requires at least minPlayers accepted players. Subsequent rescheduling can proceed below minimum, but confirmation cannot. A dated schedule cannot be cleared back to an unscheduled state.
- A self-leave removes only that UID and records it in retiredPlayerIds. Closed remains Closed; otherwise capacity recomputes. Falling below minPlayers clears confirmation. Retired players remain eligible for completed-campaign reviews.
- The GM confirms the next session only at or above minPlayers and before startTime.
- The GM edits the schedule with the roster unchanged, keeps capacity at or above currentPlayers, and resets scheduleState to Recruiting.
- Established is a GM classification and requires a dated schedule. Closed stops recruitment while retaining the roster and GM scheduling controls. It can reopen as New or Established. Completed freezes membership and scheduling; reviews use accepted, retired and GM history.

The client transaction retries on conflicting changes, and rules validate the resulting document. Disabling a button is only a usability aid.

## Time safety

Temporal interprets a datetime-local string in an explicit IANA zone. A DST gap always fails. A repeated hour fails by default and requires an earlier/later choice. The resulting instant becomes a JavaScript Date, passed to Firestore for conversion to a native Timestamp. Reads first guard against an unscheduled null, then use `campaign.startTime.toDate() | date:'short'` or separate date/time formats without a timezone override, showing the browser's local timezone. The browser's detected zone is visible above the filters.

Calendar export uses UTC DTSTART/DTEND, a stable campaign UID and scheduleRevision as SEQUENCE for the next occurrence only. No RRULE is generated from cadence metadata. A calendar download is a snapshot; later rescheduling does not update an imported event automatically.

## Static architecture

Angular standalone feature routes are lazy loaded. Reactive forms collect input; signals manage UI state. AngularFire collectionData supplies realtime campaign/profile/review reads. Firebase SDK transactions perform writes using the injected Firestore instance. Markdown is parsed by marked, sanitized with DOMPurify, and passed through Angular's standard innerHTML sanitization; no trust bypass is used.

The static runtime configuration is fetched relative to document.baseURI, so GitHub project paths work. Only a deliberate demo config or absent file selects the sample repository. Invalid live configuration fails visibly. Demo identities never initialize Firebase.

Firestore's built-in single-field indexes cover status, gmUserId and membership-array queries, including inbox participants; no composite indexes are currently needed. Authentication email/password credentials stay in Firebase Auth and never in public Firestore profiles.

## Existing-data migration

The included demo already uses this schema. If upgrading a previously deployed prototype, add allowCampaignMessages=false to profiles and pendingPlayerIds=[], retiredPlayerIds=[], startMode=Fixed, scheduleRevision=0 and lifecycleStatus to campaigns before enabling these strict rules. Map Completed to Completed; classify other existing campaigns as New or Established. No migration is needed for a new empty Firebase project.

Older campaign documents also need the eight meeting-detail fields above. Confirm each table's venue/platform, voice service, and recording/broadcast practice before populating them; unrelated fields must be empty or null according to tableType. The editor normalizes those fields when switching types. Meeting metadata edits use the existing GM revision/confirmation workflow. Disclosure does not itself record, stream, or connect to those services.

`/conversations/{conversationId}/reads/{authUid}` stores a native Timestamp `readThrough`. Only that participant can get or monotonically update their own receipt; other users cannot read it. Unread counts compare incoming message timestamps against this watermark. The current small-community implementation subscribes to message histories for inbox counts; pagination and server-maintained summaries would be needed at scale. Pending-application alerts derive in realtime from hosted campaigns and remain visible until resolved.

Profile photoURL is optional for backward compatibility. The uploader accepts JPG/PNG/WebP up to 5 MB, center-crops and re-encodes a 256px JPEG (removing source metadata), and stores a bounded JPEG data URI (90,000 characters maximum) in the profile. Rules allow only the owner to change it; empty removes it. No Storage bucket or external image URL is required. Profiles and active/retired rosters show the picture, with initials on missing or failed images.

- Campaign paid is an optional boolean for legacy compatibility; new documents must explicitly provide it. Missing/false is displayed and filtered as Free, true as Paid. Only the GM can set it through the campaign editor. The finder offers All/Free/Paid with All by default. This metadata does not charge users or handle payment transactions.


Campaign preparation and artwork: new campaigns default to Preparing (publicly visible but no applications or seat reservations). The GM opens recruitment to move to New; creation can optionally open immediately. Existing tables retain their status. Campaign backgrounds accept JPG/PNG/WebP up to 5 MB, preserve the full composition with proportional resizing up to 1600 x 1200 JPEG, and store an optional bounded backgroundImageURL (300,000 characters maximum). Only the GM can save/remove artwork through the campaign editor.
