package ru.zsgp.hubit.connectiondiagnostics;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class DiagnosticsActivity extends Activity {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private String report;
    private TextView result;
    private Button check, share, copy;

    @Override public void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        ScrollView scroll = new ScrollView(this);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        int spacing = Math.round(20 * getResources().getDisplayMetrics().density);
        content.setPadding(spacing, spacing, spacing, spacing);
        content.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(spacing, spacing + insets.getSystemWindowInsetTop(),
                spacing, spacing + insets.getSystemWindowInsetBottom());
            return insets;
        });
        TextView title = new TextView(this);
        title.setText("HUB-IT · Проверка подключения");
        title.setTextSize(23);
        content.addView(title);
        TextView description = new TextView(this);
        description.setText("Проверка DNS, соединения, сертификата HTTPS и ответа IIS. Вход не нужен. Отчёт не содержит пароли, токены, переписку, IP телефона и сведения о Wi-Fi.");
        description.setTextSize(16);
        content.addView(description);
        check = button(content, "Проверить подключение");
        check.setOnClickListener(view -> runProbe());
        result = new TextView(this);
        result.setTextSize(16);
        result.setTextIsSelectable(true);
        result.setText("Нажмите «Проверить подключение», затем отправьте отчёт.");
        content.addView(result);
        share = button(content, "Поделиться отчётом");
        copy = button(content, "Скопировать отчёт");
        share.setEnabled(false);
        copy.setEnabled(false);
        share.setOnClickListener(view -> {
            Intent intent = new Intent(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_SUBJECT, "Диагностика подключения HUB-IT")
                .putExtra(Intent.EXTRA_TEXT, report);
            try { startActivity(Intent.createChooser(intent, "Отправить отчёт")); }
            catch (android.content.ActivityNotFoundException error) {
                Toast.makeText(this, "Скопируйте отчёт и вставьте его в чат", Toast.LENGTH_LONG).show();
            }
        });
        copy.setOnClickListener(view -> {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            clipboard.setPrimaryClip(ClipData.newPlainText("HUB-IT диагностика", report));
            Toast.makeText(this, "Отчёт скопирован", Toast.LENGTH_SHORT).show();
        });
        scroll.addView(content);
        setContentView(scroll);
        if (savedState != null && savedState.getString("report") != null) {
            report = savedState.getString("report");
            result.setText(savedState.getString("summary", "Проверка завершена. Отправьте отчёт."));
            share.setEnabled(true);
            copy.setEnabled(true);
        }
    }

    private Button button(LinearLayout content, String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        content.addView(button);
        return button;
    }

    private void runProbe() {
        check.setEnabled(false);
        share.setEnabled(false);
        copy.setEnabled(false);
        result.setText("Проверяем подключение…");
        worker.execute(() -> {
            Map<String, Object> probe = ConnectionProbe.run(stage -> runOnUiThread(() -> {
                if (!isDestroyed()) result.setText("Проверяем: " + stageLabel(stage) + "…");
            }));
            JSONObject output = new JSONObject();
            String text;
            try {
                output.put("schemaVersion", 1);
                output.put("app", "HUB-IT Connection Diagnostics 1.0.0");
                output.put("generatedAt", Instant.now().toString());
                output.put("androidApi", Build.VERSION.SDK_INT);
                output.put("privacy", "no-user-content-no-credentials");
                output.put("probe", new JSONObject(probe));
                text = output.toString(2);
            } catch (Exception error) { text = "{\"code\":\"report_unavailable\"}"; }
            final String exported = text;
            runOnUiThread(() -> {
                if (isDestroyed()) return;
                report = exported;
                result.setText(summary(probe));
                check.setEnabled(true);
                share.setEnabled(true);
                copy.setEnabled(true);
            });
        });
    }

    private static String stageLabel(String stage) {
        switch (stage) {
            case "dns": return "DNS — адрес сервера";
            case "tcp": return "соединение с сервером";
            case "tls": return "сертификат HTTPS";
            default: return "ответ API через IIS";
        }
    }

    private static String summary(Map<String, Object> probe) {
        String code = String.valueOf(probe.get("code"));
        String detail;
        switch (code) {
            case "ok": detail = "Подключение работает. Сертификат проверен, API отвечает. HTTP 401 ожидаем: проверка выполняется без входа."; break;
            case "certificate_expired": detail = "Сертификат просрочен. Также проверьте дату и время телефона."; break;
            case "certificate_not_yet_valid": detail = "Сертификат ещё не действует. Проверьте дату и время телефона."; break;
            case "certificate_untrusted": detail = "Android не смог построить доверенную цепочку сертификатов сервера."; break;
            case "certificate_validation": case "peer_unverified": detail = "Android отклонил сертификат или имя сервера."; break;
            case "dns_failure": detail = "Телефон не смог определить адрес hubit.zsgp.ru."; break;
            case "http_status": detail = "HTTPS работает, но API вернул HTTP " + probe.get("httpStatus") + ". Нужна проверка публикации и reverse proxy IIS."; break;
            case "timeout": detail = "Сервер не ответил вовремя."; break;
            case "tls_handshake": case "tls_failure": detail = "Не удалось установить защищённое соединение HTTPS."; break;
            default: detail = "Не удалось подключиться к серверу.";
        }
        return detail + "\n\nЭтап: " + stageLabel(String.valueOf(probe.get("stage")))
            + "\nКод: " + code + "\nВремя: " + probe.get("elapsedMs") + " мс"
            + "\n\nНажмите «Поделиться отчётом» или скопируйте его в чат.";
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (report != null) {
            state.putString("report", report);
            state.putString("summary", result.getText().toString());
        }
    }

    @Override protected void onDestroy() {
        worker.shutdownNow();
        super.onDestroy();
    }
}
