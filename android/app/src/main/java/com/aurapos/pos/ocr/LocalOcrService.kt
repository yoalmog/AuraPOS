package com.aurapos.pos.ocr

import android.graphics.Bitmap
import android.graphics.Rect
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Local-First On-Device Android OCR Service
 * Conforming to Section 3:
 * Runs completely on-device without remote backend calls.
 */
interface LocalOcrService {
    suspend fun recognize(image: Bitmap, pageNumber: Int = 1): OcrResult
}

class MlKitLocalOcrService : LocalOcrService {

    // On-device ML Kit Text Recognizer
    private val recognizer by lazy {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }

    override suspend fun recognize(image: Bitmap, pageNumber: Int): OcrResult =
        suspendCancellableCoroutine { continuation ->
            val startTime = System.currentTimeMillis()
            val inputImage = InputImage.fromBitmap(image, 0)
            val imgWidth = image.width
            val imgHeight = image.height

            recognizer.process(inputImage)
                .addOnSuccessListener { visionText ->
                    val processingTime = System.currentTimeMillis() - startTime
                    val result = parseMlKitText(visionText, imgWidth, imgHeight, pageNumber, processingTime)
                    continuation.resume(result)
                }
                .addOnFailureListener { exception ->
                    // Fallback to empty OCR result rather than hard-crashing
                    val processingTime = System.currentTimeMillis() - startTime
                    val fallback = OcrResult(
                        fullText = "",
                        textBlocks = emptyList(),
                        lines = emptyList(),
                        elements = emptyList(),
                        imageWidth = imgWidth,
                        imageHeight = imgHeight,
                        pageNumber = pageNumber,
                        detectedLanguage = null,
                        processingTimeMs = processingTime
                    )
                    continuation.resume(fallback)
                }
        }

    private fun parseMlKitText(
        visionText: Text,
        imageWidth: Int,
        imageHeight: Int,
        pageNumber: Int,
        processingTimeMs: Long
    ): OcrResult {
        val fullText = visionText.text
        val allLines = mutableListOf<OcrLine>()
        val allElements = mutableListOf<OcrElement>()

        val textBlocks = visionText.textBlocks.map { block ->
            val blockRect = block.boundingBox ?: Rect(0, 0, imageWidth, imageHeight)
            val blockBbox = BoundingBox.fromRect(blockRect, imageWidth, imageHeight)

            val lines = block.lines.map { line ->
                val lineRect = line.boundingBox ?: blockRect
                val lineBbox = BoundingBox.fromRect(lineRect, imageWidth, imageHeight)

                val elements = line.elements.map { elem ->
                    val elemRect = elem.boundingBox ?: lineRect
                    val elemBbox = BoundingBox.fromRect(elemRect, imageWidth, imageHeight)
                    val elemConfidence = elem.confidence ?: 0.95f
                    val ocrElem = OcrElement(
                        text = elem.text,
                        boundingBox = elemBbox,
                        confidence = elemConfidence
                    )
                    allElements.add(ocrElem)
                    ocrElem
                }

                val lineConfidence = line.confidence ?: 0.95f
                val ocrLine = OcrLine(
                    text = line.text,
                    boundingBox = lineBbox,
                    elements = elements,
                    confidence = lineConfidence
                )
                allLines.add(ocrLine)
                ocrLine
            }

            OcrTextBlock(
                text = block.text,
                boundingBox = blockBbox,
                lines = lines,
                confidence = 0.95f,
                recognizedLanguage = block.recognizedLanguage
            )
        }

        val detectedLang = textBlocks.firstOrNull { !it.recognizedLanguage.isNullOrBlank() }?.recognizedLanguage

        return OcrResult(
            fullText = fullText,
            textBlocks = textBlocks,
            lines = allLines,
            elements = allElements,
            imageWidth = imageWidth,
            imageHeight = imageHeight,
            pageNumber = pageNumber,
            detectedLanguage = detectedLang,
            processingTimeMs = processingTimeMs
        )
    }
}
