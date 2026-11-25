import Darwin
import SwiftUI
import UIKit
import XCTest

@MainActor
final class HostedScreen {
    /// XCUI enables this for the driven process. In-process tests need to enable it themselves.
    private static let enableAccessibility: Void = {
        guard let library = dlopen("/usr/lib/libAccessibility.dylib", RTLD_NOW),
              let setter = dlsym(library, "_AXSSetAutomationEnabled") else {
            return
        }
        typealias SetAutomation = @convention(c) (Int32) -> Void
        unsafeBitCast(setter, to: SetAutomation.self)(1)
    }()

    private let window: UIWindow
    private weak var previousKeyWindow: UIWindow?

    init(_ content: some View) throws {
        let scene = try Self.foregroundScene()
        _ = Self.enableAccessibility
        previousKeyWindow = scene.keyWindow
        window = UIWindow(windowScene: scene)
        window.rootViewController = UIHostingController(rootView: content)
        window.makeKeyAndVisible()
    }

    private static func foregroundScene() throws -> UIWindowScene {
        func activeScene() -> UIWindowScene? {
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first {
                $0.activationState == .foregroundActive
            }
        }
        if let active = activeScene() {
            return active
        }
        let activated = XCTNSNotificationExpectation(name: UIScene.didActivateNotification)
        _ = XCTWaiter.wait(for: [activated], timeout: 10)
        return try XCTUnwrap(activeScene(), "The test host has no active window scene")
    }

    func close() {
        window.isHidden = true
        window.rootViewController = nil
        previousKeyWindow?.makeKey()
    }

    func assertVisible(
        _ identifiers: [String],
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let appeared = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            MainActor.assumeIsolated {
                Set(identifiers).isSubset(of: Set(self.identifiedElements().keys))
            }
        }, object: nil)
        let result = XCTWaiter.wait(for: [appeared], timeout: 10)
        let missing = Set(identifiers).subtracting(Set(self.identifiedElements().keys))
        XCTAssertEqual(result, .completed, "Missing accessibility identifiers: \(missing.sorted())", file: file, line: line)
    }

    func assertGone(_ identifier: String, file: StaticString = #filePath, line: UInt = #line) {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            MainActor.assumeIsolated { self.element(identifier) == nil }
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 10), .completed,
                       "Expected \(identifier) to disappear", file: file, line: line)
    }

    func assertLabel(_ label: String, for identifier: String, file: StaticString = #filePath, line: UInt = #line) {
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            MainActor.assumeIsolated { self.element(identifier)?.accessibilityLabel == label }
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 10), .completed,
                       "Expected \(identifier) to have label \(label)", file: file, line: line)
    }

    func assertValue(_ value: String, for identifier: String, file: StaticString = #filePath, line: UInt = #line) {
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            MainActor.assumeIsolated { self.element(identifier)?.accessibilityValue == value }
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 10), .completed,
                       "Expected \(identifier) to have value \(value)", file: file, line: line)
    }

    func element(_ identifier: String) -> NSObject? {
        identifiedElements()[identifier]
    }

    func activate(_ identifier: String, file: StaticString = #filePath, line: UInt = #line) throws {
        assertVisible([identifier], file: file, line: line)
        let element = try XCTUnwrap(element(identifier), file: file, line: line)
        activate(element, named: identifier, file: file, line: line)
    }

    func activateButton(_ label: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let button = try XCTUnwrap(elements().first {
            $0.accessibilityLabel == label && $0.accessibilityTraits.contains(.button)
        }, "Missing button \(label)", file: file, line: line)
        activate(button, named: label, file: file, line: line)
    }

    private func activate(_ element: NSObject, named identifier: String, file: StaticString, line: UInt) {
        if let button = element as? UIControl {
            if button.showsMenuAsPrimaryAction {
                button.performPrimaryAction()
                return
            }
            button.sendActions(for: button.allControlEvents.contains(.primaryActionTriggered)
                ? .primaryActionTriggered : .touchUpInside)
        } else {
            XCTAssertTrue(element.accessibilityActivate(), "Could not activate \(identifier) (\(type(of: element)))", file: file, line: line)
        }
    }

    func confirmAlert(title: String, message: String, action: String, file: StaticString = #filePath, line: UInt = #line) throws {
        func alert() -> UIAlertController? {
            var controller = window.rootViewController
            while let presented = controller?.presentedViewController {
                controller = presented
            }
            return controller as? UIAlertController
        }

        let shown = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            MainActor.assumeIsolated { alert()?.title == title }
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [shown], timeout: 10), .completed, file: file, line: line)
        let controller = try XCTUnwrap(alert(), file: file, line: line)
        XCTAssertEqual(controller.message, message, file: file, line: line)
        let button = try XCTUnwrap(controller.actions.first { $0.title == action }, file: file, line: line)

        // UIKit exposes the action but has no public API to invoke its registered handler.
        let handler = try XCTUnwrap(button.value(forKey: "handler"), file: file, line: line)
        typealias Handler = @convention(block) (UIAlertAction) -> Void
        controller.dismiss(animated: false) {
            unsafeBitCast(handler as AnyObject, to: Handler.self)(button)
        }
    }

    func assertVerticalOrder(_ identifiers: [String], file: StaticString = #filePath, line: UInt = #line) {
        let frames = identifiedElements().mapValues(\.accessibilityFrame)
        for (above, below) in zip(identifiers, identifiers.dropFirst()) {
            guard let first = frames[above], let second = frames[below] else {
                XCTFail("Missing \(above) or \(below)", file: file, line: line)
                continue
            }
            XCTAssertLessThan(first.minY, second.minY, "\(above) should precede \(below)", file: file, line: line)
        }
    }

    func firstView<T: UIView>(ofType type: T.Type) -> T? {
        var pending: [UIView] = [window]
        while let view = pending.popLast() {
            if let match = view as? T, !view.isHidden {
                return match
            }
            pending.append(contentsOf: view.subviews)
        }
        return nil
    }

    func hasLabel(_ label: String, traits: UIAccessibilityTraits = []) -> Bool {
        elements().contains { $0.accessibilityLabel == label && $0.accessibilityTraits.contains(traits) }
    }

    private func identifiedElements() -> [String: NSObject] {
        let getter = NSSelectorFromString("accessibilityIdentifier")
        var result: [String: NSObject] = [:]
        for element in elements() where element.responds(to: getter) {
            if let identifier = element.perform(getter)?.takeUnretainedValue() as? String {
                result[identifier] = element
            }
        }
        return result
    }

    private func elements() -> [NSObject] {
        var result: [NSObject] = []
        var visited = Set<ObjectIdentifier>()
        var pending: [NSObject] = [window]
        while let element = pending.popLast() {
            guard visited.insert(ObjectIdentifier(element)).inserted else {
                continue
            }
            guard !element.accessibilityElementsHidden, (element as? UIView)?.isHidden != true else {
                continue
            }
            result.append(element)
            if let view = element as? UIView {
                pending.append(contentsOf: view.subviews)
            }
            if let children = element.accessibilityElements as? [NSObject] {
                pending.append(contentsOf: children)
            } else {
                let count = element.accessibilityElementCount()
                if count > 0 && count != NSNotFound {
                    for index in 0..<count {
                        if let child = element.accessibilityElement(at: index) as? NSObject {
                            pending.append(child)
                        }
                    }
                }
            }
        }
        return result
    }
}
