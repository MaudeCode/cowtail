import SwiftUI

/// A section's small uppercase mono label, with a count or a control at its trailing edge.
struct CowtailSectionHeader<Accessory: View>: View {
    @Environment(\.cowtailPalette) private var palette

    let title: String
    var detail: String?
    let accessory: Accessory

    init(title: String, detail: String? = nil, @ViewBuilder accessory: () -> Accessory) {
        self.title = title
        self.detail = detail
        self.accessory = accessory()
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            CowtailMonoLabel(text: title)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("section.\(title)")
            Spacer()
            if let detail, !detail.isEmpty {
                CowtailMonoLabel(text: detail, tint: palette.ink)
            }
            accessory
        }
        .padding(.top, 18)
        .padding(.bottom, 4)
    }
}

extension CowtailSectionHeader where Accessory == EmptyView {
    init(title: String, detail: String? = nil) {
        self.init(title: title, detail: detail) { EmptyView() }
    }
}

/// A row under a section header: rows are split by hairlines, never boxed.
private struct CowtailRowModifier: ViewModifier {
    @Environment(\.cowtailPalette) private var palette

    func body(content: Content) -> some View {
        content
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(palette.border)
                    .frame(height: 0.5)
            }
    }
}

extension View {
    func cowtailRow() -> some View {
        modifier(CowtailRowModifier())
    }
}

/// One label and its value on a row, the value muted and mono unless tinted.
struct CowtailKeyValueRow: View {
    @Environment(\.cowtailPalette) private var palette

    let key: String
    let value: String
    var tint: Color?

    var body: some View {
        HStack {
            Text(key).font(.cowtailSans(14, relativeTo: .body)).lineLimit(1)
            Spacer()
            Text(value)
                .font(.cowtailMono(12, relativeTo: .caption))
                .foregroundStyle(tint ?? palette.mutedInk)
        }
        .cowtailRow()
    }
}

/// A row that opens a page outside the app, its whole 44 pt height tappable.
struct CowtailLinkRow: View {
    @Environment(\.cowtailPalette) private var palette

    let title: String
    let url: URL

    var body: some View {
        Link(destination: url) {
            HStack {
                Text(title).font(.cowtailSans(14, relativeTo: .body))
                Spacer()
                Image(systemName: "arrow.up.right").font(.footnote.weight(.semibold))
            }
            .foregroundStyle(palette.ink)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .cowtailRow()
    }
}

/// Every in-content action is an icon with an accessible name, in a system button style with a hit
/// area of at least 44 × 44 pt. The glyph follows the body text style, so Dynamic Type scales it.
struct CowtailIconButton: View {
    enum Style {
        /// A filled circle: the item action area, a row's control.
        case bordered
        /// The accent-filled circle, for the one answer a screen leads with, such as Approve.
        case prominent
        /// A bare glyph, inline with a header or in a navigation bar.
        case borderless
    }

    @Environment(\.cowtailPalette) private var palette

    let title: String
    let systemImage: String
    var role: ButtonRole?
    var style = Style.bordered
    var isBusy = false
    let action: () -> Void

    /// Apple's minimum hit target.
    private static let minimumSide: CGFloat = 44
    /// The glyph's square inside a bordered circle; the style's padding brings the circle to 44 pt.
    @ScaledMetric(relativeTo: .body) private var glyphSide: CGFloat = 30

    var body: some View {
        styled(
            Button(role: role, action: action) {
                // The glyph stays laid out under the spinner, so busy keeps the button's size.
                Image(systemName: systemImage)
                    .font(.body.weight(.semibold))
                    .opacity(isBusy ? 0 : 1)
                    .overlay {
                        if isBusy {
                            ProgressView()
                        }
                    }
                    .frame(
                        minWidth: style == .borderless ? Self.minimumSide : glyphSide,
                        minHeight: style == .borderless ? Self.minimumSide : glyphSide
                    )
                    .contentShape(.rect)
            }
        )
        .frame(minWidth: Self.minimumSide, minHeight: Self.minimumSide)
        .contentShape(.rect)
        // A crowded row never squeezes the circle into its neighbour.
        .fixedSize()
        .disabled(isBusy)
        .accessibilityLabel(title)
        .help(title)
    }

    /// A prominent control fills with the app's accent. A bordered or bare one draws in ink, or in
    /// the system red for a destructive role, which these styles do not colour on their own.
    @ViewBuilder
    private func styled(_ button: Button<some View>) -> some View {
        let tint = role == .destructive ? Color.red : palette.ink
        switch style {
        case .bordered:
            button
                .buttonStyle(.bordered)
                .buttonBorderShape(.circle)
                .tint(tint)
        case .prominent:
            button
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.circle)
        case .borderless:
            button
                .buttonStyle(.borderless)
                .tint(tint)
        }
    }
}
