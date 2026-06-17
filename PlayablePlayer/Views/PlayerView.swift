import SwiftUI

struct PlayerView: View {
    let item: PlayableItem
    let onClose: () -> Void

    @State private var isControlPanelPresented = false
    @State private var reloadToken = UUID()

    var body: some View {
        PlayableWebView(
            fileURL: item.fileURL,
            reloadToken: reloadToken,
            onTripleTapTopLeft: {
                isControlPanelPresented = true
            }
        )
        .ignoresSafeArea()
        .background(Color.black)
        .ignoresSafeArea()
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .sheet(isPresented: $isControlPanelPresented) {
            PlayerControlPanel(
                title: item.title,
                onReload: {
                    reloadToken = UUID()
                    isControlPanelPresented = false
                },
                onClose: {
                    isControlPanelPresented = false
                    onClose()
                }
            )
            .presentationDetents([.height(220)])
            .presentationDragIndicator(.visible)
        }
    }
}

private struct PlayerControlPanel: View {
    let title: String
    let onReload: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(title)
                .font(.headline)
                .lineLimit(1)

            HStack(spacing: 12) {
                Button(action: onReload) {
                    Label("Reload", systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)

                Button(action: onClose) {
                    Label("Library", systemImage: "rectangle.stack")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }

            Text("Tip: triple tap the top-left corner to open this panel while a playable is running.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(20)
    }
}
