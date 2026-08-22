package com.pedigochos.kitchen;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class OrderNotificationService extends Service {
    private static final String TAG = "PediGochosService";
    private static final String SERVICE_CHANNEL_ID = "pedigochos_service_channel";
    private static final String ALERT_CHANNEL_ID = "pedigochos_master_alerts";
    private static final int FOREGROUND_NOTIFICATION_ID = 1001;
    private static final String ORDERS_API_URL = "https://pedigochos.onrender.com/api/orders";

    private ScheduledExecutorService scheduler;
    private PowerManager.WakeLock wakeLock;
    private final Set<String> knownOrderIds = new HashSet<>();
    private boolean isFirstFetch = true;
    private Ringtone activeRingtone;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "OrderNotificationService onCreate");

        createNotificationChannels();

        // Acquire CPU WakeLock so process is NEVER suspended by Android Doze
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PediGochos:OrderMonitorWakeLock");
            wakeLock.acquire();
        }

        // Start Foreground Service with persistent status bar notification
        startForeground(FOREGROUND_NOTIFICATION_ID, buildForegroundNotification());

        // Start background polling thread
        startOrderPolling();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "OrderNotificationService onStartCommand");
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire();
        }
        return START_STICKY; // Tell Android to automatically resurrect service if killed
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        Log.d(TAG, "App task removed, restarting service to maintain 24/7 alarms...");
        Intent restartServiceIntent = new Intent(getApplicationContext(), OrderNotificationService.class);
        restartServiceIntent.setPackage(getPackageName());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(restartServiceIntent);
        } else {
            startService(restartServiceIntent);
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "OrderNotificationService onDestroy");
        if (scheduler != null && !scheduler.isShutdown()) {
            scheduler.shutdownNow();
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        stopRingtone();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;

            // 1. Silent Low-Priority Foreground Service Channel
            NotificationChannel serviceChannel = new NotificationChannel(
                SERVICE_CHANNEL_ID,
                "Estado del Servicio en Segundo Plano",
                NotificationManager.IMPORTANCE_LOW
            );
            serviceChannel.setDescription("Mantiene activa la conexión para recibir alarmas en tiempo real");
            serviceChannel.setShowBadge(false);
            nm.createNotificationChannel(serviceChannel);

            // 2. High-Priority Alert Channel for Incoming Orders
            NotificationChannel alertChannel = new NotificationChannel(
                ALERT_CHANNEL_ID,
                "Alertas y Alarmas de Pedidos",
                NotificationManager.IMPORTANCE_HIGH
            );
            alertChannel.setDescription("Notificaciones emergentes y alarmas sonoras para pedidos entrantes");
            alertChannel.enableVibration(true);
            alertChannel.setVibrationPattern(new long[]{0, 800, 300, 800, 300, 1000});
            alertChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_ALARM)
                .build();
            Uri alertSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (alertSoundUri == null) {
                alertSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }
            alertChannel.setSound(alertSoundUri, audioAttributes);

            nm.createNotificationChannel(alertChannel);
        }
    }

    private Notification buildForegroundNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            notificationIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, SERVICE_CHANNEL_ID)
            .setContentTitle("👑 PediGochos - Activo 24/7")
            .setContentText("🟢 Monitoreando pedidos en segundo plano con alarma sonora")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW);

        return builder.build();
    }

    private void startOrderPolling() {
        scheduler = Executors.newSingleThreadScheduledExecutor();
        scheduler.scheduleWithFixedDelay(new Runnable() {
            @Override
            public void run() {
                try {
                    fetchAndCheckOrders();
                } catch (Exception e) {
                    Log.w(TAG, "Polling exception: " + e.getMessage());
                }
            }
        }, 1, 3500, TimeUnit.MILLISECONDS);
    }

    private void fetchAndCheckOrders() {
        HttpURLConnection conn = null;
        BufferedReader reader = null;
        try {
            URL url = new URL(ORDERS_API_URL);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);
            conn.setRequestProperty("Accept", "application/json");

            int responseCode = conn.getResponseCode();
            if (responseCode == HttpURLConnection.HTTP_OK) {
                reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder response = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    response.append(line);
                }

                JSONArray ordersArray = new JSONArray(response.toString());
                handleOrdersData(ordersArray);
            }
        } catch (Exception e) {
            Log.w(TAG, "Network poll error: " + e.getMessage());
        } finally {
            if (reader != null) {
                try { reader.close(); } catch (Exception ignored) {}
            }
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private synchronized void handleOrdersData(JSONArray orders) {
        if (orders == null) return;

        if (isFirstFetch) {
            for (int i = 0; i < orders.length(); i++) {
                try {
                    JSONObject order = orders.getJSONObject(i);
                    String id = order.optString("id");
                    if (!id.isEmpty()) {
                        knownOrderIds.add(id);
                    }
                } catch (Exception ignored) {}
            }
            isFirstFetch = false;
            Log.d(TAG, "Initial seed completed with " + knownOrderIds.size() + " orders.");
            return;
        }

        // Check for new orders
        for (int i = 0; i < orders.length(); i++) {
            try {
                JSONObject order = orders.getJSONObject(i);
                String id = order.optString("id");
                if (!id.isEmpty() && !knownOrderIds.contains(id)) {
                    knownOrderIds.add(id);
                    triggerNewOrderAlarm(order);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error parsing order: " + e.getMessage());
            }
        }
    }

    private void triggerNewOrderAlarm(final JSONObject order) {
        Log.d(TAG, "🚨 NEW ORDER DETECTED in Background: " + order.optString("id"));

        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    String customer = order.optString("customer_name", "Cliente");
                    String restaurant = order.optString("restaurant_name", "Restaurante");
                    double total = order.optDouble("total", 0);

                    // 1. Wake screen up
                    wakeScreenUp();

                    // 2. Play Alarm Sound
                    playLoudAlarmSound();

                    // 3. Vibrate Phone
                    vibratePhone();

                    // 4. Show Heads-Up Alert Notification
                    showIncomingOrderNotification(customer, restaurant, total);
                } catch (Exception e) {
                    Log.e(TAG, "Error triggering alarm: " + e.getMessage());
                }
            }
        });
    }

    private void wakeScreenUp() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                @SuppressWarnings("deprecation")
                PowerManager.WakeLock screenLock = pm.newWakeLock(
                    PowerManager.FULL_WAKE_LOCK |
                    PowerManager.ACQUIRE_CAUSES_WAKEUP |
                    PowerManager.ON_AFTER_RELEASE,
                    "PediGochos:IncomingOrderWakeScreen"
                );
                screenLock.acquire(15000); // Keep screen on for 15s
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not wake screen: " + e.getMessage());
        }
    }

    private void playLoudAlarmSound() {
        try {
            stopRingtone();
            Uri alertUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (alertUri == null) {
                alertUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            }
            if (alertUri == null) {
                alertUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }

            activeRingtone = RingtoneManager.getRingtone(getApplicationContext(), alertUri);
            if (activeRingtone != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    activeRingtone.setAudioAttributes(
                        new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                    );
                } else {
                    activeRingtone.setStreamType(AudioManager.STREAM_ALARM);
                }
                activeRingtone.play();

                // Stop ringtone automatically after 14 seconds
                mainHandler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        stopRingtone();
                    }
                }, 14000);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error playing alarm ringtone: " + e.getMessage());
        }
    }

    private void stopRingtone() {
        if (activeRingtone != null && activeRingtone.isPlaying()) {
            try {
                activeRingtone.stop();
            } catch (Exception ignored) {}
            activeRingtone = null;
        }
    }

    private void vibratePhone() {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                long[] pattern = new long[]{0, 800, 300, 800, 300, 1000};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createWaveform(pattern, -1));
                } else {
                    v.vibrate(pattern, -1);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Vibration notice: " + e.getMessage());
        }
    }

    private void showIncomingOrderNotification(String customer, String restaurant, double total) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            Intent intent = new Intent(this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                (int) System.currentTimeMillis(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );

            NotificationCompat.Builder alert = new NotificationCompat.Builder(this, ALERT_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle("🚨 ¡NUEVO PEDIDO RECIBIDO!")
                .setContentText("🛒 " + customer + " en " + restaurant + " - Total: $" + String.format("%.2f", total))
                .setStyle(new NotificationCompat.BigTextStyle()
                    .bigText("🛒 Cliente: " + customer + "\n🏪 Local: " + restaurant + "\n💵 Total: $" + String.format("%.2f", total) + "\n\nToca para abrir la orden de inmediato."))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setFullScreenIntent(pendingIntent, true)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true);

            nm.notify((int) System.currentTimeMillis(), alert.build());
        } catch (Exception e) {
            Log.e(TAG, "Error showing incoming notification: " + e.getMessage());
        }
    }
}
