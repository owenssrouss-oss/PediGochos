package com.pedigochos.kitchen;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.WindowManager;
import android.webkit.WebSettings;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQUEST_NOTIFICATIONS = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1. Keep screen awake, wake screen and show when locked for platform orders and alarms
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        );

        // 2. Route default volume controls to media/alarm stream
        setVolumeControlStream(AudioManager.STREAM_MUSIC);

        // 3. Configure WebView for autonomous audio autoplay and persistent storage
        if (bridge != null && bridge.getWebView() != null) {
            WebSettings settings = bridge.getWebView().getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setJavaScriptCanOpenWindowsAutomatically(true);
        }

        // 4. Create High-Priority Notification Channel for background order alarms
        createNotificationChannel();

        // 5. Request Android 13+ Notification Permissions if not yet granted
        requestNotificationPermission();

        // 6. Request Battery Optimization Exemption so app is NEVER killed in background
        requestIgnoreBatteryOptimizations();

        // 7. Launch 24/7 Native Background Order Monitor & Alarm Service
        startBackgroundOrderService();

        // 8. Handle notification click intent on initial launch
        handleIncomingNotificationIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingNotificationIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        startBackgroundOrderService();
        handleIncomingNotificationIntent(getIntent());
    }

    private void handleIncomingNotificationIntent(Intent intent) {
        if (intent != null && intent.hasExtra("target_establishment_id")) {
            final String estId = intent.getStringExtra("target_establishment_id");
            final String orderId = intent.getStringExtra("target_order_id");
            final String estName = intent.getStringExtra("target_establishment_name");

            intent.removeExtra("target_establishment_id");
            intent.removeExtra("target_order_id");
            intent.removeExtra("target_establishment_name");

            if (estId != null && !estId.isEmpty() && bridge != null && bridge.getWebView() != null) {
                final String safeEstId = estId.replace("'", "\\'");
                final String safeOrderId = orderId != null ? orderId.replace("'", "\\'") : "";
                final String js = "if (window.AdminApp && typeof window.AdminApp.focusEstablishment === 'function') { " +
                                  "  window.AdminApp.focusEstablishment('" + safeEstId + "', '" + safeOrderId + "'); " +
                                  "} else { " +
                                  "  window.pendingTargetEstId = '" + safeEstId + "'; " +
                                  "  window.pendingTargetOrderId = '" + safeOrderId + "'; " +
                                  "}";

                bridge.getWebView().post(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            bridge.getWebView().evaluateJavascript(js, null);
                        } catch (Exception e) {
                            android.util.Log.w("MainActivity", "Eval JS notice: " + e.getMessage());
                        }
                    }
                });
            }
        }
    }

    private void startBackgroundOrderService() {
        try {
            Intent serviceIntent = new Intent(this, OrderNotificationService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception e) {
            android.util.Log.e("MainActivity", "Error starting OrderNotificationService: " + e.getMessage());
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager != null) {
                NotificationChannel channel = new NotificationChannel(
                    "pedigochos_master_alerts",
                    "Alertas de Pedidos Dueño",
                    NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Notificaciones y alarmas sonoras para pedidos entrantes de la plataforma");
                channel.enableVibration(true);
                channel.setVibrationPattern(new long[]{0, 500, 250, 500, 250, 1000});
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .build();
                channel.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, audioAttributes);

                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this,
                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    PERMISSION_REQUEST_NOTIFICATIONS
                );
            }
        }
    }

    private void requestIgnoreBatteryOptimizations() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                try {
                    Intent intent = new Intent();
                    intent.setAction(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                } catch (Exception e) {
                    try {
                        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                        startActivity(intent);
                    } catch (Exception ignored) {}
                }
            }
        }
    }
}
