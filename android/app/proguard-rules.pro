# AuraPOS Android Proguard Rules
-keepattributes *Annotation*
-keepattributes JavascriptInterface

# Keep Javascript Bridge and Data Models
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keep class com.aurapos.pos.bridge.** { *; }
-keep class com.aurapos.pos.hardware.** { *; }
-keep class com.aurapos.pos.device.** { *; }
-keep class com.aurapos.pos.data.** { *; }

# Keep GSON models
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# Room
-keep class * extends androidx.room.RoomDatabase
-dontwarn androidx.room.paging.**
