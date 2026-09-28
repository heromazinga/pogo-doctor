import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// 서명: GitHub Actions 가 Secrets 로 넘긴 keystore (환경변수). 없으면 debug 키로 서명 (경고 출력, 업데이트 설치 불가)
// (이름을 env* 로 두는 이유: signingConfig 블록 안에서 keyAlias 는 수신자 프로퍼티를 가리켜 값이 null 로 들어갔던 문제)
val envKsPath = System.getenv("ANDROID_KEYSTORE_PATH")
val envKsPass = System.getenv("ANDROID_KEYSTORE_PASSWORD")
val envKeyAlias = System.getenv("ANDROID_KEY_ALIAS")
val envKeyPass = System.getenv("ANDROID_KEY_PASSWORD")
val hasReleaseKey = !envKsPath.isNullOrBlank() && File(envKsPath).exists() && !envKsPass.isNullOrBlank() && !envKeyAlias.isNullOrBlank()
if (!hasReleaseKey) logger.warn("[pogo-doctor] 릴리스 keystore 없음 → debug 키로 서명합니다 (기기에서 기존 설치 위에 업데이트 불가)")

// 서버 URL: gradle 속성 -PpogoServerUrl 또는 환경변수 POGO_SERVER_URL, 기본은 운영 도메인 (앱 설정 화면에서 변경 가능)
val serverUrl: String = (project.findProperty("pogoServerUrl") as String?) ?: System.getenv("POGO_SERVER_URL") ?: "https://pogo-doctor.vercel.app"

android {
    namespace = "com.pogodoctor.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.pogodoctor.app"
        minSdk = 29          // Android 10+ (테스트 기기 Galaxy A90 5G = Android 12)
        targetSdk = 35
        versionCode = (System.getenv("APP_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("APP_VERSION_NAME") ?: "0.1.0"
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"$serverUrl\"")
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(envKsPath!!)
                storePassword = envKsPass
                keyAlias = envKeyAlias
                keyPassword = envKeyPass ?: envKsPass
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
        debug { applicationIdSuffix = ".debug" }
    }

    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    packaging { resources.excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1") }
    lint { abortOnError = true; warningsAsErrors = false }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    implementation(project(":core"))
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-service:2.8.7")
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    // 기기 내부 OCR (한국어). 모델이 APK 에 번들됨 — 네트워크 불필요
    implementation("com.google.mlkit:text-recognition-korean:16.0.1")
    // 기기 토큰 암호화 저장 (Android Keystore 기반)
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
