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

// 설정 화면: 기기 연결(코드 입력), 서버 주소, 오버레이·캡처 시작/중지, 데이터 갱신, 디버그 로그
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
            running = true; status = "실행 중 — 포켓몬GO 로 이동해 ⚡ 버튼을 누르세요"
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
    private fun stopCapture() { startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_STOP)); running = false; status = "중지됨" }

    @Composable
    private fun Screen() {
        var code by remember { mutableStateOf("") }
        var server by remember { mutableStateOf(prefs.serverUrl) }
        var deviceName by remember { mutableStateOf(prefs.deviceName) }
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
        var busy by remember { mutableStateOf(false) }
        var log by remember { mutableStateOf("") }
        val scroll = rememberScrollState()

        Column(Modifier.fillMaxSize().verticalScroll(scroll).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("⚡ 포고박사 수집기", fontSize = 24.sp, color = Color(0xFF00D4AA))
            Text("화면을 읽고 보여주기만 합니다. 게임을 대신 조작하지 않습니다.", fontSize = 12.sp, color = Color(0xFF8899AA))
            if (status.isNotBlank()) Text(status, fontSize = 13.sp, color = Color(0xFFFFD93D))

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("🌐 포고박사 (내 목록 · 팀 추천)", fontSize = 16.sp)
                    Text(if (paired) "앱 계정으로 자동 로그인됩니다. 브라우저를 따로 쓰지 않아도 됩니다." else "기기 연결 후에는 앱 계정으로 자동 로그인됩니다. 연결 전에는 익명으로 열립니다.", fontSize = 12.sp, color = Color(0xFF8899AA))
                    Button(onClick = { startActivity(Intent(this@MainActivity, WebActivity::class.java)) }) { Text("포고박사 열기") }
                    Text("PC 등 다른 기기의 브라우저에서는 아래 \"웹 로그인 코드\" 로 같은 계정에 들어갈 수 있고, 브라우저 메뉴의 \"홈 화면에 추가\" 로 앱처럼 쓸 수 있습니다.", fontSize = 11.sp, color = Color(0xFF576574))
                }
            }

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (paired) "✅ 기기 연결됨 (${prefs.deviceName})" else "🔗 기기 연결 필요", fontSize = 16.sp)
                    Text("웹 포고박사 상태줄의 \"📱 기기 연결\" → 코드 발급 → 아래에 입력 (10분 안에)", fontSize = 12.sp, color = Color(0xFF8899AA))
                    if (!paired) {
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
                            OutlinedButton(onClick = { prefs.deviceToken = null; paired = false; status = "이 기기의 토큰을 지웠습니다 (웹에서도 해제하세요)" }) { Text("연결 끊기") }
                        }
                        Text("웹 세션을 잃었을 때(브라우저 종료·시크릿 창): 아래 코드를 웹 \"📱 기기 연결 → 앱 코드로 로그인\" 에 입력하면 이 계정으로 돌아갑니다 (10분, 1회).", fontSize = 12.sp, color = Color(0xFF8899AA))
                        Button(enabled = !busy, onClick = { busy = true; lifecycleScope.launch { try { val r = withContext(Dispatchers.IO) { api.webLoginCode() }; webCode = r.optString("code", ""); status = "웹 로그인 코드 발급 (10분 유효)" } catch (e: Exception) { status = "코드 발급 실패: ${e.message}"; paired = prefs.isPaired }; busy = false } }) { Text("🔑 웹 로그인 코드") }
                        if (webCode.isNotBlank()) Text("${webCode.take(4)} ${webCode.drop(4)}", fontSize = 30.sp, color = Color(0xFF00D4AA))
                    }
                }
            }

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (running) "🟢 오버레이 실행 중" else "⚪ 오버레이 꺼짐", fontSize = 16.sp)
                    Text("1) 다른 앱 위에 표시 허용 → 2) 화면 캡처 허용 → 3) 포켓몬GO 상세 화면에서 캡처(아래 타일 안내). 평가(감정) 화면에서 한 번 더 캡처하면 개체값을 확정합니다. 연결 전에도 분석은 되고 저장만 막힙니다.", fontSize = 12.sp, color = Color(0xFF8899AA))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !running, onClick = { startCapture() }) { Text("오버레이 시작") }
                        OutlinedButton(enabled = running, onClick = { stopCapture() }) { Text("중지") }
                    }
                }
            }

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (scanning) "📷 연속 스캔 중" else "📷 연속 스캔 (4-B)", fontSize = 16.sp)
                    Text("포켓몬GO 평가 화면(막대 3개)을 켜 둔 채 좌우로 넘기기만 하면 자동으로 읽어 서버 \"스캔 기록\" 에 남깁니다(자동 저장 없음 — 웹 내 목록 → 📷 스캔 기록에서 검토 후 저장). 결과 창을 띄우지 않고 알림 한 줄만 갱신합니다(상단 띠는 설정에서 켤 수 있음). CP 가 배너에 가려져도 막대+HP 로 기록하고 이후 CP 를 읽으면 그 기록을 보완합니다. 켜기/끄기: 여기, 알림의 \"연속 스캔\", 빠른 설정 타일 \"포고박사 연속 스캔\".", fontSize = 12.sp, color = Color(0xFF8899AA))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = running && paired, onClick = { startService(Intent(this@MainActivity, CaptureService::class.java).setAction(CaptureService.ACTION_SCAN_TOGGLE)); scanning = !scanning; status = if (scanning) "연속 스캔 시작(${scanModeLabel(prefs.scanMode)}) — 포켓몬GO 평가 화면으로" else "연속 스캔 중지" }) { Text(if (scanning) "스캔 중지" else "연속 스캔 시작") }
                    }
                    // 4-D 스캔 모드: 게임 검색("섀도"/"정화")으로 먼저 거른 뒤 그 모드로 스캔. 섀도 모드는 is_shadow=true 로 기록(섀도 판정). 타일·알림으로 시작해도 이 설정을 쓴다
                    var scanMode by remember { mutableStateOf(prefs.scanMode) }
                    Text("스캔 모드(시작 전 선택): 게임 검색으로 섀도/정화만 거른 뒤 해당 모드로 스캔하세요. 이로치·배경·XXL 은 박사행 보호 조건이 지키고, 코스튬은 태그로 보호. 한국어판 \"섀도\"·\"정화\" 검색어 동작은 확인 필요", fontSize = 11.sp, color = Color(0xFF8899AA))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for ((k, label) in listOf("normal" to "일반", "shadow" to "섀도", "purified" to "정화")) {
                            if (scanMode == k) Button(onClick = { }) { Text(label) } else OutlinedButton(enabled = !scanning, onClick = { prefs.scanMode = k; scanMode = k; status = "스캔 모드: $label" }) { Text(label) }
                        }
                        OutlinedButton(onClick = { startActivity(Intent(this@MainActivity, WebActivity::class.java)) }) { Text("스캔 기록 보기(웹)") }
                    }
                    if (!paired) Text("스캔 기록은 서버에 남으므로 기기 연결이 필요합니다", fontSize = 11.sp, color = Color(0xFFFF6B6B))
                    if (prefs.lastScanReport.isNotBlank()) Text("최근 세션: ${prefs.lastScanReport}", fontSize = 10.sp, color = Color(0xFF8899AA))
                    val q = remember { ScanQueue(this@MainActivity, prefs) }
                    var qPending by remember { mutableStateOf(q.pending) }
                    if (qPending > 0) {
                        Text("전송 대기열 ${qPending}건 (앱 종료 후에도 보존됨)", fontSize = 11.sp, color = Color(0xFFFFD93D))
                        OutlinedButton(enabled = paired, onClick = { q.onChange = { runOnUiThread { qPending = q.pending } }; q.start(lifecycleScope); status = "대기열 전송 시작" }) { Text("지금 재전송") }
                    }
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

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("🧹 정리 도우미 (4-B5/4-B6)", fontSize = 16.sp)
                    Text(CleanupCopier.note, fontSize = 12.sp, color = Color(0xFFFFC46B))
                    Text("판정 결과를 포켓몬GO 검색어로 만들어 복사합니다(게임 조작 없음). 검색창에 붙여넣고 결과 수가 \"예상 N마리\"와 같을 때만 전체 선택 → 박사에게 보내기/태그. 박사행은 되돌릴 수 없으니 수가 다르면 진행하지 마세요. 게임에 이미 태그가 달린 개체(화면 칩 판독)는 대상에서 뺍니다. 스캔 중에는 알림의 \"박사행 복사\"/\"태그 선택\" 으로도 됩니다.", fontSize = 12.sp, color = Color(0xFF8899AA))
                    var cleanupStatus by remember { mutableStateOf(CleanupCopier.status()) }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = paired && !busy, onClick = { busy = true; lifecycleScope.launch { withContext(Dispatchers.IO) { CleanupCopier.refresh(prefs, force = true) }; status = CleanupCopier.copyNextTransfer(this@MainActivity); cleanupStatus = CleanupCopier.status(); busy = false } }) { Text("박사행 검색어 복사") }
                        OutlinedButton(enabled = paired && !busy, onClick = { startActivity(Intent(this@MainActivity, CleanupActivity::class.java)) }) { Text("태그 선택") }
                    }
                    Text("묶음: $cleanupStatus · 자세한 목록·완료 처리는 웹 내 목록 → 🧹 정리 도우미", fontSize = 11.sp, color = Color(0xFF8899AA))
                    // 4-C.2: 박사행 검색어에는 보호 조건(&!#&!색이 다른&!반짝반짝&!xxl&!배경)이 항상 붙는다(옵션 없음). 코스튬은 검색어가 없어 태그로 보호
                    Text("🛡 박사행 검색어에는 보호 조건(태그·이로치·반짝반짝·XXL·배경 제외)이 항상 붙습니다 → 게임 결과 ≤ 예상 N마리. 적으면 보호 대상이 빠진 것, 많으면 보내지 마세요. 코스튬은 태그로 보호하세요.", fontSize = 12.sp, color = Color(0xFF8899AA))
                }
            }

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("📱 포켓몬GO 위에서는 빠른 설정 타일을 쓰세요", fontSize = 16.sp)
                    Text("삼성 게임 부스터가 켜져 있으면 포켓몬GO 위의 떠 있는 창(⚡ 버튼·결과 카드·띠)이 숨겨집니다(사용자 확인). 게임 부스터를 끄면 보입니다. 숨겨지는 경우 화면 위에서 아래로 쓸어내린 빠른 설정의 \"포고박사 캡처\" 타일(또는 알림의 \"캡처\" 버튼)을 누르면 알림창이 닫히고 ${prefs.captureDelayMs}ms 뒤 1장을 캡처해 결과를 반투명 창으로 보여줍니다.", fontSize = 12.sp, color = Color(0xFF8899AA))
                    Text("타일 추가: 빠른 설정 패널 펼치기 → 연필(편집) 또는 ⋮ → 타일 편집 → \"포고박사 캡처\" 를 끌어다 놓기. 타일은 오버레이가 실행 중일 때만 켜집니다.", fontSize = 12.sp, color = Color(0xFF8899AA))
                    if (Build.VERSION.SDK_INT >= 33) {
                        OutlinedButton(onClick = { requestAddTile() }) { Text("타일 추가 요청 (Android 13+)") }
                    }
                }
            }

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("설정", fontSize = 16.sp)
                    OutlinedTextField(value = server, onValueChange = { server = it }, label = { Text("서버 주소") }, modifier = Modifier.fillMaxWidth())
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { prefs.serverUrl = server; status = "서버 주소 저장: ${prefs.serverUrl}" }) { Text("저장") }
                        OutlinedButton(enabled = !busy, onClick = { busy = true; lifecycleScope.launch { try { val d = withContext(Dispatchers.IO) { repo.refresh(api, force = true) }; status = "데이터 갱신: 종 ${d.species.size} · 기술명 ${d.allMoveNamesKr.size} (${d.generatedAt ?: "시각 미상"})" } catch (e: Exception) { status = "데이터 갱신 실패: ${e.message}" }; busy = false } }) { Text("데이터 갱신") }
                    }
                    Text("캐시: " + (repo.loadCached()?.let { "종 ${it.species.size}" } ?: "없음"), fontSize = 12.sp, color = Color(0xFF8899AA))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(value = delayMs, onValueChange = { delayMs = it.filter { ch -> ch.isDigit() } }, label = { Text("타일 캡처 지연(ms, 100~5000)") }, modifier = Modifier.weight(1f))
                        OutlinedButton(modifier = Modifier.padding(top = 8.dp), onClick = { prefs.captureDelayMs = delayMs.toIntOrNull() ?: 800; delayMs = prefs.captureDelayMs.toString(); status = "캡처 지연 ${prefs.captureDelayMs}ms 저장" }) { Text("저장") }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(value = scanMs, onValueChange = { scanMs = it.filter { ch -> ch.isDigit() } }, label = { Text("연속 스캔 프레임 간격(ms, 250~2000)") }, modifier = Modifier.weight(1f))
                        OutlinedButton(modifier = Modifier.padding(top = 8.dp), onClick = { prefs.scanIntervalMs = scanMs.toIntOrNull() ?: 400; scanMs = prefs.scanIntervalMs.toString(); status = "스캔 간격 ${prefs.scanIntervalMs}ms 저장" }) { Text("저장") }
                    }
                    Text("📦 보관함 여유 (판정에서 🟡 보류 처리): 여유=모두 보관 · 보통=같은 종·태그 2마리까지 · 빠듯=주력만", fontSize = 12.sp, color = Color(0xFF8899AA))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for ((k, label) in listOf("relaxed" to "여유", "normal" to "보통", "tight" to "빠듯")) {
                            if (storageMode == k) Button(onClick = { }) { Text(label) } else OutlinedButton(onClick = { prefs.storageMode = k; storageMode = k; status = "보관함 여유: $label" }) { Text(label) }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(value = stableMs, onValueChange = { stableMs = it.filter { ch -> ch.isDigit() } }, label = { Text("연속 스캔 안정 대기(ms, 200~3000)") }, modifier = Modifier.weight(1f))
                        OutlinedButton(modifier = Modifier.padding(top = 8.dp), onClick = { prefs.scanStableMs = stableMs.toIntOrNull() ?: 400; stableMs = prefs.scanStableMs.toString(); status = "안정 대기 ${prefs.scanStableMs}ms 저장" }) { Text("저장") }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(value = debugMax, onValueChange = { debugMax = it.filter { ch -> ch.isDigit() } }, label = { Text("디버그 업로드 상한(세션당, 0~200)") }, modifier = Modifier.weight(1f))
                        OutlinedButton(modifier = Modifier.padding(top = 8.dp), onClick = { prefs.scanDebugMax = debugMax.toIntOrNull() ?: 20; debugMax = prefs.scanDebugMax.toString(); status = "디버그 업로드 상한 ${prefs.scanDebugMax}장 저장" }) { Text("저장") }
                    }
                    // 4-B6.2 사용자 게임 태그 이름: 평가 화면 칩 판독에 쓰는 목록(띄어쓰기 무시 비교). 추천 태그 이름은 항상 인식
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(value = gameTagNames, onValueChange = { gameTagNames = it }, label = { Text("내 게임 태그 이름 (쉼표 구분, 추천 태그 이름은 항상 인식)") }, modifier = Modifier.weight(1f))
                        OutlinedButton(modifier = Modifier.padding(top = 8.dp), onClick = { prefs.gameTagNames = gameTagNames; gameTagNames = prefs.gameTagNames; status = "게임 태그 ${prefs.gameTagList.size}개 저장" }) { Text("저장") }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("연속 스캔 기록 시 진동 (새 기록에만)", fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
                        Switch(checked = scanVibrate, onCheckedChange = { scanVibrate = it; prefs.scanVibrate = it })
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("연속 스캔 상단 띠 표시 (삼성 게임 부스터를 끄면 포켓몬GO 위에서도 보임. 안 보이면 알림 한 줄만)", fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
                        Switch(checked = scanStrip, onCheckedChange = { scanStrip = it; prefs.scanStrip = it })
                    }
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
                }
            }
            Spacer(Modifier.height(24.dp))
            Text("v${BuildConfig.VERSION_NAME} · 기기 토큰은 Android Keystore 로 암호화 저장 · 이미지는 기기 밖으로 나가지 않음", fontSize = 10.sp, color = Color(0xFF576574))
        }
    }
}
