import SwiftUI
import UIKit
import WebKit

struct PlayableWebView: UIViewRepresentable {
    let fileURL: URL
    let reloadToken: UUID
    let onTripleTapTopLeft: () -> Void

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.uiDelegate = context.coordinator
        webView.navigationDelegate = context.coordinator

        let recognizer = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.didTripleTapTopLeft(_:))
        )
        recognizer.numberOfTapsRequired = 3
        recognizer.cancelsTouchesInView = false
        recognizer.delegate = context.coordinator
        webView.addGestureRecognizer(recognizer)

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onTripleTapTopLeft = onTripleTapTopLeft
        context.coordinator.load(fileURL, in: webView, reloadToken: reloadToken)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onTripleTapTopLeft: onTripleTapTopLeft)
    }

    final class Coordinator: NSObject, WKUIDelegate, WKNavigationDelegate, UIGestureRecognizerDelegate {
        var onTripleTapTopLeft: () -> Void

        private var loadedURL: URL?
        private var loadedReloadToken: UUID?

        init(onTripleTapTopLeft: @escaping () -> Void) {
            self.onTripleTapTopLeft = onTripleTapTopLeft
        }

        func load(_ fileURL: URL, in webView: WKWebView, reloadToken: UUID) {
            guard loadedURL != fileURL || loadedReloadToken != reloadToken else { return }

            loadedURL = fileURL
            loadedReloadToken = reloadToken
            webView.loadFileURL(fileURL, allowingReadAccessTo: fileURL.deletingLastPathComponent())
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
            }
            return nil
        }

        @objc func didTripleTapTopLeft(_ recognizer: UITapGestureRecognizer) {
            guard recognizer.state == .ended else { return }
            onTripleTapTopLeft()
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard let view = gestureRecognizer.view else { return false }
            let location = touch.location(in: view)
            return location.x <= 72 && location.y <= 72
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }
    }
}
