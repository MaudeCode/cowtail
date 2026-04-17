import SwiftUI

struct CowtailBrandHeader<Accessory: View>: View {
    let accessory: () -> Accessory

    init(@ViewBuilder accessory: @escaping () -> Accessory) {
        self.accessory = accessory
    }

    var body: some View {
        CowtailPageHeader(title: .split(leading: "COW", trailing: "TAIL")) {
            accessory()
        }
    }
}
