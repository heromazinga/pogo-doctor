// 루트: Kotlin/Compose/AGP 플러그인을 하나의 classpath 에 올린다 (서브프로젝트는 버전 없이 id 만 적용).
// - 같은 classloader 에 있어야 kotlin.android 가 AGP 클래스(BaseVariant)를 찾을 수 있고, Kotlin 플러그인 다중 로드 경고도 없다.
// - Android SDK/Google Maven 이 없는 환경(:core 만 빌드)에서는 AGP 를 넣지 않는다 (settings 의 hasSdk).
val hasSdk = (gradle.extra["hasSdk"] as? Boolean) == true
buildscript {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.0.21")
        classpath("org.jetbrains.kotlin:compose-compiler-gradle-plugin:2.0.21")
        val sdk = (gradle.extra["hasSdk"] as? Boolean) == true
        if (sdk) classpath("com.android.tools.build:gradle:8.7.3")
    }
}
tasks.register("clean", Delete::class) { delete(rootProject.layout.buildDirectory) }
