import SwiftUI

/// Snooze until one of the server's presets or a chosen future time. A preset row snoozes on tap.
struct SnoozeSheet: View {
    let load: () async throws -> [SnoozeOption]
    let snooze: (Date) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.cowtailPalette) private var palette
    @State private var options: [SnoozeOption]?
    @State private var loadError: String?
    @State private var custom = Date.now.addingTimeInterval(60 * 60)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Snooze until")
                    .font(.cowtailSans(17, weight: .bold, relativeTo: .headline))
                    .foregroundStyle(palette.ink)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.bottom, 6)

                if let options {
                    ForEach(options) { option in
                        presetRow(option)
                    }
                } else if let loadError {
                    Text(loadError)
                        .font(.cowtailSans(12, relativeTo: .footnote))
                        .foregroundStyle(palette.accent)
                        .padding(.vertical, 9)
                        .accessibilityIdentifier("text.snooze.error")
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                }

                DatePicker("Custom", selection: $custom, in: Date.now..., displayedComponents: [.date, .hourAndMinute])
                    .font(.cowtailSans(14, relativeTo: .body))
                    .foregroundStyle(palette.ink)
                    .accessibilityIdentifier("picker.snooze.custom")
                    .padding(.vertical, 9)

                Button("Snooze") {
                    choose(custom)
                }
                .buttonStyle(CowtailTextButtonStyle(fullWidth: true))
                .padding(.top, 4)
                .accessibilityIdentifier("button.snooze.custom")
            }
            .padding(20)
        }
        .task {
            do {
                options = try await load()
            } catch {
                loadError = error.localizedDescription
            }
        }
        .presentationDetents([.medium])
        .presentationBackground(palette.canvas)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sheet.snooze")
    }

    private func presetRow(_ option: SnoozeOption) -> some View {
        Button {
            choose(option.until)
        } label: {
            HStack {
                Text(option.preset.title)
                    .font(.cowtailSans(14, relativeTo: .body))
                Spacer()
                Text(ItemFormat.returnTime(option.until))
                    .font(.cowtailMono(12, relativeTo: .caption))
                    .foregroundStyle(palette.mutedInk)
            }
            .foregroundStyle(palette.ink)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("button.snooze.\(option.preset.identifier)")
        .cowtailRow()
    }

    private func choose(_ until: Date) {
        snooze(until)
        dismiss()
    }
}
