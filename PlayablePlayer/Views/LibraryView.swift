import SwiftUI

struct LibraryView: View {
    @EnvironmentObject private var library: PlayableLibraryStore
    @State private var isImporterPresented = false
    @State private var selectedItem: PlayableItem?

    var body: some View {
        NavigationStack {
            Group {
                if library.items.isEmpty {
                    ContentUnavailableView(
                        "No Playables",
                        systemImage: "gamecontroller",
                        description: Text("Import an HTML playable to start testing.")
                    )
                } else {
                    List {
                        ForEach(library.items) { item in
                            Button {
                                selectedItem = item
                            } label: {
                                PlayableRow(item: item)
                            }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    Task { await library.delete(item) }
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Playable Player")
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        Task { await library.reload() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }

                    Button {
                        isImporterPresented = true
                    } label: {
                        Label("Import", systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $isImporterPresented) {
                DocumentPicker { urls in
                    isImporterPresented = false
                    Task { await library.importFiles(from: urls) }
                }
            }
            .fullScreenCover(item: $selectedItem) { item in
                PlayerView(item: item) {
                    selectedItem = nil
                    Task { await library.reload() }
                }
            }
            .alert("Playable Player", isPresented: alertBinding) {
                Button("OK", role: .cancel) {
                    library.alertMessage = nil
                }
            } message: {
                Text(library.alertMessage ?? "")
            }
        }
    }

    private var alertBinding: Binding<Bool> {
        Binding(
            get: { library.alertMessage != nil },
            set: { isPresented in
                if !isPresented {
                    library.alertMessage = nil
                }
            }
        )
    }
}

private struct PlayableRow: View {
    let item: PlayableItem

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "play.rectangle.fill")
                .font(.title2)
                .foregroundStyle(.blue)
                .frame(width: 32, height: 32)

            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.headline)
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                Text(item.displayDate)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .contentShape(Rectangle())
        .padding(.vertical, 8)
    }
}
