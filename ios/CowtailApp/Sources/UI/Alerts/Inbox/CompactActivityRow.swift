import SwiftUI

struct CompactActivityRow: View {
    @Environment(\.cowtailPalette) private var palette
    let alert: AlertItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: alert.outcome.symbolName)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(alert.outcome.tint)
                .frame(width: 20, height: 20)

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 12) {
                    Text(alert.alertName)
                        .font(.cowtailSans(13, weight: .semibold, relativeTo: .footnote))
                        .foregroundStyle(palette.ink)
                        .lineLimit(1)

                    Spacer(minLength: 8)

                    CowtailMonoLabel(text: alert.timestamp.formatted(.relative(presentation: .named)))
                }

                HStack(spacing: 8) {
                    CowtailMonoLabel(text: alert.outcome.label, tint: alert.outcome.tint)

                    if !alert.sourceLine.isEmpty {
                        CowtailMonoLabel(text: alert.sourceLine)
                            .lineLimit(1)
                    } else {
                        Text(alert.summary)
                            .font(.cowtailSans(12, relativeTo: .caption))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 10)
    }
}

#Preview {
    CompactActivityRow(alert: CowtailPreviewFixtures.secondaryAlert)
        .environment(\.cowtailPalette, ThemeCatalog.definition(for: .cowtail).darkPalette)
        .padding()
        .background(ThemeCatalog.definition(for: .cowtail).darkPalette.surface)
}
