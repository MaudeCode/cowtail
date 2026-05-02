import SwiftUI
import UIKit

struct OpenClawComposerTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool

    let font: UIFont
    let textColor: UIColor
    let placeholder: String

    static var defaultFont: UIFont {
        let baseFont = UIFont(name: CowtailTypography.sansFontName(for: .regular), size: 15)
            ?? UIFont.systemFont(ofSize: 15)
        return UIFontMetrics(forTextStyle: .subheadline).scaledFont(for: baseFont)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text, isFocused: $isFocused)
    }

    func makeUIView(context: Context) -> PlaceholderTextView {
        let textView = PlaceholderTextView()
        textView.delegate = context.coordinator
        textView.backgroundColor = .clear
        textView.isScrollEnabled = false
        textView.adjustsFontForContentSizeCategory = true
        textView.font = font
        textView.textColor = textColor
        textView.placeholder = placeholder
        textView.textContainerInset = .zero
        textView.textContainer.lineFragmentPadding = 0
        textView.returnKeyType = .default
        textView.keyboardDismissMode = .interactive
        textView.inputAssistantItem.leadingBarButtonGroups = []
        textView.inputAssistantItem.trailingBarButtonGroups = []
        textView.accessibilityIdentifier = "field.openclaw.reply"
        return textView
    }

    func updateUIView(_ textView: PlaceholderTextView, context: Context) {
        if textView.text != text {
            textView.text = text
            textView.invalidateIntrinsicContentSize()
        }
        textView.font = font
        textView.textColor = textColor
        textView.placeholder = placeholder
        textView.updatePlaceholderVisibility()

        if isFocused, !textView.isFirstResponder {
            textView.becomeFirstResponder()
        } else if !isFocused, textView.isFirstResponder {
            textView.resignFirstResponder()
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: PlaceholderTextView, context: Context) -> CGSize? {
        let width = proposal.width ?? 0
        let fittingSize = CGSize(width: width, height: .greatestFiniteMagnitude)
        let size = uiView.sizeThatFits(fittingSize)
        return CGSize(width: width, height: min(max(size.height, 20), 112))
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        @Binding private var text: String
        @Binding private var isFocused: Bool

        init(text: Binding<String>, isFocused: Binding<Bool>) {
            _text = text
            _isFocused = isFocused
        }

        func textViewDidChange(_ textView: UITextView) {
            text = textView.text
            textView.invalidateIntrinsicContentSize()
            (textView as? PlaceholderTextView)?.updatePlaceholderVisibility()
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            isFocused = true
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            isFocused = false
        }
    }
}

final class PlaceholderTextView: UITextView {
    private let placeholderLabel = UILabel()

    var placeholder: String = "" {
        didSet {
            placeholderLabel.text = placeholder
            updatePlaceholderVisibility()
        }
    }

    override var font: UIFont? {
        didSet {
            placeholderLabel.font = font
        }
    }

    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        configurePlaceholder()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let width = max(bounds.width - textContainerInset.left - textContainerInset.right, 0)
        placeholderLabel.frame = CGRect(
            x: textContainerInset.left + textContainer.lineFragmentPadding,
            y: textContainerInset.top,
            width: width,
            height: placeholderLabel.intrinsicContentSize.height
        )
    }

    func updatePlaceholderVisibility() {
        placeholderLabel.isHidden = !text.isEmpty
    }

    private func configurePlaceholder() {
        placeholderLabel.textColor = .placeholderText
        placeholderLabel.numberOfLines = 1
        placeholderLabel.isUserInteractionEnabled = false
        addSubview(placeholderLabel)
        updatePlaceholderVisibility()
    }
}
