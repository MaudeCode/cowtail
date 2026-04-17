import SwiftUI

private struct DigestScopeBadge: View {
    let scope: FixScope

    var body: some View {
        Text(scope.label)
            .font(.cowtailMono(10, weight: .medium, relativeTo: .caption2))
            .foregroundStyle(scope.tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(scope.tint.opacity(0.14), in: Capsule())
    }
}

struct DigestFixesCard: View {
    @Environment(\.cowtailPalette) private var palette
    let fixes: [AlertFix]

    var body: some View {
        CowtailCard {
            CowtailSectionHeader(title: "Fixes Applied", detail: "\(fixes.count)")

            ForEach(Array(fixes.sorted(by: { $0.timestamp < $1.timestamp }).enumerated()), id: \.element.id) { index, fix in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        DigestScopeBadge(scope: fix.scope)

                        Spacer()

                        CowtailMonoLabel(text: fix.timestamp.formatted(date: .abbreviated, time: .shortened))
                    }

                    Text(fix.description)
                        .font(.cowtailSans(13, weight: .semibold, relativeTo: .footnote))
                        .foregroundStyle(palette.ink)

                    if !fix.rootCause.isEmpty {
                        Text(fix.rootCause)
                            .font(.cowtailSans(13, relativeTo: .footnote))
                            .foregroundStyle(.secondary)
                    }
                }

                if index < fixes.count - 1 {
                    Divider()
                }
            }
        }
    }
}
