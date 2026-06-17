import Combine
import Foundation

@MainActor
final class PlayableLibraryStore: ObservableObject {
    @Published private(set) var items: [PlayableItem] = []
    @Published var alertMessage: String?

    private let fileManager: FileManager
    private let libraryDirectory: URL

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
        let baseDirectory = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        self.libraryDirectory = baseDirectory.appendingPathComponent("Playables", isDirectory: true)
    }

    func reload() async {
        do {
            try ensureLibraryDirectory()
            let urls = try fileManager.contentsOfDirectory(
                at: libraryDirectory,
                includingPropertiesForKeys: [.creationDateKey],
                options: [.skipsHiddenFiles]
            )

            items = urls
                .filter { $0.pathExtension.lowercased() == "html" || $0.pathExtension.lowercased() == "htm" }
                .map(makeItem)
                .sorted { $0.createdAt > $1.createdAt }
        } catch {
            alertMessage = "Library could not be loaded: \(error.localizedDescription)"
        }
    }

    func importFiles(from urls: [URL]) async {
        guard !urls.isEmpty else { return }

        do {
            try ensureLibraryDirectory()

            for sourceURL in urls {
                let didStartAccessing = sourceURL.startAccessingSecurityScopedResource()
                defer {
                    if didStartAccessing {
                        sourceURL.stopAccessingSecurityScopedResource()
                    }
                }

                guard sourceURL.pathExtension.lowercased() == "html" || sourceURL.pathExtension.lowercased() == "htm" else {
                    continue
                }

                let destinationURL = uniqueDestinationURL(for: sourceURL)
                try fileManager.copyItem(at: sourceURL, to: destinationURL)
            }

            await reload()
        } catch {
            alertMessage = "Import failed: \(error.localizedDescription)"
        }
    }

    func delete(_ item: PlayableItem) async {
        do {
            try fileManager.removeItem(at: item.fileURL)
            await reload()
        } catch {
            alertMessage = "Delete failed: \(error.localizedDescription)"
        }
    }

    private func ensureLibraryDirectory() throws {
        try fileManager.createDirectory(at: libraryDirectory, withIntermediateDirectories: true)
    }

    private func makeItem(from url: URL) -> PlayableItem {
        let values = try? url.resourceValues(forKeys: [.creationDateKey])
        return PlayableItem(
            id: url.lastPathComponent,
            title: url.deletingPathExtension().lastPathComponent,
            fileURL: url,
            createdAt: values?.creationDate ?? .distantPast
        )
    }

    private func uniqueDestinationURL(for sourceURL: URL) -> URL {
        let baseName = sourceURL.deletingPathExtension().lastPathComponent
        let pathExtension = sourceURL.pathExtension.isEmpty ? "html" : sourceURL.pathExtension
        var candidate = libraryDirectory.appendingPathComponent("\(baseName).\(pathExtension)")
        var suffix = 2

        while fileManager.fileExists(atPath: candidate.path) {
            candidate = libraryDirectory.appendingPathComponent("\(baseName)-\(suffix).\(pathExtension)")
            suffix += 1
        }

        return candidate
    }
}
