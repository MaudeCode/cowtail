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

/// A text button, for the actions whose words carry what an icon cannot: sign-in, a question's answers.
struct CowtailTextButtonStyle: ButtonStyle {
    /// A full-width button, as tall as Sign in with Apple beside it.
    var fullWidth = false

    @Environment(\.cowtailPalette) private var palette

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.cowtailSans(fullWidth ? 15 : 13, weight: fullWidth ? .semibold : .medium, relativeTo: .footnote))
            .foregroundStyle(palette.ink)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: fullWidth ? 44 : nil)
            .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).stroke(palette.border, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

/// Every action is an icon with an accessible name.
struct CowtailIconButton: View {
    @Environment(\.cowtailPalette) private var palette

    let title: String
    let systemImage: String
    var tint: Color?
    var isBusy = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                if isBusy {
                    ProgressView().controlSize(.mini)
                } else {
                    Image(systemName: systemImage)
                        .font(.system(size: 13, weight: .semibold))
                }
            }
            .frame(width: 30, height: 30)
            .foregroundStyle(tint ?? palette.ink)
            .background((tint ?? palette.mutedInk).opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(isBusy)
        .accessibilityLabel(title)
        .help(title)
    }
}
