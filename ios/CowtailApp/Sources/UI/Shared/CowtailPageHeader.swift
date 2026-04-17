import SwiftUI

enum CowtailPageHeaderTitle: Equatable {
    case split(leading: String, trailing: String)
    case title(String)
}

struct CowtailPageHeader<Accessory: View>: View {
    @Environment(\.cowtailPalette) private var palette

    let title: CowtailPageHeaderTitle
    let accessory: () -> Accessory

    init(
        title: CowtailPageHeaderTitle,
        @ViewBuilder accessory: @escaping () -> Accessory = { EmptyView() }
    ) {
        self.title = title
        self.accessory = accessory
    }

    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: 12) {
            titleView

            Spacer()

            accessory()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 2)
    }

    @ViewBuilder
    private var titleView: some View {
        switch title {
        case let .split(leading, trailing):
            HStack(spacing: 0) {
                Text(leading)
                    .foregroundStyle(palette.ink)
                Text(trailing)
                    .foregroundStyle(palette.accent)
            }
            .font(.cowtailSans(CowtailDesignGuide.pageHeaderFontSize, weight: .bold, relativeTo: .largeTitle))
        case let .title(value):
            Text(value)
                .font(.cowtailSans(CowtailDesignGuide.pageHeaderFontSize, weight: .bold, relativeTo: .largeTitle))
                .foregroundStyle(palette.ink)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
