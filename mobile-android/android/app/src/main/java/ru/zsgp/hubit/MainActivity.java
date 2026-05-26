package ru.zsgp.hubit;

import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Logger;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "HubItMainActivity";
    private static final long WEB_AUTH_RETRY_DELAY_MS = 150L;
    private static final long LOGIN_WEB_AUTH_DEBOUNCE_MS = 400L;
    private static final long STARTUP_TIMEOUT_MS = 12_000L;
    private static final long APP_READY_RETRY_DELAY_MS = 300L;
    private static final int WEB_AUTH_MAX_ATTEMPTS = 12;
    private static final int APP_READY_MAX_ATTEMPTS = 40;
    private static final String WEBAUTHN_READY_JS =
        "window.dispatchEvent(new Event('hubit:webauthn-ready'));";
    private static final String APP_READY_CHECK_JS =
        "(function(){try{var d=document.documentElement;return [(d.getAttribute('data-hubit-app-ready')||''),(d.getAttribute('data-hubit-app-error')||'')].join('|');}catch(e){return 'failed|'+String(e&&e.message||e);}})();";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private int webAuthEnableAttempts = 0;
    private int appReadyCheckAttempts = 0;
    private boolean webViewLifecycleListenerRegistered = false;
    private boolean appReady = false;
    private WebView pendingLoginWebView;
    private TextView startupOverlayView;

    private final Runnable startupTimeoutRunnable = new Runnable() {
        @Override
        public void run() {
            if (!appReady) {
                showStartupOverlay(
                    "HUB-IT\n\nСтраница загружается дольше обычного.\n"
                        + "Проверьте сеть, VPN и доступность https://hubit.zsgp.ru"
                );
            }
        }
    };

    private final Runnable loginWebAuthRefreshRunnable = new Runnable() {
        @Override
        public void run() {
            if (pendingLoginWebView != null) {
                applyWebAuthenticationSupport(pendingLoginWebView);
                pendingLoginWebView = null;
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(HubitRuntimePlugin.class);
        registerPlugin(HubitPasskeyPlugin.class);
        registerPlugin(HubitPermissionsPlugin.class);
        super.onCreate(savedInstanceState);
        installStartupOverlay();
        registerWebViewLifecycleListener();
        try {
            configureSystemBarsAndKeyboard();
        } catch (Exception error) {
            Logger.warn(TAG, "System bar setup failed: " + error);
        }
        try {
            applyWindowInsetsToWebView();
        } catch (Exception error) {
            Logger.warn(TAG, "Window inset setup failed: " + error);
        }
        logWebAuthenticationSupportState();
        scheduleWebAuthenticationSupport();
        scheduleWebChromeClientSetup();
        scheduleWebViewClientSetup();
    }

    @Override
    public void onStart() {
        super.onStart();
        webAuthEnableAttempts = 0;
        scheduleWebAuthenticationSupport();
        registerWebViewLifecycleListener();
        scheduleWebChromeClientSetup();
        scheduleWebViewClientSetup();
    }

    @Override
    public void onResume() {
        super.onResume();
        webAuthEnableAttempts = 0;
        scheduleWebAuthenticationSupport();
    }

    private void scheduleWebAuthenticationSupport() {
        mainHandler.post(this::enableWebAuthenticationSupport);
    }

    private void scheduleWebChromeClientSetup() {
        mainHandler.post(this::attachHubitWebChromeClient);
    }

    private void scheduleWebViewClientSetup() {
        mainHandler.post(this::attachHubitWebViewClient);
    }

    private void attachHubitWebViewClient() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            mainHandler.postDelayed(this::attachHubitWebViewClient, WEB_AUTH_RETRY_DELAY_MS);
            return;
        }
        try {
            HubitBridgeWebViewClient webViewClient = new HubitBridgeWebViewClient(getBridge());
            webViewClient.setStartupErrorHandler(new HubitBridgeWebViewClient.StartupErrorHandler() {
                @Override
                public void onMainFrameHttpError(WebView webView, int statusCode, String url) {
                    showStartupOverlay(
                        "HUB-IT\n\nНе удалось открыть главную страницу (HTTP "
                            + statusCode
                            + ").\n"
                            + "Проверьте IIS и https://hubit.zsgp.ru"
                    );
                }

                @Override
                public void onMainFrameNetworkError(WebView webView) {
                    showStartupOverlay(
                        "HUB-IT\n\nНе удалось загрузить приложение.\n"
                            + "Проверьте интернет, VPN и сертификат сайта.\n\n"
                            + "Адрес: https://hubit.zsgp.ru"
                    );
                }
            });
            getBridge().setWebViewClient(webViewClient);
        } catch (Exception error) {
            Logger.warn(TAG, "Cannot attach HUB-IT WebViewClient: " + error);
        }
    }

    private void attachHubitWebChromeClient() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            mainHandler.postDelayed(this::attachHubitWebChromeClient, WEB_AUTH_RETRY_DELAY_MS);
            return;
        }
        try {
            getBridge().getWebView().setWebChromeClient(new HubitWebChromeClient(getBridge()));
            scheduleAppReadyCheck(getBridge().getWebView());
        } catch (Exception error) {
            Logger.warn(TAG, "Cannot attach HUB-IT WebChromeClient: " + error);
        }
    }

    private void configureSystemBarsAndKeyboard() {
        Window window = getWindow();
        int systemBarColor = Color.parseColor("#0F1722");

        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(systemBarColor);
        window.setNavigationBarColor(systemBarColor);
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }

    private void applyWindowInsetsToWebView() {
        View root = findViewById(android.R.id.content);
        if (root == null) {
            Logger.warn(TAG, "Cannot apply system insets before root view is ready");
            return;
        }

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets systemBars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());

            view.setPadding(
                systemBars.left,
                systemBars.top,
                systemBars.right,
                Math.max(systemBars.bottom, ime.bottom)
            );

            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(root);
    }

    private void installStartupOverlay() {
        if (startupOverlayView != null) {
            return;
        }
        FrameLayout root = findViewById(android.R.id.content);
        if (root == null) {
            Logger.warn(TAG, "Cannot install startup overlay before content view is ready");
            return;
        }

        TextView overlay = new TextView(this);
        overlay.setBackgroundColor(Color.parseColor("#0F1722"));
        overlay.setTextColor(Color.WHITE);
        overlay.setTextSize(16);
        overlay.setGravity(Gravity.CENTER);
        overlay.setPadding(48, 48, 48, 48);
        overlay.setClickable(true);
        overlay.setText("HUB-IT\n\nЗагрузка приложения...");
        root.addView(
            overlay,
            new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        );
        startupOverlayView = overlay;
        mainHandler.removeCallbacks(startupTimeoutRunnable);
        mainHandler.postDelayed(startupTimeoutRunnable, STARTUP_TIMEOUT_MS);
    }

    private void showStartupOverlay(String message) {
        if (startupOverlayView == null) {
            installStartupOverlay();
        }
        if (startupOverlayView == null) {
            return;
        }
        startupOverlayView.setText(message);
        startupOverlayView.setVisibility(View.VISIBLE);
        startupOverlayView.bringToFront();
    }

    private void hideStartupOverlay() {
        appReady = true;
        mainHandler.removeCallbacks(startupTimeoutRunnable);
        if (startupOverlayView != null) {
            startupOverlayView.setVisibility(View.GONE);
        }
    }

    private void registerWebViewLifecycleListener() {
        if (webViewLifecycleListenerRegistered || getBridge() == null) {
            return;
        }

        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageStarted(WebView webView) {
                appReady = false;
                appReadyCheckAttempts = 0;
                showStartupOverlay("HUB-IT\n\nЗагрузка https://hubit.zsgp.ru...");
                mainHandler.removeCallbacks(startupTimeoutRunnable);
                mainHandler.postDelayed(startupTimeoutRunnable, STARTUP_TIMEOUT_MS);
            }

            @Override
            public void onPageLoaded(WebView webView) {
                applyWebAuthenticationSupport(webView);
                scheduleLoginPageWebAuthRefresh(webView);
                scheduleAppReadyCheck(webView);
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                applyWebAuthenticationSupport(view);
                scheduleLoginPageWebAuthRefresh(view);
                scheduleAppReadyCheck(view);
            }

            @Override
            public boolean onRenderProcessGone(WebView webView, android.webkit.RenderProcessGoneDetail detail) {
                showStartupOverlay(
                    "HUB-IT\n\nAndroid WebView остановил процесс страницы.\n"
                        + "Закройте приложение и откройте снова."
                );
                return true;
            }
        });
        webViewLifecycleListenerRegistered = true;
    }

    private void logWebAuthenticationSupportState() {
        boolean supported = isWebAuthenticationFeatureSupported();
        Logger.info(TAG, "Web Authentication feature supported: " + supported);
    }

    private void scheduleLoginPageWebAuthRefresh(WebView webView) {
        if (webView == null) {
            return;
        }
        String url = webView.getUrl();
        if (url == null || !isLoginPageUrl(url)) {
            return;
        }
        pendingLoginWebView = webView;
        mainHandler.removeCallbacks(loginWebAuthRefreshRunnable);
        mainHandler.postDelayed(loginWebAuthRefreshRunnable, LOGIN_WEB_AUTH_DEBOUNCE_MS);
    }

    private void scheduleAppReadyCheck(WebView webView) {
        if (webView == null || appReady) {
            return;
        }
        mainHandler.postDelayed(() -> checkAppReady(webView), APP_READY_RETRY_DELAY_MS);
    }

    private void checkAppReady(WebView webView) {
        if (webView == null || appReady) {
            return;
        }

        try {
            webView.evaluateJavascript(APP_READY_CHECK_JS, value -> {
                String normalized = String.valueOf(value == null ? "" : value)
                    .replace("\\\"", "\"")
                    .replace("\"", "")
                    .trim();

                if (normalized.startsWith("ready|")) {
                    hideStartupOverlay();
                    return;
                }

                if (normalized.startsWith("failed|")) {
                    String detail = normalized.substring("failed|".length()).trim();
                    showStartupOverlay(
                        "HUB-IT\n\nОшибка запуска интерфейса.\n"
                            + (detail.isEmpty() ? "Проверьте frontend bundle на сервере." : detail)
                    );
                    return;
                }

                appReadyCheckAttempts += 1;
                if (appReadyCheckAttempts < APP_READY_MAX_ATTEMPTS) {
                    scheduleAppReadyCheck(webView);
                    return;
                }

                showStartupOverlay(
                    "HUB-IT\n\nИнтерфейс не сообщил о готовности.\n"
                        + "Обычно это stale cache/WebView или ошибка JS bundle.\n"
                        + "Удалите приложение с телефона и установите свежий APK."
                );
            });
        } catch (Exception error) {
            showStartupOverlay("HUB-IT\n\nНе удалось проверить готовность WebView: " + error);
        }
    }

    private boolean isLoginPageUrl(String url) {
        try {
            Uri uri = Uri.parse(url);
            String path = uri.getPath();
            return path != null && (path.equals("/login") || path.startsWith("/login/"));
        } catch (Exception error) {
            Logger.warn(TAG, "Cannot parse WebView URL for login refresh: " + url);
            return false;
        }
    }

    private void enableWebAuthenticationSupport() {
        if (!isWebAuthenticationFeatureSupported()) {
            Logger.warn(TAG, "Android System WebView does not support Web Authentication");
            return;
        }

        if (getBridge() == null || getBridge().getWebView() == null) {
            if (webAuthEnableAttempts < WEB_AUTH_MAX_ATTEMPTS) {
                webAuthEnableAttempts += 1;
                Logger.debug(
                    TAG,
                    "WebView not ready for Web Authentication, retry "
                        + webAuthEnableAttempts
                        + "/"
                        + WEB_AUTH_MAX_ATTEMPTS
                );
                mainHandler.postDelayed(this::enableWebAuthenticationSupport, WEB_AUTH_RETRY_DELAY_MS);
            } else {
                Logger.warn(TAG, "Cannot enable Web Authentication: Capacitor WebView stayed unavailable");
            }
            return;
        }

        webAuthEnableAttempts = 0;
        applyWebAuthenticationSupport(getBridge().getWebView());
    }

    private void applyWebAuthenticationSupport(WebView webView) {
        if (webView == null || !isWebAuthenticationFeatureSupported()) {
            return;
        }

        webView.post(() -> {
            try {
                WebSettingsCompat.setWebAuthenticationSupport(
                    webView.getSettings(),
                    WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP
                );
                Logger.debug(TAG, "Web Authentication support enabled for app-bound WebView");
                webView.evaluateJavascript(WEBAUTHN_READY_JS, null);
            } catch (Exception error) {
                Logger.warn(TAG, "Cannot enable Web Authentication support: " + error);
            }
        });
    }

    private boolean isWebAuthenticationFeatureSupported() {
        try {
            return WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION);
        } catch (Exception error) {
            Logger.warn(TAG, "Cannot check Web Authentication feature support: " + error);
            return false;
        }
    }
}
