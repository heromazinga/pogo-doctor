package com.pogodoctor.app

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// 4-D 스캔 모드 표시명
private fun scanModeLabel(m: String) = when (m) { "shadow" -> "섀도"; "purified" -> "정화"; else -> "일반" }

// 4-E 첫 화면(카드 4개): 연결 상태 / 연속 스캔(모드 선택 시작·중지) / 정리(박사행·태그 목록) / 웹 열기. 나머지는 "고급 설정"(접힘).
// 사용자 흐름: 스캔 → 정리 목록에서 복사 → 게임 검색창 붙여넣기 → 수 확인 → 전체 선택 → 보내기. 게임 조작 없음.
class MainActivity : ComponentActivity() {
    private lateinit var prefs: Prefs
    private lateinit var api: Api
    private lateinit var repo: DataRepo
    private var status by mutableStateOf("")
    private var paired by mutableStateOf(false)
    private var running by mutableStateOf(false)
    private var scanning by mutableStateOf(false)

    private val projectionLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == RESULT_OK && r.data != null) {
            val i = Intent(this, CaptureService::class.java).putExtra(CaptureService.EXTRA_RESULT_CODE, r.resultCode).putExtra(CaptureService.EXTRA_RESULT_DATA, r.data)
            ContextCompat.startForegroundService(this, i)
            running = true; status = "오버레이 실행 중 — 아래에서 스캔 모드를 골라 시작하거나, 포켓몬GO 위의 ⚡ 버튼 메뉴를 쓰세요"
        } else status = "화면 캡처 권한이 거부되었습니다"
    }
    private val notifLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this); api = Api(prefs); repo = DataRepo(this, prefs)
        paired = prefs.isPaired
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        setContent { Surface(Modifier.fillMaxSize(), color = Color(0xFF0F2035)) { MaterialTheme(colorScheme = darkColorScheme()) { Screen() } } }
    }

    override fun onResume() { super.onResume(); running = CaptureService.running; scanning = CaptureService.scanning; paired = prefs.isPaired }

    private fun startCapture() {
        if (!Settings.canDrawOverlays(this)) {
            status = "다른 앱 위에 표시 권한을 허용한 뒤 다시 누르세요"
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))); return
        }
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projectionLauncher.launch(mpm.createScreenCaptureIntent())
    }
    // Android 13+: 시스템 대화상자로 타일 추가 요청 (그 이하는 사용자가 빠른 설정 편집에서 직접 추가)
    private fun requestAddTile() {
        if (Build.VERSION.SDK_INT < 33) return
        val sbm = getSystemService(android.app.StatusBarManager::class.java)
        sbm.requestAddTileService(android.content.ComponentName(this, CaptureTileService::class.java), "포고박사 캡처", android.graphics.drawable.Icon.createWithResource(this, R.drawable.ic_notif), mainExecutor) { r ->
            status = when (r) { android.app.StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED -> "타일이 추가되었습니다"; android.app.StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED -> "이미 추가된 타일입니다"; else -> "타일 추가 안 됨 (코드 $r) — 빠른 설정 편집에서 직접 추가" }
        }
    }
    private fun stopCapture() { startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_STOP)); running = false; scanning = false; status = "오버레이 중지됨" }
    // 4-E: 모드를 정해 연속 스캔 시작 (세션이 끝나면 서비스가 모드를 일반으로 되돌림)
    private fun startScan(mode: String) {
        startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_SCAN_START).putExtra(CaptureService.EXTRA_MODE, mode))
        scanning = true; status = "연속 스캔 시작(${scanModeLabel(mode)}) — 포켓몬GO 평가 화면으로" + (if (mode != "normal") ". 게임 검색 \"${scanModeLabel(mode)}\" 로 먼저 거르세요" else "")
    }
    private fun stopScan() { startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_SCAN_STOP)); scanning = false; status = "연속 스캔 중지 (모드 일반으로 복귀)" }
    private fun openCleanup(kind: String) = startActivity(Intent(this, CleanupActivity::class.java).putExtra(CleanupActivity.EXTRA_KIND, kind))

    @Composable
    private fun Screen() {
        var code by remember { mutableStateOf("") }
        var deviceName by remember { mutableStateOf(prefs.deviceName) }
        var busy by remember { mutableStateOf(false) }
        var advanced by remember { mutableStateOf(false) }
        val scroll = rememberScrollState()
        val dim = Color(0xFF8899AA)

        Column(Modifier.fillMaxSize().verticalScroll(scroll).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("⚡ 포고박사 수집기", fontSize = 24.sp, color = Color(0xFF00D4AA))
            Text("화면을 읽고 보여주기만 합니다. 게임을 대신 조작하지 않습니다. 흐름: 스캔 → 정리 목록에서 복사 → 게임 검색창 붙여넣기 → 수 확인 → 전체 선택 → 보내기", fontSize = 12.sp, color = dim)
            if (status.isNotBlank()) Text(status, fontSize = 13.sp, color = Color(0xFFFFD93D))

            // ① 연결 상태
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (paired) "✅ 기기 연결됨 (${prefs.deviceName})" else "🔗 기기 연결 필요", fontSize = 16.sp)
                    if (!paired) {
                        Text("웹 포고박사 상태줄의 \"📱 기기 연결\" → 코드 발급 → 아래에 입력 (10분 안에)", fontSize = 12.sp, color = dim)
                        OutlinedTextField(value = deviceName, onValueChange = { deviceName = it }, label = { Text("기기 이름") }, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(value = code, onValueChange = { code = it.uppercase() }, label = { Text("연결 코드 (8자리)") }, modifier = Modifier.fillMaxWidth())
                        Button(enabled = !busy && code.replace(Regex("[\\s-]"), "").length == 8, onClick = {
                            busy = true; prefs.deviceName = deviceName.ifBlank { Build.MODEL }
                            lifecycleScope.launch {
                                try { val n = withContext(Dispatchers.IO) { api.pair(code) }; paired = true; status = "연결 완료: $n"; code = "" }
                                catch (e: Exception) { status = "연결 실패: ${e.message}" }
                                busy = false
                            }
                        }) { Text(if (busy) "연결 중…" else "연결하기") }
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(enabled = !busy, onClick = { busy = true; lifecycleScope.launch { try { val s = withContext(Dispatchers.IO) { api.status() }; status = "연결 정상 · 내 목록 ${s.optInt("pokemonCount", -1)}마리" } catch (e: Exception) { status = "연결 확인 실패: ${e.message}"; paired = prefs.isPaired }; busy = false } }) { Text("연결 확인") }
                        }
                    }
                }
            }

            // ② 연속 스캔 (오버레이 + 모드 선택 시작)
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    var scanMode by remember { mutableStateOf(prefs.scanMode) }
                    Text(if (scanning) "📷 연속 스캔 중 (${scanModeLabel(scanMode)})" else if (running) "📷 연속 스캔 — 오버레이 실행 중" else "📷 연속 스캔 — 오버레이 꺼짐", fontSize = 16.sp)
                    if (!running) {
                        Text("1) 다른 앱 위에 표시 허용 → 2) 화면 캡처 허용. 그 뒤 포켓몬GO 평가 화면(막대 3개)을 넘기기만 하면 자동으로 읽어 서버 스캔 기록에 남깁니다(자동 저장 없음). 포켓몬GO 위의 ⚡ 버튼을 누르면 메뉴(스캔 시작/중지 · 1장 캡처 · 박사행/태그 복사)가 뜹니다.", fontSize = 12.sp, color = dim)
                        Button(onClick = { startCapture() }) { Text("오버레이 시작") }
                    } else if (scanning) {
                        if (scanMode != "normal") Text("${CaptureService.modeEmoji(scanMode)} ${scanModeLabel(scanMode)} 모드 — 기록이 ${scanModeLabel(scanMode)} 개체로 저장됩니다. 세션이 끝나면 일반으로 돌아갑니다.", fontSize = 14.sp, color = Color(0xFFFFD93D))
                        Button(onClick = { stopScan(); scanMode = "normal" }) { Text("스캔 중지") }
                    } else {
                        Text("모드를 골라 시작하세요. 섀도/정화는 게임 검색으로 먼저 거른 뒤 스캔합니다(세션이 끝나면 일반으로 복귀). 이로치·배경·XXL·XXS·코스튬·다이맥스는 박사행 보호 조건이 지킵니다.", fontSize = 12.sp, color = dim)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(enabled = paired, onClick = { scanMode = "normal"; startScan("normal") }) { Text("일반 스캔 시작") }
                            OutlinedButton(enabled = paired, onClick = { scanMode = "shadow"; startScan("shadow") }) { Text("👤 섀도") }
                            OutlinedButton(enabled = paired, onClick = { scanMode = "purified"; startScan("purified") }) { Text("✨ 정화") }
                        }
                        OutlinedButton(onClick = { stopCapture() }) { Text("오버레이 중지") }
                    }
                    if (running && !paired) Text("스캔 기록은 서버에 남으므로 기기 연결이 필요합니다", fontSize = 11.sp, color = Color(0xFFFF6B6B))
                    if (prefs.lastScanReport.isNotBlank()) Text("최근 세션: ${prefs.lastScanReport}", fontSize = 10.sp, color = dim)
                    val q = remember { ScanQueue(this@MainActivity, prefs) }
                    var qPending by remember { mutableStateOf(q.pending) }
                    if (qPending > 0) {
                        Text("전송 대기열 ${qPending}건 (앱 종료 후에도 보존됨)", fontSize = 11.sp, color = Color(0xFFFFD93D))
                        OutlinedButton(enabled = paired, onClick = { q.onChange = { runOnUiThread { qPending = q.pending } }; q.start(lifecycleScope); status = "대기열 전송 시작" }) { Text("지금 재전송") }
                    }
                }
            }

            // ③ 정리 (박사행 묶음 목록 · 태그 목록)
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("🧹 정리 (박사행 · 태그)", fontSize = 16.sp)
                    Text("판정 결과를 포켓몬GO 검색어로 만들어 복사합니다. 목록에서 줄을 누르면 복사 → 게임 검색창에 붙여넣기 → 결과 수가 예상과 맞을 때만 전체 선택 → 보내기/태그 → 박사행은 목록에서 \"보냄\" 처리. 스캔 중에는 알림·⚡ 메뉴에서도 열립니다.", fontSize = 12.sp, color = dim)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = paired, onClick = { openCleanup(CleanupActivity.KIND_TRANSFER) }) { Text("❌ 박사행 목록") }
                        OutlinedButton(enabled = paired, onClick = { openCleanup(CleanupActivity.KIND_TAG) }) { Text("🏷 태그 목록") }
                    }
                    // 4-C.2/4-D3: 박사행 검색어에는 보호 조건(&!#&!색이 다른&!반짝반짝&!xxl&!xxs&!배경&!특별&!다이맥스)이 항상 붙는다(옵션 없음)
                    Text("🛡 박사행 검색어에는 보호 조건(태그·이로치·반짝반짝·XXL·XXS·배경·코스튬·다이맥스 제외)이 항상 붙습니다 → 게임 결과 ≤ 예상 N마리. 적으면 보호 대상이 빠진 것, 많으면 보내지 마세요. 박사행은 되돌릴 수 없습니다.", fontSize = 11.sp, color = dim)
                }
            }

            // ④ 웹 열기 (내 보관함)
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("📦 내 보관함 (웹)", fontSize = 16.sp)
                    Text(if (paired) "스캔 기록 전체를 판정·태그·개체값과 함께 보고 검색·필터합니다. 앱 계정으로 자동 로그인됩니다." else "기기 연결 후에는 앱 계정으로 자동 로그인됩니다. 연결 전에는 익명으로 열립니다.", fontSize = 12.sp, color = dim)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { startActivity(Intent(this@MainActivity, WebActivity::class.java)) }) { Text("앱에서 열기") }
                        // 4-E.2: 크롬(기본 브라우저)으로 열기 — 1회용 웹 로그인 코드를 발급해 URL 해시로 넘기면 웹이 즉시 교환하고 history.replaceState 로 지운다(코드는 서버 로그·URL 에 남지 않음)
                        OutlinedButton(enabled = !busy, onClick = {
                            busy = true
                            lifecycleScope.launch {
                                val url = try {
                                    if (!paired) prefs.serverUrl + "/" else {
                                        val r = withContext(Dispatchers.IO) { api.webLoginCode() }
                                        val c = r.optString("code", ""); val uid = r.optString("userId", "")
                                        if (c.isBlank()) prefs.serverUrl + "/" else prefs.serverUrl + "/#applogin=" + Uri.encode(c) + (if (uid.isNotBlank()) "&uid=" + Uri.encode(uid) else "")
                                    }
                                } catch (e: Exception) { status = "웹 로그인 코드 발급 실패: ${e.message} — 익명으로 엽니다"; paired = prefs.isPaired; prefs.serverUrl + "/" }
                                val view = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                val chrome = Intent(view).setPackage("com.android.chrome")
                                try { startActivity(chrome) } catch (_: Exception) { try { startActivity(view) } catch (e: Exception) { status = "브라우저를 열지 못했습니다: ${e.message}" } }
                                busy = false
                            }
                        }) { Text("크롬에서 열기") }
                    }
                }
            }

            // ⑤ 고급 설정 (접힘)
            OutlinedButton(onClick = { advanced = !advanced }) { Text(if (advanced) "⚙ 고급 설정 접기" else "⚙ 고급 설정 (서버 주소·디버그·게임 태그 이름·보관함 여유·연결 해제 …)") }
            if (advanced) Advanced(busy, { busy = it })

            Spacer(Modifier.height(24.dp))
            Text("v${BuildConfig.VERSION_NAME} · 기기 토큰은 Android Keystore 로 암호화 저장 · 이미지는 기기 밖으로 나가지 않음", fontSize = 10.sp, color = Color(0xFF576574))
        }
    }

    @Composable
    private fun Advanced(busy: Boolean, setBusy: (Boolean) -> Unit) {
        var server by remember { mutableStateOf(prefs.serverUrl) }
        var debug by remember { mutableStateOf(prefs.debugMode) }
        var delayMs by remember { mutableStateOf(prefs.captureDelayMs.toString()) }
        var storageMode by remember { mutableStateOf(prefs.storageMode) }
        var scanMs by remember { mutableStateOf(prefs.scanIntervalMs.toString()) }
        var scanStrip by remember { mutableStateOf(prefs.scanStrip) }
        var stableMs by remember { mutableStateOf(prefs.scanStableMs.toString()) }
        var scanVibrate by remember { mutableStateOf(prefs.scanVibrate) }
        var debugMax by remember { mutableStateOf(prefs.scanDebugMax.toString()) }
        var gameTagNames by remember { mutableStateOf(prefs.gameTagNames) }
        var webCode by remember { mutableStateOf("") }
        var log by remember { mutableStateOf("") }
        val dim = Color(0xFF8899AA)
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("⚙ 고급 설정", fontSize = 16.sp)
                if (paired) {
                    Text("웹 세션을 잃었을 때(브라우저 종료·시크릿 창): 아래 코드를 웹 \"📱 기기 연결 → 앱 코드로 로그인\" 에 입력하면 이 계정으로 돌아갑니다 (10분, 1회). PC 브라우저에서도 같은 계정을 쓸 수 있습니다.", fontSize = 12.sp, color = dim)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !busy, onClick = { setBusy(true); lifecycleScope.launch { try { val r = withContext(Dispatchers.IO) { api.webLoginCode() }; webCode = r.optString("code", ""); status = "웹 로그인 코드 발급 (10분 유효)" } catch (e: Exception) { status = "코드 발급 실패: ${e.message}"; paired = prefs.isPaired }; setBusy(false) } }) { Text("🔑 웹 로그인 코드") }
                        OutlinedButton(onClick = { prefs.deviceToken = null; paired = false; status = "이 기기의 토큰을 지웠습니다 (웹에서도 해제하세요)" }) { Text("연결 끊기") }
                    }
                    if (webCode.isNotBlank()) Text("${webCode.take(4)} ${webCode.drop(4)}", fontSize = 30.sp, color = Color(0xFF00D4AA))
                }
                OutlinedTextField(value = server, onValueChange = { server = it }, label = { Text("서버 주소") }, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { prefs.serverUrl = server; status = "서버 주소 저장: ${prefs.serverUrl}" }) { Text("저장") }
                    OutlinedButton(enabled = !busy, onClick = { setBusy(true); lifecycleScope.launch { try { val d = withContext(Dispatchers.IO) { repo.refresh(api, force = true) }; status = "데이터 갱신: 종 ${d.species.size} · 기술명 ${d.allMoveNamesKr.size} (${d.generatedAt ?: "시각 미상"})" } catch (e: Exception) { status = "데이터 갱신 실패: ${e.message}" }; setBusy(false) } }) { Text("데이터 갱신") }
                }
                Text("캐시: " + (repo.loadCached()?.let { "종 ${it.species.size}" } ?: "없음"), fontSize = 12.sp, color = dim)
                Text("📦 보관함 여유 (판정에서 🟡 보류 처리): 여유=모두 보관 · 보통=같은 종·태그 2마리까지 · 빠듯=주력만", fontSize = 12.sp, color = dim)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((k, label) in listOf("relaxed" to "여유", "normal" to "보통", "tight" to "빠듯")) {
                        if (storageMode == k) Button(onClick = { }) { Text(label) } else OutlinedButton(onClick = { prefs.storageMode = k; storageMode = k; status = "보관함 여유: $label" }) { Text(label) }
                    }
                }
                // 4-B6.2 사용자 게임 태그 이름: 평가 화면 칩 판독에 쓰는 목록(띄어쓰기 무시 비교). 추천 태그 이름은 항상 인식
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = gameTagNames, onValueChange = { gameTagNames = it }, label = { Text("내 게임 태그 이름 (쉼표 구분, 추천 태그 이름은 항상 인식)") }, modifier = Modifier.weight(1f))
                    OutlinedButton(modifier = Modifier.padding(top = 8.dp), onClick = { prefs.gameTagNames = gameTagNames; gameTagNames = prefs.gameTagNames; status = "게임 태그 ${prefs.gameTagList.size}개 저장" }) { Text("저장") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = delayMs, onValueChange = { delayMs = it.filter { ch -> ch.isDigit() } }, label = { Text("타일 캡처 지연(ms, 100~5000)") }, modifier = Modifier.weight(1f))
                    OutlinedButton(modifier = Modifier.padding(top = 8.dp), onClick = { prefs.captureDelayMs = delayMs.toIntOrNull() ?: 800; delayMs = prefs.captureDelayMs.toString(); status = "캡처 지연 ${prefs.captureDelayMs}ms 저장" }) { Text("저장") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = scanMs, onValueChange = { scanMs = it.filter { ch -> ch.isDigit() } }, label = { Text("연속 스캔 프레임 간격(ms, 250~2000)") }, modifier = Modifier.weight(1f))
                    OutlinedButton(modifier = Modifier.padding(top = 8.dp), onClick = { prefs.scanIntervalMs = scanMs.toIntOrNull() ?: 400; scanMs = prefs.scanIntervalMs.toString(); status = "스캔 간격 ${prefs.scanIntervalMs}ms 저장" }) { Text("저장") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = stableMs, onValueChange = { stableMs = it.filter { ch -> ch.isDigit() } }, label = { Text("연속 스캔 안정 대기(ms, 200~3000)") }, modifier = Modifier.weight(1f))
                    OutlinedButton(modifier = Modifier.padding(top = 8.dp), onClick = { prefs.scanStableMs = stableMs.toIntOrNull() ?: 400; stableMs = prefs.scanStableMs.toString(); status = "안정 대기 ${prefs.scanStableMs}ms 저장" }) { Text("저장") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = debugMax, onValueChange = { debugMax = it.filter { ch -> ch.isDigit() } }, label = { Text("디버그 업로드 상한(세션당, 0~200)") }, modifier = Modifier.weight(1f))
                    OutlinedButton(modifier = Modifier.padding(top = 8.dp), onClick = { prefs.scanDebugMax = debugMax.toIntOrNull() ?: 20; debugMax = prefs.scanDebugMax.toString(); status = "디버그 업로드 상한 ${prefs.scanDebugMax}장 저장" }) { Text("저장") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("연속 스캔 기록 시 진동 (새 기록에만)", fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
                    Switch(checked = scanVibrate, onCheckedChange = { scanVibrate = it; prefs.scanVibrate = it })
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("연속 스캔 상단 띠 표시 (삼성 게임 부스터를 끄면 포켓몬GO 위에서도 보임. 안 보이면 알림 한 줄만)", fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
                    Switch(checked = scanStrip, onCheckedChange = { scanStrip = it; prefs.scanStrip = it })
                }
                Text("📱 포켓몬GO 위에서 떠 있는 창(⚡ 버튼·메뉴·띠)이 숨겨지면(삼성 게임 부스터) 게임 부스터를 끄거나, 빠른 설정 타일 \"포고박사 캡처\"(1장 캡처, ${prefs.captureDelayMs}ms 지연)·\"포고박사 연속 스캔\"(켜기/끄기)과 알림 버튼을 쓰세요. 타일 추가: 빠른 설정 편집에서 끌어다 놓기.", fontSize = 12.sp, color = dim)
                if (Build.VERSION.SDK_INT >= 33) OutlinedButton(onClick = { requestAddTile() }) { Text("타일 추가 요청 (Android 13+)") }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("디버그 모드 (인식 텍스트·결과를 기기에 기록 + 캡처를 서버에 업로드(포획 장소 줄 가림), 7일 보관)", fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
                    Switch(checked = debug, onCheckedChange = { debug = it; prefs.debugMode = it })
                }
                if (debug) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { log = DebugLog.asText(this@MainActivity) }) { Text("로그 보기") }
                        OutlinedButton(onClick = { val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager; cm.setPrimaryClip(ClipData.newPlainText("pogo-debug", DebugLog.asText(this@MainActivity))); status = "로그를 클립보드에 복사했습니다" }) { Text("복사") }
                        OutlinedButton(onClick = { DebugLog.clear(this@MainActivity); log = "" }) { Text("지우기") }
                    }
                    if (log.isNotBlank()) Text(log, fontSize = 10.sp, color = Color(0xFFC8D6E5))
                }
                val q = remember { ScanQueue(this@MainActivity, prefs) }
                var rejected by remember { mutableStateOf(q.rejectedCount()) }
                var rejectedText by remember { mutableStateOf("") }
                if (rejected > 0) {
                    Text("서버가 거부한 항목(4xx) ${rejected}건 — 재전송하지 않음(최근 50건 보관)", fontSize = 11.sp, color = Color(0xFFFF6B6B))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { rejectedText = q.rejectedText() }) { Text("보기") }
                        OutlinedButton(onClick = { q.clearRejected(); rejected = 0; rejectedText = "" }) { Text("지우기") }
                    }
                    if (rejectedText.isNotBlank()) Text(rejectedText, fontSize = 9.sp, color = Color(0xFFC8D6E5))
                }
            }
        }
    }
}
