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
                    Text("포켓몬GO 평가 화면(막대 3개)을 켜 둔 채 좌우로 넘기기만 하면 자동으로 읽어 서버 \"스캔 기록\" 에 남깁니다(자동 저장 없음 — 웹 내 목록 → 📷 스캔 기록에서 검토 후 저장). 결과 창을 띄우지 않고 알림 한 줄·상단 띠만 갱신합니다. 켜기/끄기: 여기, 알림의 \"연속 스캔\", 빠른 설정 타일 \"포고박사 연속 스캔\".", fontSize = 12.sp, color = Color(0xFF8899AA))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = running && paired, onClick = { startService(Intent(this@MainActivity, CaptureService::class.java).setAction(CaptureService.ACTION_SCAN_TOGGLE)); scanning = !scanning; status = if (scanning) "연속 스캔 시작 — 포켓몬GO 평가 화면으로" else "연속 스캔 중지" }) { Text(if (scanning) "스캔 중지" else "연속 스캔 시작") }
                        OutlinedButton(onClick = { startActivity(Intent(this@MainActivity, WebActivity::class.java)) }) { Text("스캔 기록 보기(웹)") }
                    }
                    if (!paired) Text("스캔 기록은 서버에 남으므로 기기 연결이 필요합니다", fontSize = 11.sp, color = Color(0xFFFF6B6B))
                    if (prefs.lastScanReport.isNotBlank()) Text("최근 세션: ${prefs.lastScanReport}", fontSize = 10.sp, color = Color(0xFF8899AA))
                }
            }

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("📱 포켓몬GO 위에서는 빠른 설정 타일을 쓰세요", fontSize = 16.sp)
                    Text("포켓몬GO 는 실행 중 다른 앱의 떠 있는 창을 숨깁니다(Android 12+). 그래서 ⚡ 버튼과 결과 카드는 포켓몬GO 위에서 보이지 않습니다. 대신 화면 위에서 아래로 쓸어내린 빠른 설정의 \"포고박사 캡처\" 타일(또는 알림의 \"캡처\" 버튼)을 누르면 알림창이 닫히고 ${prefs.captureDelayMs}ms 뒤 1장을 캡처해 결과를 반투명 창으로 보여줍니다.", fontSize = 12.sp, color = Color(0xFF8899AA))
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
