# Cowtail notification inbox and service controls

Cowtail receives messages from apps, services and scripts. A library hold, a download finishing, a doorbell press and a production alert all belong in the same Inbox. The sender supplies the content. The recipient decides which senders may interrupt them.

Pushover's useful precedent is the small first integration: register an application, send a message, then add a title, link or priority when the message warrants it. Cowtail can use its existing source credentials and account model for that flow. [Pushover Message API](https://pushover.net/api)

## The first message

A person registers a service called “Library,” gives its credential to a script and sends “Your hold is ready for pickup.” That text alone is enough content for an ordinary, immediate, single notification. Cowtail derives the sender from the credential and uses the service name as the notification heading when no title was supplied. A sender can optionally supply a title, a labeled link or a priority. Reading a message and following its link are complete use cases.

Today the [notify command](../cli/src/commands/items/notify.ts) requires a title, kind and urgency. The [direct send command](../cli/src/commands/push/send.ts) can send to a device through a route that skips Inbox persistence. Bring those paths together at message acceptance. Persist the message first, return its stable ID and apply the recipient's preferences before attempting a push. Keep the message retrievable when the device is offline, has push disabled or the sender is muted. Distinguish acceptance from device delivery in the API result. A sender retry with the same idempotency key returns the original message; two intentional sends with identical text appear separately. Preserve existing producer contracts and explicit diagnostic pushes.

## Inbox on phone and web

Open to **All messages**, newest received first. A compact row shows the sender's icon and name, received time, optional title, body preview and unread state. The body gets the space when there is no title. Two messages from the same app remain individually readable. A delivery retry never creates another row. A source with a richer integration can attach actions or link to incident detail without changing the order or layout of everyone else's mail.

A single tap opens the exact message shown on the lock screen. Its detail shows the original content, sender, timestamp, links and any actions the sender supplied. Opening it marks it read across devices. An approval or acknowledgement requires its own explicit action. Back restores the reader's place. If Cowtail groups several messages into a push, tapping it opens those exact messages using a stable batch ID.

Put search, sender and unread filters behind the list's filter button. Tapping a sender can apply the same sender filter. The message menu offers mark read/unread and quick mute with Undo. Muted senders' messages remain searchable in All messages. Keep specialized destinations such as investigations, approvals and cluster health accessible through their existing routes. The badge on the generic Inbox should count unread messages; verify the migration from today's live-item badge across iOS, web and background sync.

## Service controls

List every [registered source](../web/convex/sources.ts) in Settings → Notifications → Services, including senders with no messages yet. Match preferences to the stable source slug across renames, and present the service's display name and icon. Each account has its own switches, shared across devices.

| Notifications | Allow urgent while muted | What interrupts the recipient |
| --- | --- | --- |
| On | Either | Ordinary messages notify once by default. Explicit priority and scheduling rules apply. |
| Off | On | Only messages with effective urgent priority |
| Off | Off | No automatic notifications from this service |

Both switches default to on. Turning off Notifications reveals the urgent exception. Show **Urgent only** or **Muted** and remember the exception when Notifications is turned back on. The same control is available from the sender's message menu. Update one field on one service per write. Apply the change immediately in the client, restore the confirmed value on refusal, and reconcile an uncertain save with the server.

## Implementation order

1. **Prove the first send.** Extend the registered-source API and CLI with message-only input. Inspect the existing shared item representation before adding storage or types. Give the Inbox a durable message and a server-owned, paginated read model. Map existing automated sends into this path with identifiable sources. Verify that a new script can send an ordinary message with zero domain-specific fields.
2. **Ship the mailbox and delivery controls together.** Build All messages, exact-message navigation, read state, sender search/filtering, both Settings switches and quick mute with Undo. Update the iOS and web mockups. Reuse the existing row, source identity and preference-write components where they fit. Make the same server-side policy govern automatic sends, repeats and each message at batch flush. Recheck queued messages before sending. Omit muted members from batch text, count and membership. Unmuting never replays old messages.
3. **Make silence understandable and temporary.** Show the delivery decision in message detail, for example “Saved quietly · Library is muted.” Offer mute for one hour, until tomorrow morning or indefinitely. Show the local resume time before saving and evaluate expiry on the server. A manual edit supersedes an old timer. A reminder the recipient explicitly requests can ring once; a sender-scheduled message follows that sender's settings.
4. **Help identify noise.** Add a Most notifications sort with a stated counting window. Count one successful visible send per source across devices. A mixed batch counts once per represented source, and repeat sends are identifiable. Exclude silent syncs, suppressed sends and diagnostics. APNs acceptance is evidence of a send, not proof a person saw it.
5. **Offer control over urgent repeats.** Urgent priority permits a message through an urgent-only mute. For a sender using repeated alerts, offer **Alert once** to stop subsequent attempts. Keep its existing configured repeat behavior through migration. New general-purpose senders start with one notification per message.
6. **Keep finer controls with the sender that supplies them.** Alertmanager can add workload muting to its own sender view when producer data identifies a workload reliably. Its service-wide mute still wins. Other services can send ordinary messages without knowing what a workload is.

## Acceptance checks

- Prototype the first screen with library, doorbell and download messages from three unrelated senders. A new user can find a message they remember, open its link, read others from the same sender and mute it from that message.
- Send two identical texts as separate messages, then retry one with its original key. Expect two Inbox rows. Verify a muted send and a send with no registered device both remain readable.
- Verify all three delivery modes, source renames, concurrent preference edits, temporary mute expiry and no backlog replay. Confirm an urgent message from a muted source can break through only when allowed.
- Exercise a mixed batch at flush, queued repeats after muting, a message read on another device, an old lock-screen tap and an explicit reminder. Verify that opening an actionable message never submits its action.
- Preserve existing integrations' quiet hours, maintenance rules, escalation and reminder semantics where applicable. Test Alertmanager and Hermes as individual senders alongside ordinary scripts. Extend the [delivery tests](../web/convex/itemDelivery.test.ts) and verify both clients against the revised [mockups](mockups/app-rewrite.html).
