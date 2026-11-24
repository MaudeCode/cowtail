import SwiftUI

/// A snooze picker row: a set length or a set local time.
struct SnoozePreset: Identifiable, Equatable {
    let id: String
    let title: String
    let until: Date

    /// 1 hour, 4 hours, tomorrow at 09:00, and 09:00 on the first Monday after today, in the
    /// calendar's zone.
    static func presets(now: Date, calendar: Calendar = .current) -> [SnoozePreset] {
        let tomorrow = calendar.startOfDay(for: calendar.date(byAdding: .day, value: 1, to: now) ?? now)
        let tomorrowMorning = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrow) ?? tomorrow
        let nextMonday = calendar.nextDate(
            after: tomorrow,
            matching: DateComponents(hour: 9, minute: 0, weekday: 2),
            matchingPolicy: .nextTime
        ) ?? tomorrowMorning
        return [
            SnoozePreset(id: "1h", title: "1 hour", until: now.addingTimeInterval(60 * 60)),
            SnoozePreset(id: "4h", title: "4 hours", until: now.addingTimeInterval(4 * 60 * 60)),
            SnoozePreset(id: "tomorrow", title: "Tomorrow", until: tomorrowMorning),
            SnoozePreset(id: "next-monday", title: "Next Monday", until: nextMonday),
        ]
    }
}

/// Snooze until a preset or a chosen future time. A preset row snoozes on tap.
struct SnoozeSheet: View {
    let snooze: (Date) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.cowtailPalette) private var palette
    @State private var now = Date.now
    @State private var custom = Date.now.addingTimeInterval(60 * 60)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Snooze until")
                    .font(.cowtailSans(17, weight: .bold, relativeTo: .headline))
                    .foregroundStyle(palette.ink)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.bottom, 6)

                ForEach(SnoozePreset.presets(now: now)) { preset in
                    Button {
                        choose(preset.until)
                    } label: {
                        HStack {
                            Text(preset.title)
                                .font(.cowtailSans(14, relativeTo: .body))
                            Spacer()
                            Text(ItemFormat.returnTime(preset.until, now: now))
                                .font(.cowtailMono(12, relativeTo: .caption))
                                .foregroundStyle(palette.mutedInk)
                        }
                        .foregroundStyle(palette.ink)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("button.snooze.\(preset.id)")
                    .cowtailRow()
                }

                DatePicker("Custom", selection: $custom, in: now..., displayedComponents: [.date, .hourAndMinute])
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
        .presentationDetents([.medium])
        .presentationBackground(palette.canvas)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sheet.snooze")
    }

    private func choose(_ until: Date) {
        snooze(until)
        dismiss()
    }
}
