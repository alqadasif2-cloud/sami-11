package com.sami.tradingchallengetracker.util

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreSettings
import com.google.firebase.firestore.PersistentCacheSettings
import com.google.firebase.storage.FirebaseStorage

object FirebaseCloudHelper {

    @Volatile
    private var firestoreInstance: FirebaseFirestore? = null

    @Volatile
    private var storageInstance: FirebaseStorage? = null

    fun getFirestore(context: Context): FirebaseFirestore {
        return firestoreInstance ?: synchronized(this) {
            firestoreInstance ?: run {
                if (FirebaseApp.getApps(context).isEmpty()) {
                    try {
                        FirebaseApp.initializeApp(context)
                    } catch (_: Exception) {
                        try {
                            val options = com.google.firebase.FirebaseOptions.Builder()
                                .setProjectId("majestic-interface-ksmzh")
                                .setApplicationId("com.sami.tradingchallengetracker")
                                .setApiKey("AIzaSyB-fakeKeyPlaceholderForInit")
                                .setStorageBucket("majestic-interface-ksmzh-media")
                                .build()
                            FirebaseApp.initializeApp(context, options)
                        } catch (_: Exception) {}
                    }
                }
                val db = FirebaseFirestore.getInstance()
                val settings = FirebaseFirestoreSettings.Builder()
                    .setLocalCacheSettings(
                        PersistentCacheSettings.newBuilder()
                            .setSizeBytes(100L * 1024 * 1024) // 100MB offline local cache
                            .build()
                    )
                    .build()
                db.firestoreSettings = settings
                firestoreInstance = db
                db
            }
        }
    }

    fun getStorage(context: Context): FirebaseStorage {
        return storageInstance ?: synchronized(this) {
            storageInstance ?: run {
                if (FirebaseApp.getApps(context).isEmpty()) {
                    FirebaseApp.initializeApp(context)
                }
                val storage = FirebaseStorage.getInstance()
                storageInstance = storage
                storage
            }
        }
    }
}
