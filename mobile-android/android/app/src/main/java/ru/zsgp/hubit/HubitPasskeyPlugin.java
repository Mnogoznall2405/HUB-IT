package ru.zsgp.hubit;

import android.os.Build;

import androidx.annotation.NonNull;
import androidx.credentials.CreateCredentialResponse;
import androidx.credentials.CreatePublicKeyCredentialRequest;
import androidx.credentials.CreatePublicKeyCredentialResponse;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPublicKeyCredentialOption;
import androidx.credentials.PublicKeyCredential;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

@CapacitorPlugin(name = "HubitPasskey")
public class HubitPasskeyPlugin extends Plugin {
    private static final String ERROR_UNAVAILABLE = "PasskeyUnavailable";

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        boolean available = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            && getContext() != null
            && getActivity() != null;
        result.put("available", available);
        call.resolve(result);
    }

    @PluginMethod
    public void getAssertion(PluginCall call) {
        String requestJson = call.getString("requestJson");
        if (requestJson == null || requestJson.trim().isEmpty()) {
            call.reject("requestJson is required");
            return;
        }
        if (getActivity() == null) {
            call.reject(ERROR_UNAVAILABLE);
            return;
        }

        GetPublicKeyCredentialOption option = new GetPublicKeyCredentialOption(requestJson);
        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(option)
            .build();

        CredentialManager manager = CredentialManager.create(getContext());
        manager.getCredentialAsync(
            getActivity(),
            request,
            null,
            getActivity().getMainExecutor(),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    try {
                        JSObject payload = new JSObject();
                        payload.put("credential", parseGetCredential(response.getCredential()));
                        call.resolve(payload);
                    } catch (Exception error) {
                        call.reject(error.getMessage(), error);
                    }
                }

                @Override
                public void onError(@NonNull GetCredentialException error) {
                    call.reject(error.getMessage(), error);
                }
            }
        );
    }

    @PluginMethod
    public void createCredential(PluginCall call) {
        String requestJson = call.getString("requestJson");
        if (requestJson == null || requestJson.trim().isEmpty()) {
            call.reject("requestJson is required");
            return;
        }
        if (getActivity() == null) {
            call.reject(ERROR_UNAVAILABLE);
            return;
        }

        CreatePublicKeyCredentialRequest publicKeyRequest = new CreatePublicKeyCredentialRequest(requestJson);

        CredentialManager manager = CredentialManager.create(getContext());
        manager.createCredentialAsync(
            getActivity(),
            publicKeyRequest,
            null,
            getActivity().getMainExecutor(),
            new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                @Override
                public void onResult(CreateCredentialResponse response) {
                    try {
                        JSObject payload = new JSObject();
                        payload.put("credential", parseCreateCredential(response));
                        call.resolve(payload);
                    } catch (Exception error) {
                        call.reject(error.getMessage(), error);
                    }
                }

                @Override
                public void onError(@NonNull CreateCredentialException error) {
                    call.reject(error.getMessage(), error);
                }
            }
        );
    }

    private JSObject parseGetCredential(Credential credential) throws Exception {
        if (!(credential instanceof PublicKeyCredential)) {
            throw new IllegalStateException("Unexpected credential type");
        }
        PublicKeyCredential publicKeyCredential = (PublicKeyCredential) credential;
        return webAuthnJsonToCredential(publicKeyCredential.getAuthenticationResponseJson(), true);
    }

    private JSObject parseCreateCredential(CreateCredentialResponse response) throws Exception {
        if (!(response instanceof CreatePublicKeyCredentialResponse)) {
            throw new IllegalStateException("Unexpected create credential response");
        }
        CreatePublicKeyCredentialResponse publicKeyResponse = (CreatePublicKeyCredentialResponse) response;
        return webAuthnJsonToCredential(publicKeyResponse.getRegistrationResponseJson(), false);
    }

    private JSObject webAuthnJsonToCredential(String responseJson, boolean isAuthentication) throws Exception {
        JSONObject root = new JSONObject(responseJson);
        JSONObject response = root.optJSONObject("response");
        if (response == null) {
            response = root;
        }

        JSObject credential = new JSObject();
        credential.put("id", root.optString("id", ""));
        credential.put("rawId", root.optString("rawId", root.optString("id", "")));
        credential.put("type", root.optString("type", "public-key"));

        JSObject responseObject = new JSObject();
        responseObject.put("clientDataJSON", response.optString("clientDataJSON", ""));
        if (isAuthentication) {
            responseObject.put("authenticatorData", response.optString("authenticatorData", ""));
            responseObject.put("signature", response.optString("signature", ""));
            responseObject.put("userHandle", response.optString("userHandle", ""));
        } else {
            responseObject.put("attestationObject", response.optString("attestationObject", ""));
            responseObject.put("authenticatorData", response.optString("authenticatorData", ""));
        }
        credential.put("response", responseObject);
        return credential;
    }
}
