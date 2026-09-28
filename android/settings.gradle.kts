pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositories { google(); mavenCentral() }
}
rootProject.name = "pogo-doctor-android"
include(":core")
// 앱 모듈은 Android SDK 가 있을 때만 포함 (SDK 없는 환경에서 :core 만 빌드·테스트하기 위함).
// 루트 build.gradle.kts 가 같은 값으로 AGP 를 classpath 에 넣을지 결정한다.
val hasSdk = System.getenv("ANDROID_HOME") != null || System.getenv("ANDROID_SDK_ROOT") != null || File(rootDir, "local.properties").exists()
gradle.extra["hasSdk"] = hasSdk
if (hasSdk) include(":app")
