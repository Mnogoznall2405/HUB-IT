package ru.zsgp.hubit;

import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.Logger;

/**
 * Capacitor notifies WebView listeners for every subresource HTTP error.
 * API calls such as /api/v1/auth/me returning 401 during startup must not block the shell.
 */
public class HubitBridgeWebViewClient extends BridgeWebViewClient {
    private static final String TAG = "HubitBridgeWebViewClient";

    public interface StartupErrorHandler {
        void onMainFrameHttpError(WebView webView, int statusCode, String url);

        void onMainFrameNetworkError(WebView webView);
    }

    private final Bridge bridgeRef;
    private StartupErrorHandler startupErrorHandler;

    public HubitBridgeWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridgeRef = bridge;
    }

    public void setStartupErrorHandler(StartupErrorHandler handler) {
        this.startupErrorHandler = handler;
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
        if (request != null && request.isForMainFrame()) {
            String errorPath = bridgeRef.getErrorUrl();
            if (errorPath != null) {
                view.loadUrl(errorPath);
            }
        }

        if (!shouldSurfaceHttpErrorToShell(request, errorResponse)) {
            logIgnoredHttpError(request, errorResponse);
            return;
        }

        if (startupErrorHandler != null) {
            String url = request != null && request.getUrl() != null ? request.getUrl().toString() : "";
            int statusCode = errorResponse != null ? errorResponse.getStatusCode() : 0;
            startupErrorHandler.onMainFrameHttpError(view, statusCode, url);
        }
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request != null && request.isForMainFrame()) {
            String errorPath = bridgeRef.getErrorUrl();
            if (errorPath != null) {
                view.loadUrl(errorPath);
            }
            if (startupErrorHandler != null) {
                startupErrorHandler.onMainFrameNetworkError(view);
            }
        }
    }

    private boolean shouldSurfaceHttpErrorToShell(WebResourceRequest request, WebResourceResponse errorResponse) {
        if (request == null || errorResponse == null) {
            return false;
        }
        if (!request.isForMainFrame()) {
            return false;
        }
        return errorResponse.getStatusCode() >= 400;
    }

    private void logIgnoredHttpError(WebResourceRequest request, WebResourceResponse errorResponse) {
        String url = request != null && request.getUrl() != null ? request.getUrl().toString() : "unknown";
        int statusCode = errorResponse != null ? errorResponse.getStatusCode() : 0;
        Logger.debug(
            TAG,
            "Ignored non-blocking HTTP error status="
                + statusCode
                + " mainFrame="
                + (request != null && request.isForMainFrame())
                + " url="
                + url
        );
    }
}
