// 루트: 플러그인 버전은 settings.gradle.kts 의 pluginManagement 에서 선언
tasks.register("clean", Delete::class) { delete(rootProject.layout.buildDirectory) }
