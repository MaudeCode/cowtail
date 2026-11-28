import Foundation
import Security

struct KeychainStore {
    private let service: String

    init(service: String) {
        self.service = service
    }

    func string(for key: String) -> String? {
        try? readString(for: key)
    }

    /// Only a missing item reads as nil. A locked device may refuse reads while still permitting deletion.
    func readString(for key: String) throws -> String? {
        #if COWTAIL_PACKAGE
            MemoryKeychain.items.withLock { $0[itemKey(key)] }
        #else
            var query = baseQuery(for: key)
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne

            var item: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &item)
            if status == errSecItemNotFound {
                return nil
            }
            guard status == errSecSuccess else {
                throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
            }
            guard let data = item as? Data,
                  let string = String(data: data, encoding: .utf8) else {
                throw NSError(domain: NSOSStatusErrorDomain, code: Int(errSecDecode))
            }

            return string
        #endif
    }

    func set(_ value: String, for key: String) {
        try? write(value, for: key)
    }

    func write(_ value: String, for key: String) throws {
        #if COWTAIL_PACKAGE
            MemoryKeychain.items.withLock { $0[itemKey(key)] = value }
        #else
            let data = Data(value.utf8)
            let query = baseQuery(for: key)

            let attributes: [String: Any] = [
                kSecValueData as String: data
            ]

            let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
            if updateStatus == errSecSuccess {
                return
            }

            guard updateStatus == errSecItemNotFound else {
                throw NSError(domain: NSOSStatusErrorDomain, code: Int(updateStatus))
            }
            var createQuery = query
            createQuery[kSecValueData as String] = data
            let status = SecItemAdd(createQuery as CFDictionary, nil)
            guard status == errSecSuccess else {
                throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
            }
        #endif
    }

    func remove(_ key: String) {
        #if COWTAIL_PACKAGE
            MemoryKeychain.items.withLock { $0[itemKey(key)] = nil }
        #else
            let query = baseQuery(for: key)
            SecItemDelete(query as CFDictionary)
        #endif
    }

    private func itemKey(_ key: String) -> String {
        "\(service)/\(key)"
    }

    private func baseQuery(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
    }
}
