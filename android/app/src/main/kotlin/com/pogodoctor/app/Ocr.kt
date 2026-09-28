package com.pogodoctor.app

import android.graphics.Bitmap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.pogodoctor.core.OcrLine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

// ML Kit 한국어 텍스트 인식 (기기 내부 처리, 이미지는 기기 밖으로 나가지 않는다)
object Ocr {
    private val recognizer by lazy { TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build()) }

    suspend fun recognize(bitmap: Bitmap): List<OcrLine> = suspendCoroutine { cont ->
        recognizer.process(InputImage.fromBitmap(bitmap, 0))
            .addOnSuccessListener { text ->
                val out = ArrayList<OcrLine>()
                for (block in text.textBlocks) for (line in block.lines) {
                    val b = line.boundingBox
                    out.add(OcrLine(line.text, b?.left ?: 0, b?.top ?: 0, b?.right ?: 0, b?.bottom ?: 0))
                }
                cont.resume(out.sortedBy { it.top })
            }
            .addOnFailureListener { cont.resumeWithException(it) }
    }
}
