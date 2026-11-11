package ru.zsgp.hubit.connectiondiagnostics;

import java.io.IOException;
import java.net.ConnectException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.cert.CertPathValidatorException;
import java.security.cert.CertificateException;
import java.security.cert.CertificateExpiredException;
import java.security.cert.CertificateNotYetValidException;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import javax.net.ssl.SSLException;
import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLPeerUnverifiedException;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/** Fixed read-only destination; default Android certificate and hostname validation. */
final class ConnectionProbe {
    static final String HOST = "hubit.zsgp.ru";
    interface Progress { void update(String stage); }

    static Map<String, Object> run(Progress progress) {
        Map<String, Object> report = new LinkedHashMap<>();
        long started = System.nanoTime();
        report.put("target", "https://" + HOST + "/api/v1/auth/me");
        report.put("ok", false);
        String stage = "dns";
        ExecutorService resolver = Executors.newSingleThreadExecutor(r -> {
            Thread thread = new Thread(r, "hubit-diagnostic-dns");
            thread.setDaemon(true);
            return thread;
        });
        Future<InetAddress[]> lookup = resolver.submit(() -> InetAddress.getAllByName(HOST));
        try {
            progress.update(stage);
            InetAddress[] addresses = lookup.get(5, TimeUnit.SECONDS);
            report.put("dnsMs", elapsed(started));
            report.put("resolvedAddressCount", addresses.length);
            List<String> families = new ArrayList<>();
            List<String> targets = new ArrayList<>();
            for (InetAddress address : addresses) {
                String family = address instanceof Inet4Address ? "ipv4" : "ipv6";
                if (!families.contains(family)) families.add(family);
                String target = addressClass(address);
                if (!targets.contains(target)) targets.add(target);
            }
            report.put("addressFamilies", families);
            report.put("resolvedTargets", targets);
            stage = "tcp";
            progress.update(stage);
            // Address fallbacks share one five-second budget, including slow IPv6.
            try (Socket tcp = connect(addresses)) {
                report.put("tcpMs", elapsed(started));
                report.put("connectedFamily", tcp.getInetAddress() instanceof Inet4Address ? "ipv4" : "ipv6");
                stage = "tls";
                progress.update(stage);
                try { report.put("globalSignR46Trusted", trustsGlobalSignR46()); }
                catch (Exception ignored) { report.put("globalSignR46Trusted", "unavailable"); }
                SSLSocketFactory factory = (SSLSocketFactory) SSLSocketFactory.getDefault();
                try (SSLSocket tls = (SSLSocket) factory.createSocket(tcp, HOST, 443, true)) {
                    tls.setSoTimeout(5000);
                    SSLParameters parameters = tls.getSSLParameters();
                    parameters.setEndpointIdentificationAlgorithm("HTTPS");
                    tls.setSSLParameters(parameters);
                    tls.startHandshake();
                    report.put("tlsMs", elapsed(started));
                    report.put("tlsVerified", true);
                    report.put("tlsVersion", tls.getSession().getProtocol());
                    List<Map<String, Object>> certificates = new ArrayList<>();
                    for (java.security.cert.Certificate peer : tls.getSession().getPeerCertificates()) {
                        if (!(peer instanceof X509Certificate)) continue;
                        X509Certificate cert = (X509Certificate) peer;
                        Map<String, Object> metadata = new LinkedHashMap<>();
                        metadata.put("sha256", digest(cert.getEncoded(), "SHA-256"));
                        metadata.put("notBeforeMs", cert.getNotBefore().getTime());
                        metadata.put("notAfterMs", cert.getNotAfter().getTime());
                        certificates.add(metadata);
                    }
                    report.put("serverCertificates", certificates);
                    stage = "http";
                    progress.update(stage);
                    // No token, cookie, device ID, redirect following or response body.
                    String request = "GET /api/v1/auth/me HTTP/1.1\r\nHost: " + HOST
                        + "\r\nUser-Agent: HUB-IT-Connection-Diagnostics/1.0"
                        + "\r\nX-Auth-Client: mobile\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
                    tls.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
                    tls.getOutputStream().flush();
                    String status = readStatusLine(tls);
                    int httpStatus = parseHttpStatus(status);
                    report.put("httpStatus", httpStatus);
                    report.put("ok", httpStatus == 401 || (httpStatus >= 200 && httpStatus < 300));
                    report.put("code", Boolean.TRUE.equals(report.get("ok")) ? "ok" : "http_status");
                }
            }
        } catch (Exception error) {
            report.put("code", failureCode(error));
        } finally {
            lookup.cancel(true);
            resolver.shutdownNow();
            report.put("stage", stage);
            report.put("elapsedMs", elapsed(started));
        }
        return report;
    }

    private static Socket connect(InetAddress[] addresses) throws IOException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        IOException last = new UnknownHostException();
        for (InetAddress address : addresses) {
            long remaining = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime());
            if (remaining <= 0) break;
            Socket socket = new Socket();
            try {
                socket.connect(new InetSocketAddress(address, 443), (int) Math.min(remaining, 1500));
                return socket;
            } catch (IOException error) {
                last = error;
                socket.close();
            }
        }
        throw last;
    }

    private static String readStatusLine(SSLSocket socket) throws IOException {
        StringBuilder line = new StringBuilder();
        // Bounded first line only: malformed endpoints cannot fill memory or enter the report.
        for (int i = 0; i < 256; i++) {
            int next = socket.getInputStream().read();
            if (next == -1) break;
            if (next == '\n') return line.toString();
            if (next != '\r') line.append((char) next);
        }
        throw new IOException();
    }

    static int parseHttpStatus(String line) throws IOException {
        if (!line.matches("HTTP/1\\.[01] [1-5][0-9]{2}(?: .*)?")) throw new IOException();
        return Integer.parseInt(line.substring(9, 12));
    }

    static String failureCode(Throwable error) {
        List<Throwable> causes = new ArrayList<>();
        for (Throwable current = error; current != null && causes.size() < 10; current = current.getCause()) {
            if (causes.contains(current)) break;
            causes.add(current);
        }
        if (has(causes, CertificateExpiredException.class)) return "certificate_expired";
        if (has(causes, CertificateNotYetValidException.class)) return "certificate_not_yet_valid";
        if (has(causes, CertPathValidatorException.class)) return "certificate_untrusted";
        if (has(causes, SSLPeerUnverifiedException.class)) return "peer_unverified";
        if (has(causes, CertificateException.class)) return "certificate_validation";
        if (has(causes, UnknownHostException.class)) return "dns_failure";
        if (has(causes, SocketTimeoutException.class) || has(causes, TimeoutException.class)) return "timeout";
        if (has(causes, ConnectException.class)) return "connect_failure";
        if (has(causes, SSLHandshakeException.class)) return "tls_handshake";
        if (has(causes, SSLException.class)) return "tls_failure";
        if (has(causes, SecurityException.class)) return "network_permission";
        return "network_failure";
    }

    private static boolean has(List<Throwable> causes, Class<?> type) {
        for (Throwable cause : causes) if (type.isInstance(cause)) return true;
        return false;
    }

    private static String addressClass(InetAddress address) {
        if ("2.63.221.212".equals(address.getHostAddress())) return "published_public";
        if ("10.103.0.217".equals(address.getHostAddress())) return "published_lan";
        return address.isSiteLocalAddress() ? "other_private" : "other_public";
    }

    private static boolean trustsGlobalSignR46() throws Exception {
        TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        factory.init((java.security.KeyStore) null);
        for (javax.net.ssl.TrustManager manager : factory.getTrustManagers()) {
            if (!(manager instanceof X509TrustManager)) continue;
            for (X509Certificate cert : ((X509TrustManager) manager).getAcceptedIssuers()) {
                if (digest(cert.getEncoded(), "SHA-1").equals("53a2b04bca6bd645e6398a8ec40dd2bf77c3a290")) return true;
            }
        }
        return false;
    }

    private static String digest(byte[] bytes, String algorithm) throws Exception {
        StringBuilder result = new StringBuilder();
        for (byte value : MessageDigest.getInstance(algorithm).digest(bytes)) result.append(String.format("%02x", value & 255));
        return result.toString();
    }

    private static long elapsed(long start) { return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start); }
}
