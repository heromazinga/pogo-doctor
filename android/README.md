# 포고박사 수집기 (안드로이드, 3-1 MVP)

포켓몬GO 위에 떠 있는 ⚡ 버튼을 누르면 **현재 화면 1장**을 캡처해 기기 안에서 글자를 읽고(ML Kit 한국어 OCR), 종·CP·HP·기술·개체값(후보)을 결과 카드로 보여준다. "보관 / 박사행" 을 누르면 웹앱 내 목록(`my_pokemon`, `source='overlay'`)에 저장된다.

## 절대 규칙
- 화면을 **읽고 보여주기만** 한다. 접근성 서비스·자동 터치·스와이프 없음(권한 자체를 선언하지 않음).
- 포켓몬GO 계정·게임 서버 통신에 관여하지 않는다. 루팅 불필요.
- 비밀값 없음. 앱은 3-0 보완의 **기기 토큰**만 사용하며 Android Keystore(EncryptedSharedPreferences)로 암호화 저장한다. 캡처 이미지는 기기 밖으로 나가지 않는다.

## 구조
```
android/
  core/   순수 JVM Kotlin (Android 의존 없음): Cpm(CP 배율·CP·HP 공식, 웹 cpm.js 와 동일), IvCalc(CP·HP → 개체값 후보 전수 조사),
          Fuzzy(한국어 이름·기술 유사도), ScreenParser(OCR 줄 → 상세/평가 화면 정보), BarReader(평가 막대 판독), Verdict(한줄평)
          → SDK 없이 `./gradlew :core:test` 로 검증 (테스트 8건)
  app/    Android: MainActivity(Compose 설정: 기기 연결 코드, 서버 주소, 오버레이 시작/중지, 데이터 갱신, 디버그 로그),
          CaptureService(Foreground + MediaProjection + 오버레이 버튼/결과 카드), Ocr(ML Kit Korean), Api(/api/device/*), DataRepo(/api/pokemon-data 캐시), Prefs, DebugLog
```
`settings.gradle.kts` 는 `ANDROID_HOME`/`local.properties` 가 있을 때만 `:app` 을 포함한다.

## 빌드·배포 (USB·로컬 PC 없이)
- GitHub Actions `.github/workflows/android.yml`: `android/**` 변경 시 실행. `:core:test` → `:app:assembleRelease` → APK 를 Actions 산출물로 업로드, `main` 푸시 시 GitHub Release(`android-v0.1.<run>`)에 첨부.
- **서명 keystore (사용자 등록)**: `bash android/scripts/make-keystore.sh` 로 1회 생성 후 GitHub → Settings → Secrets and variables → Actions 에 `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` 등록. 없으면 debug 키로 서명되어(경고 출력) 기존 설치 위에 업데이트할 수 없다.
- 서버 주소: Actions Variables `POGO_SERVER_URL`(없으면 `https://pogo-doctor.vercel.app`). 앱 설정 화면에서도 변경 가능.
- 설치: Release 의 APK 링크를 A90 브라우저로 열어 설치("출처를 알 수 없는 앱" 허용).

## 3-1 보완: 포켓몬GO 위에서는 오버레이 창이 숨겨짐 → 빠른 설정 타일
실기기(A90, Android 12) 결과: 기기 연결·오버레이 버튼은 다른 앱 위에서 정상이지만, **포켓몬GO 가 포그라운드인 동안 `TYPE_APPLICATION_OVERLAY` 창(버튼·결과 카드)이 숨겨진다**(포그라운드 서비스·알림은 유지, 포켓몬GO 에서 나오면 다시 보임). `Window.setHideOverlayWindows(true)`(Android 12+) 또는 삼성 게임 부스터로 추정. 그래서 포켓몬GO 위에서는 오버레이를 쓰지 않는 경로를 추가했다.
- **트리거**: 빠른 설정 타일 "포고박사 캡처"(`CaptureTileService`) 또는 포그라운드 알림의 "캡처" 액션 → 투명 트램펄린 액티비티(`TrampolineActivity`, 시작만으로 알림창이 닫힘) → 서비스에 지연 캡처 요청 → 기본 800ms(설정에서 100~5000ms) 뒤 1장 캡처. 서비스 미실행이면 타일은 비활성 표시, 탭하면 앱이 열린다.
- **결과 표시**: 반투명 대화상자형 `ResultActivity`(`Theme.Material.Dialog.NoActionBar`, 별도 task, 최근 앱 제외, noHistory). 내용·버튼(보관/박사행/닫기, 종 후보)은 오버레이 카드와 같은 `ResultCard` 를 공용. 닫으면 포켓몬GO 로 복귀. 백그라운드 액티비티 시작은 포그라운드 서비스 + `SYSTEM_ALERT_WINDOW` 권한 예외로 허용된다.
- **오버레이 버튼은 유지**(다른 앱 위에서 사용). 앱 첫 화면에 타일 안내·추가 방법, Android 13+ 에서는 `requestAddTileService` 버튼.
- **검은 화면 판정**: 캡처 이미지의 격자 샘플 평균 밝기가 12/255 이하이면 "캡처가 차단됨(검은 화면)" 으로 결과 화면에 표시하고 디버그 로그(`blocked`)에 기록.
- **원인 판별 근거**: 디버그 모드에서 오버레이 버튼 뷰의 `onWindowVisibilityChanged`(`overlay` 항목)와 타일 캡처 시점의 `windowVisibility/isShown/attached`(`trigger` 항목)를 로그에 남긴다. 포켓몬GO 진입 시 `INVISIBLE/GONE` 로 바뀌면 시스템이 창을 숨긴 것(setHideOverlayWindows 계열)이고, `VISIBLE` 인데 화면에 안 보이면 게임 부스터 등 다른 계층의 가림이다.
- 접근성 서비스·자동 입력(볼륨키 트리거 포함)은 쓰지 않는다.

## 4-0 앱 내 웹 화면
앱 첫 화면 "🌐 포고박사 열기" → WebView 로 웹앱을 열고 기기 토큰 기반 1회용 코드로 자동 로그인(URL 해시, 화면 미표시). 우리 도메인만 WebView, 외부 링크는 브라우저. 상세: 루트 README "4-0".

## 3-1c 보완
- **웹 로그인 코드**: 앱 "🔑 웹 로그인 코드" → 웹 "📱 기기 연결 → 앱 코드로 로그인" (웹 세션 복구).
- **상세+평가 병합**: 평가 캡처가 3분 이내 직전 상세와 CP·이름이 같으면 합쳐 표시·저장("상세+평가 합침").
- **막대 재보정**: 라벨 상대 좌표(아래 띠·오른쪽) 샘플링, 빨강 가득 = 15, 별 개수 합계 제약, 모순 시 후보 유지 + "불확실" 표시.
- **강화 비용 → 레벨**: 하단 별의모래·사탕·XL 로 레벨 목록을 좁힘 (`PowerUp.kt`, PokeMiners 표).
- **디버그 업로드**: 디버그 모드에서 캡처(상태바·트레이너 영역 가림, 720px JPEG)+OCR+판독값을 서버로. 웹 디버그 패널에서 확인, 7일 후 삭제.

## 사용 순서 (Galaxy A90 5G, Android 12)
1. 웹 포고박사 상태줄 "📱 기기 연결" → 코드 발급(10분, 1회).
2. 앱 실행 → 기기 이름·코드 입력 → "연결하기" (토큰 저장). 연결 전에도 분석은 되고 저장만 막힌다.
3. "오버레이 시작" → "다른 앱 위에 표시" 허용 → 화면 캡처 허용(알림 표시).
4. 포켓몬GO 포켓몬 상세 화면에서 빠른 설정 타일 "포고박사 캡처"(또는 알림 "캡처") → 결과 화면(종·CP·HP·기술·개체값 후보·한줄평). 이름 인식이 불확실하면 종 후보 3개 버튼.
5. 평가(감정) 화면에서 타일 한 번 더 → 막대 3개 판독으로 개체값 확정(상세 화면 결과와 합침).
6. "보관" / "박사행" → 웹 내 목록에 즉시 표시(`memo: 수집기 · …`).

## 인식 방법
- OCR: ML Kit `text-recognition-korean` (기기 내부). 줄 텍스트 + 좌표.
- CP: `CP 1234` 또는 `CP` 줄 다음 숫자 줄. HP: `HP 120 / 120` 의 최대치.
- 이름: CP 줄 아래 ~ HP 줄 위의 한글 줄 중 서버 종 목록과 유사도(레벤슈타인) 최고. 0.6 미만이면 "불확실" + 후보 3개.
- 기술: HP 줄 아래 줄을 종의 한국어 기술 목록과 유사도 0.7 이상 매칭(최대 3개). 저장 시 영어 ID 로 변환(첫 번째를 빠른기술로 가정).
- 개체값: 레벨 1~51(0.5) × 16³ 전수 조사로 CP·HP 일치 조합. 유일하면 확정, 아니면 범위 표시 + 메모에 `개체값 후보 a~b%`.
- 평가 막대: "공격/방어/HP" 라벨 오른쪽을 가로로 훑어 채워진(채도 높은 주황) 픽셀 비율 × 15. 색 임계값은 실기기 표본으로 조정 필요.
- 한줄평: 기기 내 결정적 공식(레이드 공격 IV·리그 1500/2500 도달 레벨). AI 미사용.

## 디버그 모드
설정에서 켜면 캡처마다 OCR 텍스트·인식 결과·오류를 기기 파일에 기록(최대 30건, 이미지·토큰 미포함). "로그 보기/복사" 로 확인. 서버 업로드·웹 디버그 화면은 후속(3-0 보완 병합 후 별도 테이블 필요).

## 이 환경에서 검증한 것 / 못한 것
- 검증: `./gradlew :core:test` 8/8 (CPM·CP 공식이 웹과 동일, 개체값 후보·평가 필터, 유사도 보정, 상세/평가 화면 파싱, CP 줄 분리·닉네임, 막대 판독 비율, 한줄평).
- 미검증(근거): 이 환경은 Android SDK 가 없고 `https://dl.google.com/` 이 차단(`curl` 응답 코드 000)되어 `:app` 컴파일·APK 빌드가 불가. 앱 모듈 빌드는 GitHub Actions 에서 확인해야 한다. 실기기 오버레이·캡처·OCR 정확도(표본 30마리)는 A90 에서 측정.
