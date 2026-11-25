import SwiftUI

/// Start a maintenance window: a title, a length, and what to silence. The server starts the
/// window and silences Alertmanager, so the submit waits for it.
struct MaintenanceSheet: View {
    enum Length: String, CaseIterable, Identifiable {
        case halfHour = "30m"
        case hour = "1h"
        case twoHours = "2h"
        case fourHours = "4h"
        case custom = "Custom"

        var id: String { rawValue }

        var duration: TimeInterval? {
            switch self {
            case .halfHour: 30 * 60
            case .hour: 60 * 60
            case .twoHours: 2 * 60 * 60
            case .fourHours: 4 * 60 * 60
            case .custom: nil
            }
        }
    }

    enum AlertScope: String, CaseIterable, Identifiable {
        case all
        case namespace
        case alertname

        var id: String { rawValue }

        var title: String {
            switch self {
            case .all: "All alerts"
            case .namespace: "A namespace"
            case .alertname: "An alert name"
            }
        }
    }

    @EnvironmentObject private var store: CowtailStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.cowtailPalette) private var palette
    @State private var title = ""
    @State private var length = Length.hour
    @State private var customMinutes = ""
    @State private var scope: AlertScope? = .all
    @State private var scopeValue = ""
    @State private var held: Set<String> = []
    /// One id per opened sheet: a submit retried after a lost reply finds the same window.
    @State private var requestID = UUID()
    @State private var isStarting = false
    @State private var error: String?

    private var duration: TimeInterval? {
        if let preset = length.duration {
            return preset
        }
        guard let minutes = Int(customMinutes), minutes >= 1 else { return nil }
        return TimeInterval(minutes * 60)
    }

    private var trimmedValue: String {
        scopeValue.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// A namespace or alert name needs its value; with no alert scope, a source.
    private var request: MaintenanceWindowRequest? {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, let duration else { return nil }
        switch scope {
        case .all:
            return MaintenanceWindowRequest(
                title: name,
                duration: duration,
                sources: held.sorted() + ["alertmanager"],
                requestID: requestID
            )
        case .namespace, .alertname:
            guard !trimmedValue.isEmpty, let label = scope?.rawValue else { return nil }
            return MaintenanceWindowRequest(
                title: name,
                duration: duration,
                matchers: [.init(label: label, value: trimmedValue)],
                sources: held.sorted(),
                requestID: requestID
            )
        case nil:
            return held.isEmpty
                ? nil
                : MaintenanceWindowRequest(title: name, duration: duration, sources: held.sorted(), requestID: requestID)
        }
    }

    var body: some View {
        NavigationStack {
            form
                .navigationTitle("Maintenance window")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                            .accessibilityIdentifier("button.maintenance.cancel")
                    }
                }
        }
        .presentationDetents([.large])
        .presentationBackground(palette.canvas)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sheet.maintenance")
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                TextField("Cluster upgrade", text: $title)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel("Title")
                    .accessibilityIdentifier("field.maintenance.title")

                Picker("Length", selection: $length) {
                    ForEach(Length.allCases) { length in
                        Text(length.rawValue).tag(length)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("picker.maintenance.length")

                if length == .custom {
                    TextField("Minutes", text: $customMinutes)
                        .keyboardType(.numberPad)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel("Minutes")
                        .accessibilityIdentifier("field.maintenance.minutes")
                }

                VStack(alignment: .leading, spacing: 0) {
                    CowtailSectionHeader(title: "Silence")
                    ForEach(AlertScope.allCases) { option in
                        scopeRow(option)
                    }
                    sourcesRow
                }

                Text("Cowtail's own watchdog items still push.")
                    .font(.cowtailSans(12, relativeTo: .footnote))
                    .foregroundStyle(palette.mutedInk)

                if let error {
                    Text(error)
                        .font(.cowtailSans(12, relativeTo: .footnote))
                        .foregroundStyle(palette.accent)
                        .accessibilityIdentifier("text.maintenance.error")
                }

                Button {
                    start()
                } label: {
                    Group {
                        if isStarting {
                            ProgressView()
                        } else {
                            Text("Start \(duration.map { ItemFormat.duration($0) } ?? "") window")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(request == nil || isStarting)
                .accessibilityIdentifier("button.maintenance.start")
            }
            .padding(20)
        }
    }

    /// One alert scope at a time; choosing it again clears it.
    private func scopeRow(_ option: AlertScope) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                scope = scope == option ? nil : option
            } label: {
                HStack {
                    Text(option.title).font(.cowtailSans(14, relativeTo: .body))
                    Spacer()
                    if scope == option {
                        Image(systemName: "checkmark").foregroundStyle(palette.success)
                    }
                }
                .foregroundStyle(palette.ink)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(scope == option ? .isSelected : [])
            .accessibilityIdentifier("button.maintenance.scope.\(option.rawValue)")

            if scope == option, option != .all {
                TextField(option == .namespace ? "Namespace" : "Alert name", text: $scopeValue)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.cowtailMono(13, relativeTo: .body))
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("field.maintenance.scope")
            }
        }
        .cowtailRow()
    }

    private var sourcesRow: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Sources").font(.cowtailSans(14, relativeTo: .body)).foregroundStyle(palette.ink)
            Spacer()
            HStack(spacing: 5) {
                ForEach(store.maintenanceSourceChoices, id: \.self) { source in
                    let on = held.contains(source)
                    Button {
                        if on {
                            held.remove(source)
                        } else {
                            held.insert(source)
                        }
                    } label: {
                        CowtailStatusBadge(title: source, tint: on ? palette.ink : palette.mutedInk)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                    .accessibilityIdentifier("button.maintenance.source.\(source)")
                }
            }
        }
        .cowtailRow()
    }

    private func start() {
        guard let request else { return }
        isStarting = true
        error = nil
        Task {
            let failure = await store.startMaintenance(request)
            isStarting = false
            if let failure {
                error = failure
            } else {
                dismiss()
            }
        }
    }
}

/// A running window above Needs you: what it silences, the time left, any silence error, and an
/// End window button.
struct MaintenanceBanner: View {
    let window: MaintenanceWindow

    @EnvironmentObject private var store: CowtailStore
    @Environment(\.cowtailPalette) private var palette

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "wrench.adjustable")
                .foregroundStyle(palette.warning)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(window.title)
                    .font(.cowtailSans(15, weight: .medium, relativeTo: .subheadline))
                    .foregroundStyle(palette.ink)
                Text("\(window.scope) silenced · \(window.remaining()) left")
                    .font(.cowtailSans(12, relativeTo: .caption))
                    .foregroundStyle(palette.mutedInk)
                if let silenceError = window.silenceError {
                    Text("Alertmanager did not silence these alerts: \(silenceError)")
                        .font(.cowtailSans(12, relativeTo: .caption))
                        .foregroundStyle(palette.accent)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("text.maintenance.\(window.id)")
            CowtailIconButton(title: "End window", systemImage: "stop") {
                Task { await store.endMaintenance(window) }
            }
            .accessibilityIdentifier("button.maintenance.end.\(window.id)")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(palette.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(palette.warning.opacity(0.5), lineWidth: 1))
        .padding(.top, 10)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("banner.maintenance.\(window.id)")
    }
}
