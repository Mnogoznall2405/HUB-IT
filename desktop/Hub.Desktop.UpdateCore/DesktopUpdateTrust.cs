using System.Security.Cryptography.X509Certificates;

namespace Hub.Desktop.UpdateCore;

public static class DesktopUpdateTrust
{
    /// <summary>Legacy key: the production TLS certificate also signs update manifests.</summary>
    public const string TlsKeyId = "hubit-zsgp-ru-tls-2026-04";

    /// <summary>Dedicated long-lived update signing key, independent from TLS.</summary>
    public const string SigningKeyId = "hub-update-signing-2026-10";

    private const string SigningPublicCertificateBase64 =
        "MIIETDCCArSgAwIBAgIQHXloOhrof61JyuKIwUo3OzANBgkqhkiG9w0BAQsFADA+MQ8wDQYDVQQKDAZIVUItSVQxKzApBgNVBAMMIkhVQiBEZXNrdG9wIFVwZGF0ZSBTaWduaW5nIDIwMjYtMTAwHhcNMjYxMDEyMDQ1MTM0WhcNMzYxMDEyMDUwMTM0WjA+MQ8wDQYDVQQKDAZIVUItSVQxKzApBgNVBAMMIkhVQiBEZXNrdG9wIFVwZGF0ZSBTaWduaW5nIDIwMjYtMTAwggGiMA0GCSqGSIb3DQEBAQUAA4IBjwAwggGKAoIBgQDFCFBdMSZHcRnXjyfTQ86+7F2Wh/TmlC8fr8HwMIjMEbXiZxaGjInMoGgmW+OszeYCOEeUCltXJxEXH3ZCY2l9/hK8Ef573CUCZGg6I7gQGLa5n09bE/mMVpSyecNFDJE6w57zrjIiuAqWjzQG32uZj6zmXQ/I0jIReLLpVSiMqbU9qYP/xpWZd+BCrnGgOJeUFNnh77PICHNP6Mkeb16x1PG423CWtbzVvSBrFKFOCZzL1FSYa6NdQ6CwbU4WGqa7QpWOk3IzcrJlmU2T4+tr8mDVaJ+JRsdCRbpE5O4FJuJFebJYZ06UQqXfilz7D1ZxYKWhLhnDV08rP5pqucOjtf29syh4oCDL8Tt2r0WP2hBPen9afEx0V7xZfNILgeA60yUIRroA+csoGbfiBeSXQwwOL+xEqWgCX2GKJBytePTL5XEpNE3WeC97Rpdc7StNIwAbggzlxxmgQ+H002kcniEEZzKUimgG+HAKjpkcJQtGE6b3+bUNiY20Catkpc0CAwEAAaNGMEQwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMDMB0GA1UdDgQWBBQFvO5cm6Atwc8WwbV7FEYURlaVVzANBgkqhkiG9w0BAQsFAAOCAYEAs/SP0/lAXjV0p7izwkbKnOeg2R/zzy/S1AbKiTJtjBzmnvTDwNBBMcC+zPDQCqJ3BoYxuwihIEumnCBLx/7Sdk0eX1lyXW8n2OOAKm8a28pVYJjCWOBd272qwepZNhXG8OkPPZBZFKzrHQHRvj06+fbETbB4t2XgrfK3TVVcGY2xTh6aCK/IMGnXBNSqVaGWikuXIuPOP75XhqpP1cQB0tsqiJvjxSss1A+QM5n2X1b2pDpUbWGPxoaNCwQs99kGSb2X0K/Vm8+UTZJxOowv5el5Uk8f3U70QBOIwa6AdrJCqZ7OetkSBde0FYJAUxgGTi35RWts/8n8mNp9ZGUgM5rvNGtgtzHDd5yd7Py7IX5WwR7WvsUSCLozVkm21ldTEUfMsj6TFguECpkpTI+UB2AW056KphMYq5PA8ynF+SfXQ5yzbJNm8ajtPtOo+sAG/dheWol2r9z6eZJW8MrsioHHLKfF4bL/3QvTYtLwKLa/rSdA16oZ/ItvK6Brkdii";

    private const string PublicCertificateBase64 =
        "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";

    public static IReadOnlyCollection<string> TrustedKeyIds { get; } = new[]
    {
        TlsKeyId,
        SigningKeyId,
    };

    public static bool IsTrustedKeyId(string keyId) =>
        TrustedKeyIds.Contains(keyId, StringComparer.Ordinal);

    /// <summary>Returns the legacy TLS certificate, which is also the TLS pin source.</summary>
    public static X509Certificate2 LoadCertificate() =>
        new(Convert.FromBase64String(PublicCertificateBase64));

    /// <summary>Returns the manifest verification certificate for a trusted key id.</summary>
    public static X509Certificate2? TryLoadCertificate(string keyId)
    {
        if (string.Equals(keyId, TlsKeyId, StringComparison.Ordinal))
        {
            return LoadCertificate();
        }

        if (string.Equals(keyId, SigningKeyId, StringComparison.Ordinal))
        {
            return new X509Certificate2(Convert.FromBase64String(SigningPublicCertificateBase64));
        }

        return null;
    }
}
