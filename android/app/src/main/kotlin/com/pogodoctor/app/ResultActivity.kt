package com.pogodoctor.app

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ScrollView
import android.widget.Toast
import com.pogodoctor.core.ScreenInfo
import com.pogodoctor.core.SpeciesRef
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// 반투명 대화상자형 결과 화면: 포켓몬GO 가 오버레이 창을 숨기는 환경에서 오버레이 카드 대신 사용한다.
// (Theme.Translucent + 별도 task, 최근 앱 제외. 닫으면 포켓몬GO 로 복귀)
class ResultActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var repo: DataRepo
    private lateinit var api: Api
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var container: FrameLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this); repo = DataRepo(this, prefs); api = Api(prefs)
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        window.setGravity(Gravity.BOTTOM)
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND); window.setDimAmount(0.25f)
        container = FrameLayout(this)
        setContentView(ScrollView(this).apply { addView(container) })
        render()
        ResultStore.listener = { runOnUiThread { render() } }
    }

    private fun render() {
        container.removeAllViews()
        val card = ResultCard(this, repo, prefs.isPaired)
        container.addView(card.build(ResultStore.current, object : ResultCard.Actions {
            override fun onChooseSpecies(sp: SpeciesRef) {
                val cur = ResultStore.current as? ResultStore.Result.Screen ?: return
                ResultStore.publish(cur.copy(chosen = sp))
            }
            override fun onSave(info: ScreenInfo, sp: SpeciesRef, c: ResultCard.Computed, status: String) {
                val row = card.buildRow(info, sp, c, status)
                scope.launch {
                    try {
                        withContext(Dispatchers.IO) { api.savePokemon(row) }
                        Toast.makeText(this@ResultActivity, if (status == "keep") "보관에 저장했습니다 — 웹 내 목록에 표시됩니다" else "박사행으로 저장했습니다", Toast.LENGTH_LONG).show()
                        ResultStore.current = null
                        finish()
                    } catch (e: Exception) {
                        DebugLog.add(this@ResultActivity, "save-error", emptyList(), row.toString(), e.toString())
                        Toast.makeText(this@ResultActivity, "저장 실패: ${e.message}", Toast.LENGTH_LONG).show()
                    }
                }
            }
            override fun onClose() { finish() }
        }))
    }

    override fun onDestroy() { if (ResultStore.listener != null) ResultStore.listener = null; scope.cancel(); super.onDestroy() }
    override fun finish() { super.finish(); overridePendingTransition(0, 0) }
}
