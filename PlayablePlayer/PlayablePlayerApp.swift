import SwiftUI

@MainActor
@main
struct PlayablePlayerApp: App {
    @StateObject private var library = PlayableLibraryStore()

    var body: some Scene {
        WindowGroup {
            LibraryView()
                .environmentObject(library)
                .task {
                    await library.reload()
                }
        }
    }
}
