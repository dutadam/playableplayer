import Foundation

struct PlayableItem: Identifiable, Equatable {
    let id: String
    let title: String
    let fileURL: URL
    let createdAt: Date

    var displayDate: String {
        Self.dateFormatter.string(from: createdAt)
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()
}
