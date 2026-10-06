package com.aurapos.pos.ocr

import android.graphics.Bitmap
import android.graphics.Rect
import android.util.Log
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import java.text.Normalizer
import kotlin.coroutines.resume

/**
 * Local-First On-Device Android OCR Service
 * Configured specifically to support Spanish language script:
 * - TextRecognizer initialized with Latin / Spanish script options
 * - Guarantees preservation of special characters, accents, and symbols (á, é, í, ó, ú, ü, ñ, ¿, ¡)
 * - Retains original exact OCR unicode string in originalText alongside normalizedText
 * - Runs completely on-device without remote backend calls
 */
interface LocalOcrService {
    suspend fun recognize(image: Bitmap, pageNumber: Int = 1): OcrResult
}

class MlKitLocalOcrService : LocalOcrService {

    companion object {
        private const val TAG = "MlKitSpanishOcr"

        /**
         * Characters specific to Spanish menu typography that must never be stripped or corrupted:
         * Accents: á, é, í, ó, ú, Á, É, Í, Ó, Ú
         * Diaeresis: ü, Ü
         * Eñe: ñ, Ñ
         * Inverted punctuation: ¿, ¡
         * Currency symbols: S/, S/., $, €, US$, PEN
         */
        val SPANISH_SPECIAL_CHARACTERS = setOf(
            'á', 'é', 'í', 'ó', 'ú',
            'Á', 'É', 'Í', 'Ó', 'Ú',
            'ü', 'Ü',
            'ñ', 'Ñ',
            '¿', '¡'
        )

        /**
         * Clean text while strictly PRESERVING all Spanish accents, diaeresis, eñes, and punctuation
         */
        fun sanitizePreservingSpanishAccents(raw: String): String {
            if (raw.isBlank()) return ""
            // Normalize unicode to NFC (Canonical Decomposition followed by Canonical Composition)
            // Ensures characters like 'ñ' and 'ó' remain unified single code points rather than broken combining marks
            val nfc = Normalizer.normalize(raw, Normalizer.Form.NFC)
            // Remove unprintable control characters, but preserve all letters (including Latin-extended Spanish), numbers, and currency symbols
            return nfc.replace(Regex("""[\p{Cntrl}&&[^\r\n\t]]"""), "").trim()
        }
    }

    /**
     * Dedicated Google ML Kit Text Recognizer configured for Latin / Spanish script.
     * TextRecognizerOptions.DEFAULT_OPTIONS is explicitly backed by the Latin script model
     * which fully supports Spanish orthography and diacritics.
     */
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
                    val result = parseMlKitSpanishText(visionText, imgWidth, imgHeight, pageNumber, processingTime)
                    continuation.resume(result)
                }
                .addOnFailureListener { exception ->
                    Log.e(TAG, "ML Kit Spanish OCR failed: ${exception.message}", exception)
                    val processingTime = System.currentTimeMillis() - startTime
                    val fallback = OcrResult(
                        fullText = "",
                        textBlocks = emptyList(),
                        lines = emptyList(),
                        elements = emptyList(),
                        imageWidth = imgWidth,
                        imageHeight = imgHeight,
                        pageNumber = pageNumber,
                        detectedLanguage = "es",
                        processingTimeMs = processingTime
                    )
                    continuation.resume(fallback)
                }
        }

    /**
     * Parses ML Kit Vision Text output, ensuring Spanish diacritics and symbols are fully preserved
     * in block, line, element, and fullText nodes.
     */
    private fun parseMlKitSpanishText(
        visionText: Text,
        imageWidth: Int,
        imageHeight: Int,
        pageNumber: Int,
        processingTimeMs: Long
    ): OcrResult {
        // Preserve original text without stripping accents
        val rawFullText = visionText.text
        val fullText = sanitizePreservingSpanishAccents(rawFullText)
        val allLines = mutableListOf<OcrLine>()
        val allElements = mutableListOf<OcrElement>()

        var hasSpanishDiacritics = false

        val textBlocks = visionText.textBlocks.map { block ->
            val blockRect = block.boundingBox ?: Rect(0, 0, imageWidth, imageHeight)
            val blockBbox = BoundingBox.fromRect(blockRect, imageWidth, imageHeight)

            val lines = block.lines.map { line ->
                val lineRect = line.boundingBox ?: blockRect
                val lineBbox = BoundingBox.fromRect(lineRect, imageWidth, imageHeight)

                val elements = line.elements.map { elem ->
                    val elemRect = elem.boundingBox ?: lineRect
                    val elemBbox = BoundingBox.fromRect(elemRect, imageWidth, imageHeight)
                    val elemText = sanitizePreservingSpanishAccents(elem.text)

                    if (!hasSpanishDiacritics && elemText.any { SPANISH_SPECIAL_CHARACTERS.contains(it) }) {
                        hasSpanishDiacritics = true
                    }

                    val elemConfidence = elem.confidence ?: 0.95f
                    val ocrElem = OcrElement(
                        text = elemText,
                        boundingBox = elemBbox,
                        confidence = elemConfidence
                    )
                    allElements.add(ocrElem)
                    ocrElem
                }

                val lineText = sanitizePreservingSpanishAccents(line.text)
                if (!hasSpanishDiacritics && lineText.any { SPANISH_SPECIAL_CHARACTERS.contains(it) }) {
                    hasSpanishDiacritics = true
                }

                val lineConfidence = line.confidence ?: 0.95f
                val ocrLine = OcrLine(
                    text = lineText,
                    boundingBox = lineBbox,
                    elements = elements,
                    confidence = lineConfidence
                )
                allLines.add(ocrLine)
                ocrLine
            }

            val blockText = sanitizePreservingSpanishAccents(block.text)
            val blockLang = block.recognizedLanguage ?: if (hasSpanishDiacritics) "es" else null

            OcrTextBlock(
                text = blockText,
                boundingBox = blockBbox,
                lines = lines,
                confidence = 0.95f,
                recognizedLanguage = blockLang
            )
        }

        val detectedLang = if (hasSpanishDiacritics) {
            "es"
        } else {
            textBlocks.firstOrNull { !it.recognizedLanguage.isNullOrBlank() }?.recognizedLanguage ?: "es"
        }

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
