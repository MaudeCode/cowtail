import Foundation
import os

/// The defaults the app keeps across launches: the system's in the app. The package build, which only runs the tests
/// on a developer's Mac or a CI runner, keeps them in memory, so no test writes the host's defaults.
extension UserDefaults {
    nonisolated(unsafe) static let cowtail: UserDefaults = {
        #if COWTAIL_PACKAGE
            MemoryDefaults(suiteName: nil)!
        #else
            .standard
        #endif
    }()
}

#if COWTAIL_PACKAGE
    /// Defaults that live and die with the test process. The typed getters and setters go through these three.
    private final class MemoryDefaults: UserDefaults {
        private let values = OSAllocatedUnfairLock(uncheckedState: [String: Any]())

        override func object(forKey key: String) -> Any? {
            values.withLockUnchecked { $0[key] }
        }

        override func set(_ value: Any?, forKey key: String) {
            values.withLockUnchecked { $0[key] = value }
        }

        override func removeObject(forKey key: String) {
            values.withLockUnchecked { $0[key] = nil }
        }
    }

    /// The keychain items of the package build, which never touches the host's login keychain.
    enum MemoryKeychain {
        static let items = OSAllocatedUnfairLock(initialState: [String: String]())
    }
#endif
