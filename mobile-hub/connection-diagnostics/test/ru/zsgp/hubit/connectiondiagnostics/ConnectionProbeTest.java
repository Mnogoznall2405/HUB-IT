package ru.zsgp.hubit.connectiondiagnostics;

import java.io.IOException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.security.cert.CertPathValidatorException;
import java.security.cert.CertificateExpiredException;
import java.security.cert.CertificateNotYetValidException;
import java.util.concurrent.ExecutionException;
import javax.net.ssl.SSLHandshakeException;

/** Device TLS failures cannot be reproduced by a desktop UI test. No network calls. */
public final class ConnectionProbeTest {
    public static void main(String[] args) throws Exception {
        String privateText = "synthetic-private-message-cookie-token";
        SSLHandshakeException expired = new SSLHandshakeException(privateText);
        expired.initCause(new CertPathValidatorException(privateText,
            new CertificateExpiredException(privateText)));
        expect("certificate_expired", ConnectionProbe.failureCode(expired));
        SSLHandshakeException future = new SSLHandshakeException(privateText);
        future.initCause(new CertificateNotYetValidException(privateText));
        expect("certificate_not_yet_valid", ConnectionProbe.failureCode(future));
        SSLHandshakeException trust = new SSLHandshakeException(privateText);
        trust.initCause(new CertPathValidatorException(privateText));
        expect("certificate_untrusted", ConnectionProbe.failureCode(trust));
        expect("dns_failure", ConnectionProbe.failureCode(new ExecutionException(new UnknownHostException(privateText))));
        expect("timeout", ConnectionProbe.failureCode(new SSLHandshakeException(privateText) {{ initCause(new SocketTimeoutException(privateText)); }}));
        expect("network_failure", ConnectionProbe.failureCode(new IOException(privateText)));
        // IIS 401 means transport works; a 502 must remain distinguishable from TLS failure.
        expect(401, ConnectionProbe.parseHttpStatus("HTTP/1.1 401 Unauthorized"));
        expect(502, ConnectionProbe.parseHttpStatus("HTTP/1.1 502 Bad Gateway"));
        for (String invalid : new String[] { privateText, "HTTP/1.1 2000 OK", "HTTP/1.1 999 Bad", "<html>200 OK</html>" }) {
            try { ConnectionProbe.parseHttpStatus(invalid); throw new AssertionError("Malformed response accepted"); }
            catch (IOException expected) {
                if (expected.getMessage() != null) throw new AssertionError("Response content leaked");
            }
        }
        Throwable first = new IOException(privateText), second = new IOException(privateText);
        first.initCause(second); second.initCause(first);
        expect("network_failure", ConnectionProbe.failureCode(first));
        System.out.println("PASS: nested certificate failures, timeouts, DNS, HTTP parsing and redaction; no network calls");
    }

    private static void expect(Object expected, Object actual) {
        if (!expected.equals(actual)) throw new AssertionError("Expected " + expected + ", got " + actual);
    }
}
