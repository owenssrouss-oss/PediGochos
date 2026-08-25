package com.pedigochos.kitchen;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "PediGochosBootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        Log.d(TAG, "Boot or package update received: " + (intent != null ? intent.getAction() : "null"));
        if (context != null) {
            try {
                Intent serviceIntent = new Intent(context, OrderNotificationService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent);
                } else {
                    context.startService(serviceIntent);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error starting OrderNotificationService on boot: " + e.getMessage());
            }
        }
    }
}
