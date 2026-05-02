import SwiftUI
import UIKit

struct TextInputServicesWarmupView: UIViewRepresentable {
    func makeUIView(context: Context) -> TextInputServicesWarmupHostView {
        TextInputServicesWarmupHostView()
    }

    func updateUIView(_ uiView: TextInputServicesWarmupHostView, context: Context) {
        uiView.scheduleWarmupIfNeeded()
    }
}

@MainActor
final class TextInputServicesWarmupHostView: UIView {
    private static var didWarmTextInputServices = false

    private var didScheduleWarmup = false
    private weak var warmupField: UITextField?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isAccessibilityElement = false
        accessibilityElementsHidden = true
        isUserInteractionEnabled = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        scheduleWarmupIfNeeded()
    }

    func scheduleWarmupIfNeeded() {
        guard window != nil, !Self.didWarmTextInputServices, !didScheduleWarmup else {
            return
        }

        didScheduleWarmup = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            self?.warmTextInputServicesIfPossible()
        }
    }

    private func warmTextInputServicesIfPossible() {
        guard window != nil, !Self.didWarmTextInputServices else {
            didScheduleWarmup = false
            return
        }

        _ = UITextInputMode.activeInputModes
        _ = UITextChecker.availableLanguages

        let checker = UITextChecker()
        _ = checker.rangeOfMisspelledWord(
            in: "message",
            range: NSRange(location: 0, length: 7),
            startingAt: 0,
            wrap: false,
            language: Locale.current.identifier
        )

        let field = UITextField(frame: CGRect(x: -8, y: -8, width: 1, height: 1))
        field.alpha = 0.01
        field.backgroundColor = .clear
        field.textColor = .clear
        field.tintColor = .clear
        field.isAccessibilityElement = false
        field.autocorrectionType = .default
        field.autocapitalizationType = .sentences
        field.spellCheckingType = .default
        field.smartDashesType = .default
        field.smartInsertDeleteType = .default
        field.smartQuotesType = .default
        field.inputView = UIView(frame: .zero)
        field.inputAssistantItem.leadingBarButtonGroups = []
        field.inputAssistantItem.trailingBarButtonGroups = []

        addSubview(field)
        warmupField = field
        Self.didWarmTextInputServices = true

        field.becomeFirstResponder()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak field] in
            field?.resignFirstResponder()
            field?.removeFromSuperview()
        }
    }
}
