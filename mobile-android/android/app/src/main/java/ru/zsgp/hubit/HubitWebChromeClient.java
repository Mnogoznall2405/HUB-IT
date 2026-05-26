package ru.zsgp.hubit;

import android.Manifest;
import android.content.pm.PackageManager;
import android.webkit.PermissionRequest;

import androidx.core.content.ContextCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.Logger;

import java.util.Arrays;

/**
 * Grants WebView getUserMedia when Android CAMERA is already allowed.
 * Avoids a second denied path after HubitPermissionsPlugin requests runtime access.
 */
public class HubitWebChromeClient extends BridgeWebChromeClient {
    private static final String TAG = "HubitWebChromeClient";
    private final Bridge bridgeRef;

    public HubitWebChromeClient(Bridge bridge) {
        super(bridge);
        this.bridgeRef = bridge;
    }

    @Override
    public void onPermissionRequest(final PermissionRequest request) {
        try {
            if (hasCameraPermission() && wantsVideoCapture(request)) {
                request.grant(request.getResources());
                return;
            }
        } catch (Exception error) {
            Logger.warn(TAG, "Cannot grant WebView camera permission: " + error);
        }
        super.onPermissionRequest(request);
    }

    private boolean hasCameraPermission() {
        if (bridgeRef == null || bridgeRef.getContext() == null) {
            return false;
        }
        return ContextCompat.checkSelfPermission(bridgeRef.getContext(), Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED;
    }

    private boolean wantsVideoCapture(PermissionRequest request) {
        if (request == null || request.getResources() == null) {
            return false;
        }
        return Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
    }
}
