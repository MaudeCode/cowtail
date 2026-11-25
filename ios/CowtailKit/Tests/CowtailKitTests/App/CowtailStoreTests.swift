import XCTest
@testable import CowtailKit

@MainActor
final class CowtailStoreTests: XCTestCase {
    private let approval = Item(
        id: "approval-1",
        source: "hermes",
        kind: .approval,
        urgency: .now,
        needsOwner: true,
        title: "Restart ingress in edge?",
        actions: [.approve, .deny],
        createdAt: Date(timeIntervalSince1970: 1_800_000_000)
    )

    private func store(
        api: FakeItemAPI,
        authenticator: FakeAuthenticator = FakeAuthenticator(allows: true),
        requiresAuthentication: Bool = false,
        notificationCenter: FakeNotificationCenter = FakeNotificationCenter()
    ) -> CowtailStore {
        CowtailStore(
            api: api,
            sessionToken: { "session-token" },
            authenticator: authenticator,
            requiresApprovalAuthentication: { requiresAuthentication },
            notificationCenter: notificationCenter
        )
    }

    private let upgrade = MaintenanceWindow(
        id: "window-upgrade",
        title: "Cluster upgrade",
        startsAt: Date(timeIntervalSince1970: 1_800_000_000),
        endsAt: Date(timeIntervalSince1970: 1_800_003_600),
        matchers: [],
        sources: ["alertmanager"],
        allAlerts: true,
        heldSources: [],
        active: true
    )

    private var storageOutage: IncidentDetail {
        let summary = IncidentSummary(
            id: "incident-1",
            title: "Storage outage",
            state: .open,
            memberCount: 1,
            worstUrgency: .now,
            startedAt: Date(timeIntervalSince1970: 1_800_000_000),
            resolvedAt: nil,
            duration: 600
        )
        var member = approval
        member.incident = summary
        return IncidentDetail(
            incident: Incident(
                summary: summary,
                postmortemState: .none,
                postmortem: nil,
                postmortemAt: nil,
                availableActions: [.resolve]
            ),
            members: [member],
            events: []
        )
    }

    func testAnInboxLoadSetsTheServersBadgeAndKeepsOnlyLiveItemsNotifications() async {
        var inbox = ItemInbox(needsYou: [approval], withHermes: [])
        inbox.badge = 1
        // The open `today` fyi does not need the owner, and is still live.
        inbox.liveItemIDs = ["approval-1", "fyi-today"]
        let center = FakeNotificationCenter(delivered: [
            DeliveredItemNotification(identifier: "approval", itemIDs: ["approval-1"]),
            DeliveredItemNotification(identifier: "fyi", itemIDs: ["fyi-today"]),
            DeliveredItemNotification(identifier: "acked", itemIDs: ["acked-1"]),
            DeliveredItemNotification(identifier: "roundup", itemIDs: []),
        ])

        await store(api: FakeItemAPI(inbox: inbox), notificationCenter: center).refresh()

        let badge = await center.badge
        let remaining = await center.delivered.map(\.identifier)
        XCTAssertEqual(badge, 1)
        XCTAssertEqual(remaining, ["approval", "fyi", "roundup"])
    }
    func testRemovingAMemberShowsAtOnceAndARefusalPutsItBack() async {
        let api = FakeItemAPI(inbox: .empty)
        await api.seedIncident(storageOutage)
        await api.holdIncidentChange()
        let store = store(api: api)
        await store.loadIncident(id: "incident-1")

        let removing = Task { await store.change(.remove(itemID: approval.id), incidentID: "incident-1") }
        await api.waitUntilIncidentChangeHeld()
        XCTAssertEqual(store.incidents["incident-1"]?.members, [])
        // The removal shows its result, so Add an item stays as it was.
        XCTAssertFalse(store.isAddingItem(to: "incident-1"))
        // A poll while the change is on its way keeps it shown.
        await store.loadIncident(id: "incident-1")
        XCTAssertEqual(store.incidents["incident-1"]?.members, [])

        await api.releaseIncidentChange(with: CowtailAPIError.refused("Item is not in this incident"))
        await removing.value
        XCTAssertEqual(store.incidents["incident-1"], storageOutage)
        XCTAssertEqual(store.incidentErrors["incident-1"], "Item is not in this incident")
    }

    func testASecondChangeWaitsForTheFirstAndBothShowAtOnce() async {
        var outage = storageOutage
        var second = Item(id: "approval-2", source: "hermes", kind: .approval, urgency: .now, title: "Second", createdAt: approval.createdAt)
        second.incident = outage.incident.summary
        outage.members.append(second)
        outage.incident.summary.memberCount = 2
        let api = FakeItemAPI(inbox: .empty)
        await api.seedIncident(outage)
        await api.holdIncidentChange()
        let store = store(api: api)
        await store.loadIncident(id: "incident-1")

        let first = Task { await store.change(.remove(itemID: approval.id), incidentID: "incident-1") }
        await api.waitUntilIncidentChangeHeld()
        let next = Task { await store.change(.remove(itemID: "approval-2"), incidentID: "incident-1") }
        await Task.yield()
        XCTAssertEqual(store.incidents["incident-1"]?.members, [])
        // A poll while both are on their way keeps both shown.
        await store.loadIncident(id: "incident-1")
        XCTAssertEqual(store.incidents["incident-1"]?.members, [])

        await api.releaseIncidentChange(with: nil)
        await first.value
        await next.value
        let sent = await api.sentIncidentChanges
        XCTAssertEqual(sent, [.remove(itemID: approval.id), .remove(itemID: "approval-2")])
        XCTAssertEqual(store.incidents["incident-1"]?.members, [])
    }

    func testALostReplyKeepsTheChangeShownUntilAReadSaysWhich() async {
        let api = FakeItemAPI(inbox: .empty)
        await api.seedIncident(storageOutage)
        await api.holdIncidentChange()
        let store = store(api: api)
        await store.loadIncident(id: "incident-1")

        let removing = Task { await store.change(.remove(itemID: approval.id), incidentID: "incident-1") }
        await api.waitUntilIncidentChangeHeld()
        await api.failIncidentReads(true)
        await api.releaseIncidentChange(with: URLError(.networkConnectionLost))
        await removing.value
        // The removal may have landed, and no read has said otherwise.
        XCTAssertEqual(store.incidents["incident-1"]?.members, [])

        await api.failIncidentReads(false)
        await store.loadIncident(id: "incident-1")
        // The server kept the member: the removal never landed.
        XCTAssertEqual(store.incidents["incident-1"], storageOutage)
    }

    func testAReadFromBeforeAWriteSettledIsDiscarded() async {
        let api = FakeItemAPI(inbox: .empty)
        await api.seedIncident(storageOutage)
        let store = store(api: api)
        await store.loadIncident(id: "incident-1")

        await api.holdIncidentRead()
        let poll = Task { await store.loadIncident(id: "incident-1") }
        await api.waitUntilIncidentReadHeld()
        await store.change(.remove(itemID: approval.id), incidentID: "incident-1")
        await api.releaseIncidentRead()
        await poll.value

        // The poll read the incident before the removal; it cannot bring the member back.
        XCTAssertEqual(store.incidents["incident-1"]?.members, [])
    }

    func testAnAddWaitingOnTheServerShowsAddAnItemBusy() async {
        let api = FakeItemAPI(inbox: .empty)
        await api.seedIncident(storageOutage)
        await api.holdIncidentChange()
        let store = store(api: api)
        await store.loadIncident(id: "incident-1")

        let adding = Task { await store.change(.add(itemID: "item-2"), incidentID: "incident-1") }
        await api.waitUntilIncidentChangeHeld()
        XCTAssertTrue(store.isAddingItem(to: "incident-1"))

        await api.releaseIncidentChange(with: nil)
        await adding.value
        XCTAssertFalse(store.isAddingItem(to: "incident-1"))
    }

    func testResolvingShowsTheServersIncidentOnceItAnswers() async {
        let api = FakeItemAPI(inbox: .empty)
        await api.seedIncident(storageOutage)
        let store = store(api: api)
        await store.loadIncident(id: "incident-1")

        await store.change(.resolve, incidentID: "incident-1")

        XCTAssertEqual(store.incidents["incident-1"]?.incident.summary.state, .resolved)
        XCTAssertEqual(store.incidents["incident-1"]?.incident.availableActions, [])
        XCTAssertNil(store.incidentErrors["incident-1"])
    }

    func testEndingAWindowTakesItsBannerAwayBeforeTheServerAnswersAndThroughAPoll() async {
        let api = FakeItemAPI(inbox: .empty)
        await api.runWindows([upgrade])
        await api.holdEnd()
        let store = store(api: api)
        await store.refresh()
        XCTAssertEqual(store.maintenanceWindows, [upgrade])

        let ending = Task { await store.endMaintenance(upgrade) }
        await api.waitUntilEndHeld()
        XCTAssertEqual(store.maintenanceWindows, [])
        // The server still lists the window until it answers; the poll keeps it gone.
        await store.refresh()
        XCTAssertEqual(store.maintenanceWindows, [])

        await api.releaseEnd()
        await ending.value
        XCTAssertEqual(store.maintenanceWindows, [])
        XCTAssertNil(store.maintenanceError)
    }

    func testAWindowTheServerRefusesToEndComesBackWithTheReason() async {
        let api = FakeItemAPI(inbox: .empty)
        await api.runWindows([upgrade], refusingEndWith: "Maintenance window not found")
        let store = store(api: api)
        await store.refresh()

        await store.endMaintenance(upgrade)

        XCTAssertEqual(store.maintenanceWindows, [upgrade])
        XCTAssertEqual(store.maintenanceError, "Maintenance window not found")
    }

    func testApproveWaitsForLocalAuthenticationWhenTheOwnerRequiresIt() async {
        for allows in [false, true] {
            let api = FakeItemAPI(inbox: ItemInbox(needsYou: [approval], withHermes: []))
            let authenticator = FakeAuthenticator(allows: allows)
            let store = store(api: api, authenticator: authenticator, requiresAuthentication: true)
            await store.refresh()

            await store.perform(.approve, on: approval)

            let sent = await api.sentActions
            let asked = await authenticator.requests
            let sentAuthentication = await api.sentAuthentication
            XCTAssertEqual(asked, 1, "allows=\(allows)")
            XCTAssertEqual(sentAuthentication, allows ? [true] : [], "allows=\(allows)")
            XCTAssertEqual(sent.map(\.request), allows ? [.approve] : [], "allows=\(allows)")
            XCTAssertEqual(store.inbox?.needsYou.map(\.id), allows ? [] : [approval.id], "allows=\(allows)")
            XCTAssertEqual(store.actionErrors[approval.id] != nil, !allows, "allows=\(allows)")
        }
    }

    func testApproveSkipsLocalAuthenticationWhenTheOwnerDoesNotRequireIt() async {
        let api = FakeItemAPI(inbox: ItemInbox(needsYou: [approval], withHermes: []))
        let authenticator = FakeAuthenticator(allows: false)
        let store = store(api: api, authenticator: authenticator)
        await store.refresh()

        await store.perform(.approve, on: approval)

        let sent = await api.sentActions
        let asked = await authenticator.requests
        let sentAuthentication = await api.sentAuthentication
        XCTAssertEqual(asked, 0)
        XCTAssertEqual(sent.map(\.request), [.approve])
        // The server hears that no Face ID was asked, and refuses it if the owner now needs one.
        XCTAssertEqual(sentAuthentication, [false])
    }

    func testApproveAsksForFaceIDWhenTheServerSaysTheItemNeedsIt() async {
        let guarded = Item(
            id: approval.id,
            source: "hermes",
            kind: .approval,
            urgency: .now,
            needsOwner: true,
            title: approval.title,
            actions: [.approve, .deny],
            approvalNeedsAuth: true,
            createdAt: approval.createdAt
        )
        let api = FakeItemAPI(inbox: ItemInbox(needsYou: [guarded], withHermes: []))
        let authenticator = FakeAuthenticator(allows: true)
        let store = store(api: api, authenticator: authenticator)
        await store.refresh()

        await store.perform(.approve, on: guarded)

        let asked = await authenticator.requests
        let sentAuthentication = await api.sentAuthentication
        XCTAssertEqual(asked, 1)
        XCTAssertEqual(sentAuthentication, [true])
    }

    private let restartGateway = RunbookScript(
        id: "gateway-restart",
        name: "Restart Hermes gateway",
        confirmText: "Restart the Hermes gateway?"
    )

    func testAScriptThatAsksToConfirmWaitsForFaceIDWhileTheOwnerRequiresIt() async {
        for allows in [false, true] {
            let api = FakeItemAPI(inbox: ItemInbox(needsYou: [], withHermes: []))
            let authenticator = FakeAuthenticator(allows: allows)
            let store = store(api: api, authenticator: authenticator, requiresAuthentication: true)

            await store.startRun(restartGateway, itemID: "item-1")

            let started = await api.startedRuns
            let asked = await authenticator.requests
            XCTAssertEqual(asked, 1, "allows=\(allows)")
            XCTAssertEqual(started.map(\.scriptID), allows ? ["gateway-restart"] : [], "allows=\(allows)")
            XCTAssertEqual(started.map(\.itemID), allows ? ["item-1"] : [], "allows=\(allows)")
            XCTAssertEqual(started.map(\.confirmed), allows ? [true] : [], "allows=\(allows)")
            XCTAssertEqual(started.map(\.authenticated), allows ? [true] : [], "allows=\(allows)")
            XCTAssertEqual(store.actionErrors["item-1"] != nil, !allows, "allows=\(allows)")
            XCTAssertEqual(store.selectedRunID, allows ? "run-1" : nil, "allows=\(allows)")
        }
    }

    func testAScriptAsksForFaceIDWhenTheServerSaysItNeedsIt() async {
        let api = FakeItemAPI(inbox: ItemInbox(needsYou: [], withHermes: []))
        let authenticator = FakeAuthenticator(allows: true)
        let store = store(api: api, authenticator: authenticator)
        var guarded = restartGateway
        guarded.needsAuth = true

        await store.startRun(guarded)

        let asked = await authenticator.requests
        let started = await api.startedRuns
        XCTAssertEqual(asked, 1)
        XCTAssertEqual(started.map(\.authenticated), [true])
    }

    func testAScriptThatRunsOnATapNeverAsksForFaceID() async {
        let api = FakeItemAPI(inbox: ItemInbox(needsYou: [], withHermes: []))
        let authenticator = FakeAuthenticator(allows: false)
        let store = store(api: api, authenticator: authenticator, requiresAuthentication: true)

        await store.startRun(RunbookScript(id: "disk-usage", name: "Disk usage"))

        let asked = await authenticator.requests
        let started = await api.startedRuns
        XCTAssertEqual(asked, 0)
        XCTAssertEqual(started.map(\.confirmed), [false])
        XCTAssertEqual(started.map(\.authenticated), [nil])
    }

    func testARunWhoseReplyWasLostIsSentAgainUnderTheSameRequest() async {
        let api = FakeItemAPI(inbox: ItemInbox(needsYou: [], withHermes: []))
        let store = store(api: api)
        let script = RunbookScript(id: "disk-usage", name: "Disk usage")
        await api.loseNextRunReply()

        await store.startRun(script)
        await store.startRun(script)
        await store.startRun(script)

        let requests = await api.startedRuns.map(\.requestID)
        XCTAssertEqual(requests.count, 3)
        XCTAssertEqual(requests[1], requests[0], "the retry reconciles the lost request")
        XCTAssertNotEqual(requests[2], requests[1], "an answered request is done; the next tap is new")
    }

    func testARefusedActionRollsTheInboxBackAndShowsTheServersError() async {
        let api = FakeItemAPI(
            inbox: ItemInbox(needsYou: [approval], withHermes: []),
            actionError: CowtailAPIError.refused("The item is closed")
        )
        let store = store(api: api)
        await store.refresh()

        await store.perform(.deny, on: approval)

        XCTAssertEqual(store.inbox?.needsYou.map(\.id), [approval.id])
        XCTAssertEqual(store.inbox?.withHermes, [])
        XCTAssertEqual(store.actionErrors[approval.id], "The item is closed")
        XCTAssertEqual(store.actionFeedback?.succeeded, false)
    }

    func testAnActionTheServerAcceptsEndsInSuccessFeedback() async {
        let api = FakeItemAPI(inbox: ItemInbox(needsYou: [approval], withHermes: []))
        let store = store(api: api)
        await store.refresh()

        await store.perform(.approve, on: approval)

        XCTAssertEqual(store.actionFeedback?.succeeded, true)
    }

    func testALateRefusalPutsBackOnlyItsOwnItem() async {
        let question = Item(
            id: "question-1",
            source: "hermes",
            kind: .question,
            urgency: .now,
            needsOwner: true,
            title: "Rebalance now?",
            actions: [.reply],
            createdAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
        let api = FakeItemAPI(inbox: ItemInbox(needsYou: [approval, question], withHermes: []))
        let store = store(api: api)
        await store.refresh()
        await api.hold(itemID: approval.id)

        let denial = Task { await store.perform(.deny, on: approval) }
        await api.waitUntilHeld()
        await store.perform(.reply("Wait"), on: question)
        await api.releaseHeld(with: CowtailAPIError.refused("The item is closed"))
        await denial.value

        XCTAssertEqual(store.inbox?.needsYou.map(\.id), [approval.id])
        XCTAssertEqual(store.inbox?.withHermes.map(\.id), [question.id])
        XCTAssertEqual(store.inbox?.counts, ItemInbox.Counts(needsYou: 1, withHermes: 1, upcoming: 0))
        XCTAssertEqual(store.actionErrors[approval.id], "The item is closed")
    }

    func testASecondTapWhileTheFirstIsOnItsWaySendsNothing() async {
        let api = FakeItemAPI(inbox: ItemInbox(needsYou: [approval], withHermes: []))
        let store = store(api: api)
        await store.refresh()
        await api.hold(itemID: approval.id)

        let first = Task { await store.perform(.approve, on: approval) }
        await api.waitUntilHeld()
        await store.perform(.deny, on: approval)
        await api.releaseHeld(with: CowtailAPIError.refused("The item is closed"))
        await first.value

        let attempts = await api.actionAttempts
        XCTAssertEqual(attempts, 1)
    }

    func testAnUnconfirmedWriteStaysShownAndTakesNoSecondAnswerUntilTheServerAnswers() async {
        let api = FakeItemAPI(
            inbox: ItemInbox(needsYou: [approval], withHermes: []),
            actionError: URLError(.timedOut)
        )
        let store = store(api: api)
        await store.refresh()
        await api.failInbox(with: URLError(.notConnectedToInternet))

        await store.perform(.approve, on: approval)
        await store.perform(.approve, on: approval)

        let attempts = await api.actionAttempts
        XCTAssertEqual(store.inbox?.needsYou.map(\.id), [])
        XCTAssertEqual(attempts, 1)
    }

    // MARK: Snooze and unsnooze

    private static let start = Date(timeIntervalSince1970: 1_800_000_000)

    private func snoozed(_ id: String, hours: Double, needsOwnerWhenOpen: Bool = false) -> Item {
        Item(
            id: id,
            source: "alertmanager",
            kind: .alert,
            urgency: .today,
            state: .snoozed,
            title: id,
            availableActions: [.unsnooze],
            snoozedUntil: Self.start.addingTimeInterval(hours * 3_600),
            needsOwnerWhenOpen: needsOwnerWhenOpen,
            createdAt: Self.start
        )
    }

    private func snoozeInbox(_ soon: Item? = nil) -> ItemInbox {
        ItemInbox(
            needsYou: [approval],
            withHermes: [],
            upcoming: [soon ?? snoozed("soon", hours: 1), snoozed("later", hours: 72)]
        )
    }

    func testSnoozeShowsTheItemInUpcomingAtItsReturnTimeAtOnce() async {
        let api = FakeItemAPI(inbox: snoozeInbox())
        let store = store(api: api)
        await store.refresh()
        await api.hold(itemID: approval.id)

        let snooze = Task { await store.perform(.snooze(until: Self.start.addingTimeInterval(4 * 3_600)), on: approval) }
        await api.waitUntilHeld()

        XCTAssertEqual(store.inbox?.upcoming.map(\.id), ["soon", approval.id, "later"])
        XCTAssertEqual(store.inbox?.item(withID: approval.id)?.availableActions.last, .unsnooze)
        XCTAssertEqual(store.inbox?.needsYou, [])
        XCTAssertEqual(store.inbox?.counts, ItemInbox.Counts(needsYou: 0, withHermes: 0, upcoming: 3))
        await api.releaseHeld(with: CowtailAPIError.refused("done"))
        await snooze.value
    }

    func testARefusedSnoozeTakesTheItemOutOfUpcoming() async {
        let api = FakeItemAPI(inbox: snoozeInbox(), actionError: CowtailAPIError.refused("The item is closed"))
        let store = store(api: api)
        await store.refresh()

        await store.perform(.snooze(until: Self.start.addingTimeInterval(4 * 3_600)), on: approval)

        XCTAssertEqual(store.inbox?.upcoming.map(\.id), ["soon", "later"])
        XCTAssertEqual(store.inbox?.needsYou.map(\.id), [approval.id])
        XCTAssertEqual(store.inbox?.counts, ItemInbox.Counts(needsYou: 1, withHermes: 0, upcoming: 2))
        XCTAssertEqual(store.actionErrors[approval.id], "The item is closed")
    }

    func testUnsnoozeShowsTheItemAtOnceInTheSectionTheServerNamed() async {
        for needsOwner in [true, false] {
            let soon = snoozed("soon", hours: 1, needsOwnerWhenOpen: needsOwner)
            let api = FakeItemAPI(inbox: snoozeInbox(soon))
            let store = store(api: api)
            await store.refresh()
            await api.hold(itemID: soon.id)

            let unsnooze = Task { await store.perform(.unsnooze, on: soon) }
            await api.waitUntilHeld()

            let inbox = store.inbox
            XCTAssertEqual(inbox?.upcoming.map(\.id), ["later"], "needsOwner=\(needsOwner)")
            XCTAssertEqual(inbox?.needsYou.map(\.id), needsOwner ? [soon.id, approval.id] : [approval.id], "needsOwner=\(needsOwner)")
            XCTAssertEqual(inbox?.withHermes.map(\.id), needsOwner ? [] : [soon.id], "needsOwner=\(needsOwner)")
            XCTAssertEqual(
                inbox?.counts,
                ItemInbox.Counts(needsYou: needsOwner ? 2 : 1, withHermes: needsOwner ? 0 : 1, upcoming: 1),
                "needsOwner=\(needsOwner)"
            )
            let shown = inbox?.item(withID: soon.id)
            XCTAssertEqual(shown?.state, .open, "needsOwner=\(needsOwner)")
            XCTAssertNil(shown?.snoozedUntil, "needsOwner=\(needsOwner)")
            XCTAssertEqual(shown?.availableActions, [], "needsOwner=\(needsOwner)")
            await api.releaseHeld(with: CowtailAPIError.refused("done"))
            await unsnooze.value
        }
    }

    func testARefreshWhileTheUnsnoozeIsOnItsWayKeepsTheItemWhereItMoved() async {
        let soon = snoozed("soon", hours: 1, needsOwnerWhenOpen: true)
        let api = FakeItemAPI(inbox: snoozeInbox(soon))
        let store = store(api: api)
        await store.refresh()
        await api.hold(itemID: soon.id)

        let unsnooze = Task { await store.perform(.unsnooze, on: soon) }
        await api.waitUntilHeld()
        await store.refresh()

        XCTAssertEqual(store.inbox?.needsYou.map(\.id), [soon.id, approval.id])
        XCTAssertEqual(store.inbox?.upcoming.map(\.id), ["later"])
        await api.releaseHeld(with: CowtailAPIError.refused("done"))
        await unsnooze.value
    }

    func testAPendingSnoozeOverTheServersResultOfItChangesNothing() {
        let until = Self.start.addingTimeInterval(3_600)
        let snoozedRead = snoozeInbox(snoozed("soon", hours: 1, needsOwnerWhenOpen: true))
        let reopened = Item(id: "soon", source: "hermes", kind: .approval, urgency: .now, needsOwner: true, title: "soon", createdAt: Self.start)
        let reopenedRead = ItemInbox(needsYou: [reopened], withHermes: [])

        XCTAssertEqual(snoozedRead.showingPending(.snooze(until: until), on: "soon"), snoozedRead)
        XCTAssertEqual(reopenedRead.showingPending(.unsnooze, on: "soon"), reopenedRead)
    }

    func testARefusedUnsnoozePutsTheItemBackInItsPlace() async {
        let soon = snoozed("soon", hours: 1, needsOwnerWhenOpen: true)
        let api = FakeItemAPI(inbox: snoozeInbox(soon), actionError: CowtailAPIError.refused("The item is not snoozed"))
        let store = store(api: api)
        await store.refresh()

        await store.perform(.unsnooze, on: soon)

        XCTAssertEqual(store.inbox?.upcoming.map(\.id), ["soon", "later"])
        XCTAssertEqual(store.inbox?.needsYou.map(\.id), [approval.id])
        XCTAssertEqual(store.inbox?.counts, ItemInbox.Counts(needsYou: 1, withHermes: 0, upcoming: 2))
        XCTAssertEqual(store.actionErrors[soon.id], "The item is not snoozed")
    }

    func testHistoryReadsPastPagesTheFiltersEmptied() async {
        let older = Item(
            id: "older",
            source: "cron",
            kind: .approval,
            urgency: .today,
            title: "Older match",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            createdDate: "2023-11-14"
        )
        let api = FakeItemAPI(
            inbox: .empty,
            pagesByCursor: [
                "": ItemPage(items: [], nextCursor: "page-2"),
                "page-2": ItemPage(items: [older], nextCursor: nil, days: [.init(date: "2023-11-14", count: 1)]),
            ]
        )
        let store = store(api: api)

        await store.loadHistory(HistoryFilter(kind: .approval))

        XCTAssertEqual(store.historyItems.map(\.id), ["older"])
    }

    private let failed = Item(
        id: "failed",
        source: "cron",
        kind: .failure,
        urgency: .today,
        title: "Backup failed",
        actions: [.ack, .snooze],
        createdAt: Date(timeIntervalSince1970: 1_800_000_000),
        createdDate: "2027-01-15"
    )

    func testAnActionShowsOnItsHistoryRowAtOnceAndARefusalPutsTheRowBack() async {
        let api = FakeItemAPI(inbox: .empty, pagesByCursor: ["": ItemPage(items: [failed], nextCursor: nil)])
        let store = store(api: api)
        await store.loadHistory(HistoryFilter())
        await api.hold(itemID: failed.id)

        let ack = Task { await store.perform(.ack, on: failed) }
        await api.waitUntilHeld()
        XCTAssertEqual(store.historyItems.first?.state, .acked)
        XCTAssertEqual(store.historyItems.first?.availableActions, [.snooze])
        // A poll while the action is on its way keeps it shown.
        await store.loadHistory(HistoryFilter())
        XCTAssertEqual(store.historyItems.first?.state, .acked)
        await api.releaseHeld(with: CowtailAPIError.refused("The item is closed"))
        await ack.value

        XCTAssertEqual(store.historyItems.first?.state, .open)
        XCTAssertEqual(store.historyItems.first?.availableActions, [.ack, .snooze])
    }

    func testAnActionWhoseReplyWasLostRereadsItsHistoryRow() async {
        let api = FakeItemAPI(
            inbox: .empty,
            actionError: URLError(.timedOut),
            pagesByCursor: ["": ItemPage(items: [failed], nextCursor: nil)]
        )
        let store = store(api: api)
        await store.loadHistory(HistoryFilter())

        await store.perform(.ack, on: failed)

        // The write never landed: History's read shows the item still open.
        XCTAssertEqual(store.historyItems.first?.state, .open)
        XCTAssertEqual(store.historyItems.first?.availableActions, [.ack, .snooze])
    }

    func testAnActionShowsOnItsIncidentMemberAtOnceAndARefusalPutsItBack() async {
        let api = FakeItemAPI(inbox: .empty)
        await api.seedIncident(storageOutage)
        let store = store(api: api)
        await store.loadIncident(id: "incident-1")
        let member = storageOutage.members[0]
        await api.hold(itemID: member.id)

        let snoozing = Task { await store.perform(.snooze(until: Date(timeIntervalSince1970: 1_800_003_600)), on: member) }
        await api.waitUntilHeld()
        XCTAssertEqual(store.incidents["incident-1"]?.members.first?.state, .snoozed)
        // A poll while the action is on its way keeps it shown.
        await store.loadIncident(id: "incident-1")
        XCTAssertEqual(store.incidents["incident-1"]?.members.first?.state, .snoozed)
        await api.releaseHeld(with: CowtailAPIError.refused("The item is closed"))
        await snoozing.value

        XCTAssertEqual(store.incidents["incident-1"], storageOutage)
    }

    func testAnIncidentReadFromBeforeAMemberActionSettledIsDiscarded() async {
        let member = storageOutage.members[0]
        let api = FakeItemAPI(inbox: ItemInbox(needsYou: [member], withHermes: []))
        await api.seedIncident(storageOutage)
        let store = store(api: api)
        await store.loadIncident(id: "incident-1")

        await api.holdIncidentRead()
        let poll = Task { await store.loadIncident(id: "incident-1") }
        await api.waitUntilIncidentReadHeld()
        await store.perform(.approve, on: member)
        await api.releaseIncidentRead()
        await poll.value

        // The poll read the member before the approval; it cannot bring the question back.
        XCTAssertEqual(store.incidents["incident-1"]?.members.first?.needsOwner, false)
    }

    func testHistoryOpensOnTheLast24Hours() {
        XCTAssertEqual(HistoryFilter().query().range, .day)
    }

    func testAHistoryContinuationKeepsTheFirstPagesDateBounds() async {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let item = { (id: String) in
            Item(id: id, source: "cron", kind: .fyi, urgency: .today, title: id, createdAt: .now, createdDate: "2026-11-24")
        }
        let api = FakeItemAPI(
            inbox: .empty,
            pagesByCursor: [
                "": ItemPage(items: [item("first")], nextCursor: "page-2", from: start),
                "page-2": ItemPage(items: [item("second")], nextCursor: nil, from: start),
            ]
        )
        let store = store(api: api)
        await store.loadHistory(HistoryFilter(range: .day))

        await store.loadMoreHistory()

        // The first page asks for the range; the next carries the start the server resolved.
        let queries = await api.listQueries
        XCTAssertEqual(store.historyItems.map(\.id), ["first", "second"])
        XCTAssertEqual(queries.map(\.cursor), [nil, "page-2"])
        XCTAssertEqual(queries.map(\.range), [.day, nil])
        XCTAssertEqual(queries.map(\.from), [nil, start])
    }

    func testRefreshingHistoryKeepsAsManyItemsAsAreShown() async {
        let shown = (0..<120).map {
            Item(id: "item-\($0)", source: "cron", kind: .fyi, urgency: .today, title: "\($0)", createdAt: .now)
        }
        let api = FakeItemAPI(inbox: .empty, pagesByCursor: ["": ItemPage(items: shown, nextCursor: nil)])
        let store = store(api: api)
        await store.loadHistory(HistoryFilter())

        await store.loadHistory(HistoryFilter())

        let limits = await api.listQueries.map(\.limit)
        XCTAssertEqual(limits, [100, 120])
        XCTAssertEqual(store.historyItems.count, 120)
    }

    func testTwoLoadMoreTriggersReadTheNextPageOnce() async {
        let item = { (id: String) in
            Item(id: id, source: "cron", kind: .fyi, urgency: .today, title: id, createdAt: .now, createdDate: "2026-11-24")
        }
        let api = FakeItemAPI(
            inbox: .empty,
            pagesByCursor: [
                "": ItemPage(items: [item("first")], nextCursor: "page-2"),
                "page-2": ItemPage(items: [item("second")], nextCursor: nil),
            ]
        )
        // A session refresh suspends, as a real one does, so both triggers start before either reads.
        let store = CowtailStore(
            api: api,
            sessionToken: {
                await Task.yield()
                return "session-token"
            },
            authenticator: FakeAuthenticator(allows: true),
            requiresApprovalAuthentication: { false },
            notificationCenter: FakeNotificationCenter()
        )
        await store.loadHistory(HistoryFilter())

        async let one: Void = store.loadMoreHistory()
        async let two: Void = store.loadMoreHistory()
        _ = await (one, two)

        let cursors = await api.listQueries.map(\.cursor)
        XCTAssertEqual(cursors, [nil, "page-2"])
        XCTAssertEqual(store.historyItems.map(\.id), ["first", "second"])
    }

    func testRefreshRetriesHealthAfterTransientFailure() async {
        let api = FakeItemAPI(inbox: .empty, failingHealthRequests: 1)
        let store = store(api: api)

        await store.refresh()

        let healthRequests = await api.healthRequests
        XCTAssertEqual(store.health, CowtailPreviewFixtures.health)
        XCTAssertNil(store.healthErrorMessage)
        XCTAssertEqual(healthRequests, 2)
    }
}

private actor FakeAuthenticator: ApprovalAuthenticating {
    let allows: Bool
    private(set) var requests = 0

    init(allows: Bool) {
        self.allows = allows
    }

    func authenticate(reason _: String) async -> Bool {
        requests += 1
        return allows
    }
}

/// Answers like the server: the inbox it holds, the owner's actions applied to it, and list
/// pages keyed by the cursor that asks for them.
private actor FakeItemAPI: CowtailAPIClient {
    private var inbox: ItemInbox
    private var inboxError: Error?
    private let actionError: Error?
    private var failingHealthRequests: Int
    private let pagesByCursor: [String: ItemPage]
    private(set) var sentActions: [(itemID: String, request: ItemActionRequest)] = []
    private(set) var actionAttempts = 0
    private(set) var listQueries: [ItemListQuery] = []
    private(set) var sentAuthentication: [Bool?] = []
    private(set) var healthRequests = 0

    /// `pagesByCursor[""]` is the first page.
    init(
        inbox: ItemInbox,
        actionError: Error? = nil,
        failingHealthRequests: Int = 0,
        pagesByCursor: [String: ItemPage] = [:]
    ) {
        self.inbox = inbox
        self.actionError = actionError
        self.failingHealthRequests = failingHealthRequests
        self.pagesByCursor = pagesByCursor
    }

    func failInbox(with error: Error) {
        inboxError = error
    }

    private var heldItemID: String?
    private var heldRequest: CheckedContinuation<Error, Never>?
    private var heldWaiters: [CheckedContinuation<Void, Never>] = []

    /// The next action on this item waits at the server until `releaseHeld`.
    func hold(itemID: String) {
        heldItemID = itemID
    }

    func waitUntilHeld() async {
        if heldRequest != nil {
            return
        }
        await withCheckedContinuation { heldWaiters.append($0) }
    }

    func releaseHeld(with error: Error) {
        heldRequest?.resume(returning: error)
        heldRequest = nil
    }

    func fetchHealthSummary() async throws -> HealthSummary {
        healthRequests += 1
        if failingHealthRequests > 0 {
            failingHealthRequests -= 1
            throw URLError(.networkConnectionLost)
        }
        return CowtailPreviewFixtures.health
    }

    func fetchInbox(sessionToken _: String) async throws -> ItemInbox {
        if let inboxError {
            throw inboxError
        }
        // Totals follow the lists, as the server counts them.
        var read = ItemInbox(needsYou: inbox.needsYou, withHermes: inbox.withHermes, upcoming: inbox.upcoming)
        read.badge = inbox.badge
        read.liveItemIDs = inbox.liveItemIDs
        return read
    }

    func fetchItems(_ query: ItemListQuery, sessionToken _: String) async throws -> ItemPage {
        listQueries.append(query)
        guard let page = pagesByCursor[query.cursor ?? ""] else {
            throw CowtailAPIError.refused("Invalid cursor")
        }
        return page
    }

    func fetchItem(id _: String, sessionToken _: String) async throws -> ItemDetail? {
        nil
    }

    func fetchItemGraph(itemID _: String, range _: ItemGraphRange, sessionToken _: String) async throws -> ItemGraph? {
        nil
    }

    func fetchItemStats(_: ItemListQuery, sessionToken _: String) async throws -> ItemStats {
        CowtailPreviewFixtures.stats
    }

    func fetchHermesStatus(sessionToken _: String) async throws -> HermesStatus {
        CowtailPreviewFixtures.hermes
    }

    func performItemAction(
        itemID: String,
        request: ItemActionRequest,
        authenticated: Bool?,
        sessionToken _: String
    ) async throws -> Item {
        sentAuthentication.append(authenticated)
        actionAttempts += 1
        if itemID == heldItemID {
            heldItemID = nil
            let error = await withCheckedContinuation { continuation in
                heldRequest = continuation
                heldWaiters.forEach { $0.resume() }
                heldWaiters.removeAll()
            }
            throw error
        }
        if let actionError {
            throw actionError
        }
        sentActions.append((itemID, request))
        guard var item = inbox.item(withID: itemID) else { throw CowtailAPIError.refused("Item not found") }
        item.needsOwner = false
        inbox.needsYou.removeAll { $0.id == itemID }
        inbox.withHermes.insert(item, at: 0)
        return item
    }

    func performAlertAction(
        alertID _: String,
        action _: AlertHumanAction,
        note _: String?,
        sessionToken _: String
    ) async throws {}

    func fetchItemSources(sessionToken _: String) async throws -> [String] {
        []
    }

    func fetchDevices(sessionToken _: String) async throws -> [UserDevice] {
        []
    }

    func fetchSnoozeOptions(timeZone _: String, sessionToken _: String) async throws -> [SnoozeOption] {
        []
    }

    // MARK: Maintenance windows

    private var windows: [MaintenanceWindow] = []
    private var endRefusal: String?
    private var holdsEnd = false
    private var heldEnd: CheckedContinuation<Void, Never>?
    private var heldEndWaiters: [CheckedContinuation<Void, Never>] = []

    func runWindows(_ running: [MaintenanceWindow], refusingEndWith refusal: String? = nil) {
        windows = running
        endRefusal = refusal
    }

    /// The next end waits at the server until `releaseEnd`.
    func holdEnd() {
        holdsEnd = true
    }

    func waitUntilEndHeld() async {
        if heldEnd != nil {
            return
        }
        await withCheckedContinuation { heldEndWaiters.append($0) }
    }

    func releaseEnd() {
        heldEnd?.resume()
        heldEnd = nil
    }

    func fetchMaintenanceWindows(sessionToken _: String) async throws -> MaintenanceWindows {
        MaintenanceWindows(active: windows, sourceChoices: [])
    }

    func startMaintenanceWindow(_ request: MaintenanceWindowRequest, sessionToken _: String) async throws -> MaintenanceWindow {
        let window = MaintenanceWindow(
            id: "window-\(windows.count + 1)",
            title: request.title,
            startsAt: Date(timeIntervalSince1970: 1_800_000_000),
            endsAt: Date(timeIntervalSince1970: 1_800_000_000 + request.duration),
            matchers: request.matchers,
            sources: request.sources,
            allAlerts: request.sources.contains("alertmanager"),
            heldSources: request.sources.filter { $0 != "alertmanager" },
            active: true
        )
        windows.append(window)
        return window
    }

    func endMaintenanceWindow(id: String, sessionToken _: String) async throws -> MaintenanceWindow {
        if holdsEnd {
            holdsEnd = false
            await withCheckedContinuation { continuation in
                heldEnd = continuation
                heldEndWaiters.forEach { $0.resume() }
                heldEndWaiters.removeAll()
            }
        }
        if let endRefusal {
            throw CowtailAPIError.refused(endRefusal)
        }
        guard let index = windows.firstIndex(where: { $0.id == id }) else {
            throw CowtailAPIError.refused("Maintenance window not found")
        }
        var ended = windows.remove(at: index)
        ended.active = false
        return ended
    }

    struct StartedRun {
        let requestID: String
        let scriptID: String
        let itemID: String?
        let confirmed: Bool
        let authenticated: Bool?
    }

    private(set) var startedRuns: [StartedRun] = []

    /// The next run request reaches the server, but its reply is lost.
    private var losesNextRunReply = false

    func loseNextRunReply() {
        losesNextRunReply = true
    }

    func startRunbookRun(
        requestID: String,
        scriptID: String,
        itemID: String?,
        confirmed: Bool,
        authenticated: Bool?,
        sessionToken _: String
    ) async throws -> RunbookRun {
        startedRuns.append(StartedRun(
            requestID: requestID,
            scriptID: scriptID,
            itemID: itemID,
            confirmed: confirmed,
            authenticated: authenticated
        ))
        if losesNextRunReply {
            losesNextRunReply = false
            throw URLError(.networkConnectionLost)
        }
        return RunbookRun(
            id: "run-\(startedRuns.count)",
            scriptID: scriptID,
            scriptName: scriptID,
            itemID: itemID,
            status: .queued,
            active: true,
            createdAt: .now
        )
    }

    func fetchRunbookRun(id _: String, sessionToken _: String) async throws -> RunbookRunDetail {
        throw CowtailAPIError.requestFailed("Run not found")
    }

    // MARK: Incidents

    private var incident: IncidentDetail?
    private(set) var sentIncidentChanges: [IncidentChange] = []
    private var failsIncidentReads = false
    private var holdsIncidentRead = false
    private var heldIncidentRead: CheckedContinuation<Void, Never>?
    private var heldReadWaiters: [CheckedContinuation<Void, Never>] = []
    private var holdsIncidentChange = false
    private var heldIncidentChange: CheckedContinuation<Error?, Never>?
    private var heldIncidentWaiters: [CheckedContinuation<Void, Never>] = []

    func seedIncident(_ detail: IncidentDetail) {
        incident = detail
    }

    /// The next change waits at the server until `releaseIncidentChange`.
    func holdIncidentChange() {
        holdsIncidentChange = true
    }

    func waitUntilIncidentChangeHeld() async {
        if heldIncidentChange != nil {
            return
        }
        await withCheckedContinuation { heldIncidentWaiters.append($0) }
    }

    /// Answers the held change: with the error, or applied.
    func releaseIncidentChange(with error: Error?) {
        heldIncidentChange?.resume(returning: error)
        heldIncidentChange = nil
    }

    func fetchIncident(id _: String, sessionToken _: String) async throws -> IncidentDetail? {
        if failsIncidentReads {
            throw URLError(.notConnectedToInternet)
        }
        let snapshot = incident
        if holdsIncidentRead {
            holdsIncidentRead = false
            await withCheckedContinuation { continuation in
                heldIncidentRead = continuation
                heldReadWaiters.forEach { $0.resume() }
                heldReadWaiters = []
            }
        }
        return snapshot
    }

    /// The next read takes its snapshot now and answers with it once `releaseIncidentRead`.
    func holdIncidentRead() {
        holdsIncidentRead = true
    }

    func waitUntilIncidentReadHeld() async {
        if heldIncidentRead != nil {
            return
        }
        await withCheckedContinuation { heldReadWaiters.append($0) }
    }

    func releaseIncidentRead() {
        heldIncidentRead?.resume()
        heldIncidentRead = nil
    }

    /// Incident reads fail until this is set back.
    func failIncidentReads(_ fails: Bool) {
        failsIncidentReads = fails
    }

    func fetchIncidentCandidates(id _: String, sessionToken _: String) async throws -> [Item] {
        []
    }

    func changeIncident(id _: String, change: IncidentChange, sessionToken _: String) async throws -> IncidentDetail {
        sentIncidentChanges.append(change)
        if holdsIncidentChange {
            holdsIncidentChange = false
            let error = await withCheckedContinuation { continuation in
                heldIncidentChange = continuation
                heldIncidentWaiters.forEach { $0.resume() }
                heldIncidentWaiters = []
            }
            if let error {
                throw error
            }
        }
        guard let current = incident else { throw CowtailAPIError.refused("Incident not found") }
        incident = current.showing(change)
        return incident!
    }
}
