package com.hyperia.dancingwiththesars;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public class MainActivity extends Activity {

    private static final String WEBSITE_URL =
            "https://musa-ann1.github.io/DancingWithTheSARs/";

    private static final String TAG = "HYPERIA_WEBVIEW";

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        setFullScreen();

        webView = findViewById(R.id.webview);

        configureWebView();

        if (savedInstanceState != null) {
            if (webView.restoreState(savedInstanceState) != null) {
                return;
            }
        }

        webView.loadUrl(WEBSITE_URL);
    }

    private void configureWebView() {

        WebSettings settings = webView.getSettings();

        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(
                WebSettings.MIXED_CONTENT_NEVER_ALLOW
        );

        webView.setBackgroundColor(Color.BLACK);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        webView.setWebChromeClient(new WebChromeClient());

        webView.setWebViewClient(new WebViewClient() {

            @Override
            public boolean shouldOverrideUrlLoading(
                    WebView view,
                    WebResourceRequest request
            ) {
                Uri uri = request.getUrl();
                String host = uri.getHost();

                if (host != null &&
                        (host.equalsIgnoreCase("musa-ann1.github.io")
                                || host.endsWith(".github.io"))) {
                    return false;
                }

                openExternalLink(uri);
                return true;
            }

            @Override
            public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error
            ) {
                super.onReceivedError(view, request, error);

                if (request.isForMainFrame()) {

                    String message = "Error "
                            + error.getErrorCode()
                            + ": "
                            + error.getDescription();

                    Log.e(TAG,
                            "Main page failed. URL: "
                                    + request.getUrl()
                                    + " | "
                                    + message
                    );

                    Toast.makeText(
                            MainActivity.this,
                            message,
                            Toast.LENGTH_LONG
                    ).show();
                }
            }

            @Override
            public void onReceivedHttpError(
                    WebView view,
                    WebResourceRequest request,
                    android.webkit.WebResourceResponse response
            ) {
                super.onReceivedHttpError(view, request, response);

                if (request.isForMainFrame()) {

                    int statusCode = response.getStatusCode();

                    Log.e(TAG,
                            "HTTP error: "
                                    + statusCode
                                    + " | URL: "
                                    + request.getUrl()
                    );

                    Toast.makeText(
                            MainActivity.this,
                            "Website server error: HTTP " + statusCode,
                            Toast.LENGTH_LONG
                    ).show();
                }
            }
        });
    }

    private void openExternalLink(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException exception) {
            Toast.makeText(
                    this,
                    "No app can open this link.",
                    Toast.LENGTH_SHORT
            ).show();
        }
    }

    private void setFullScreen() {

        Window window = getWindow();

        window.setStatusBarColor(Color.BLACK);
        window.setNavigationBarColor(Color.BLACK);

        window.addFlags(
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {

            window.setDecorFitsSystemWindows(false);

            android.view.WindowInsetsController controller =
                    window.getInsetsController();

            if (controller != null) {

                controller.hide(
                        android.view.WindowInsets.Type.statusBars()
                                | android.view.WindowInsets.Type.navigationBars()
                );

                controller.setSystemBarsBehavior(
                        android.view.WindowInsetsController
                                .BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }

        } else {

            window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);

        if (hasFocus) {
            setFullScreen();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);

        if (webView != null) {
            webView.saveState(outState);
        }
    }

    @SuppressLint("GestureBackNavigation")
    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();

        if (webView != null) {
            webView.onResume();
        }

        setFullScreen();
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
        }

        super.onPause();
    }

    @Override
    protected void onDestroy() {

        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }

        getWindow().clearFlags(
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        );

        super.onDestroy();
    }
}