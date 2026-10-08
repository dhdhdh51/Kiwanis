# WorkManager instantiates workers reflectively
-keep class * extends androidx.work.ListenableWorker { <init>(...); }
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
