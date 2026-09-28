pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
    // 버전만 선언 (적용 시점에 해석) — Android SDK/Google Maven 이 없는 환경에서도 :core 만 빌드 가능
    plugins {
        id("com.android.application") version "8.7.3"
        id("org.jetbrains.kotlin.android") version "2.0.21"
        id("org.jetbrains.kotlin.jvm") version "2.0.21"
        id("org.jetbrains.kotlin.plugin.compose") version "2.0.21"
    }
}
dependencyResolutionManagement {
    repositories { google(); mavenCentral() }
}
rootProject.name = "pogo-doctor-android"
include(":core")
// 앱 모듈은 Android SDK 가 있을 때만 포함 (SDK 없는 환경에서 :core 만 빌드·테스트하기 위함)
val hasSdk = System.getenv("ANDROID_HOME") != null || System.getenv("ANDROID_SDK_ROOT") != null || File(rootDir, "local.properties").exists()
if (hasSdk) include(":app")
