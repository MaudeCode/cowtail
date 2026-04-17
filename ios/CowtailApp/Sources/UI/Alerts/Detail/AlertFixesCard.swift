import SwiftUI

private struct DetailScopeBadge: View {
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

struct AlertFixesCard: View {
    let fixes: [AlertFix]

    var body: some View {
        CowtailCard {
            CowtailSectionHeader(title: "Related Fixes", detail: "\(fixes.count)")

            if fixes.isEmpty {
                Text("No linked fixes recorded for this alert.")
                    .font(.cowtailSans(15, relativeTo: .subheadline))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(fixes.enumerated()), id: \.element.id) { index, fix in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            DetailScopeBadge(scope: fix.scope)

                            Spacer()

                            CowtailMonoLabel(text: fix.timestamp.formatted(.relative(presentation: .named)))
                        }

                        Text(fix.description)
                            .font(.cowtailSans(15, weight: .semibold, relativeTo: .subheadline))

                        if !fix.rootCause.isEmpty {
                            Text(fix.rootCause)
                                .font(.cowtailSans(13, relativeTo: .footnote))
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)

                    if index < fixes.count - 1 {
                        Divider()
                    }
                }
            }
        }
    }
}
