import SwiftUI
import UIKit

struct KeyboardInputWarmupView: UIViewRepresentable {
    func makeUIView(context: Context) -> KeyboardInputWarmupHostView {
        KeyboardInputWarmupHostView()
    }

    func updateUIView(_ uiView: KeyboardInputWarmupHostView, context: Context) {
        uiView.scheduleWarmupIfNeeded()
    }
}

@MainActor
final class KeyboardInputWarmupHostView: UIView {
    private static var didWarmInputSystem = false
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
        guard window != nil, !Self.didWarmInputSystem, !didScheduleWarmup else {
            return
        }

        didScheduleWarmup = true
        DispatchQueue.main.async { [weak self] in
            self?.warmInputSystemIfPossible()
        }
    }

    private func warmInputSystemIfPossible() {
        guard window != nil, !Self.didWarmInputSystem else {
            didScheduleWarmup = false
            return
        }

        let field = UITextField(frame: CGRect(x: -8, y: -8, width: 1, height: 1))
        field.alpha = 0.01
        field.backgroundColor = .clear
        field.textColor = .clear
        field.tintColor = .clear
        field.isAccessibilityElement = false
        field.autocorrectionType = .no
        field.autocapitalizationType = .sentences
        field.spellCheckingType = .no
        field.smartDashesType = .no
        field.smartInsertDeleteType = .no
        field.smartQuotesType = .no
        field.textContentType = nil
        field.inputView = UIView(frame: .zero)
        field.inputAssistantItem.leadingBarButtonGroups = []
        field.inputAssistantItem.trailingBarButtonGroups = []

        addSubview(field)
        warmupField = field
        Self.didWarmInputSystem = true

        field.becomeFirstResponder()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak field] in
            field?.resignFirstResponder()
            field?.removeFromSuperview()
        }
    }
}
