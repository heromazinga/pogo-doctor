plugins { id("org.jetbrains.kotlin.jvm") }
// 순수 JVM 모듈 (Android 의존 없음): OCR 텍스트 파싱, 이름·기술 유사도 매칭, CP 배율·개체값 후보 계산
// 로컬(Android SDK 없이)에서도 `gradle :core:test` 로 검증 가능
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
java { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
dependencies {
    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
tasks.test { useJUnitPlatform(); testLogging { events("passed", "failed"); showStandardStreams = true } }
