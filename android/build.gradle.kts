// 루트: Kotlin 플러그인은 여기서 한 번만 로드(apply false) — 서브프로젝트마다 로드되면 경고/충돌.
// Android 플러그인은 Google Maven 이 없는 환경(:core 만 빌드)에서도 동작하도록 :app 에서만 적용한다 (버전은 settings.gradle.kts).
plugins {
    id("org.jetbrains.kotlin.jvm") apply false
    id("org.jetbrains.kotlin.android") apply false
    id("org.jetbrains.kotlin.plugin.compose") apply false
}
tasks.register("clean", Delete::class) { delete(rootProject.layout.buildDirectory) }
