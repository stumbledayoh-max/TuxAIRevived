package __PACKAGE__;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.widget.ProgressBar;
import android.content.res.AssetManager;
import java.io.InputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private WebView webView;
    private ProgressBar progressBar;
    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html"); MIME.put("htm", "text/html");
        MIME.put("css", "text/css"); MIME.put("js", "text/javascript");
        MIME.put("mjs", "text/javascript"); MIME.put("json", "application/json");
        MIME.put("wasm", "application/wasm"); MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg"); MIME.put("jpeg", "image/jpeg");
        MIME.put("gif", "image/gif"); MIME.put("svg", "image/svg+xml");
        MIME.put("webp", "image/webp"); MIME.put("ico", "image/x-icon");
        MIME.put("mp3", "audio/mpeg"); MIME.put("ogg", "audio/ogg");
        MIME.put("wav", "audio/wav"); MIME.put("mp4", "video/mp4");
        MIME.put("webm", "video/webm"); MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2"); MIME.put("ttf", "font/ttf");
        MIME.put("txt", "text/plain"); MIME.put("xml", "text/xml");
        MIME.put("data", "application/octet-stream");
        MIME.put("bin", "application/octet-stream");
        MIME.put("mem", "application/octet-stream");
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("__COLOR__"));
        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(__ZOOM__);
        s.setDisplayZoomControls(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                String marker = "/android_asset/www/";
                int i = url.indexOf(marker);
                if (i >= 0) {
                    String path = Uri.decode(url.substring(i + marker.length()));
                    int q = path.indexOf('?'); if (q >= 0) path = path.substring(0, q);
                    int h = path.indexOf('#'); if (h >= 0) path = path.substring(0, h);
                    if (path.isEmpty() || path.endsWith("/")) path += "index.html";
                    try {
                        InputStream is = getAssets().open("www/" + path);
                        String ext = "";
                        int d = path.lastIndexOf('.');
                        if (d >= 0) ext = path.substring(d + 1).toLowerCase();
                        String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
                        String enc = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") ? "UTF-8" : null;
                        return new WebResourceResponse(mime, enc, is);
                    } catch (IOException e) { return null; }
                }
                return null;
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("file:") || url.startsWith("about:")) return false;
                if (url.startsWith("http://appassets") ) return false;
                // links externos abrem no navegador
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) {}
                return true;
            }
        });
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) { webView.goBack(); return true; }
        return super.onKeyDown(keyCode, event);
    }
}
