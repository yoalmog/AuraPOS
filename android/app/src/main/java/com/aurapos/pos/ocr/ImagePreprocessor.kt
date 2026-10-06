package com.aurapos.pos.ocr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min

/**
 * Local Android Image Preprocessor for On-Device Menu OCR
 * Bridges with [OpenCvImageProcessor] to apply OpenCV automatic rotation,
 * deskewing, perspective transformation, and adaptive contrast optimization.
 */
object ImagePreprocessor {

    data class PreprocessedImageResult(
        val originalBitmap: Bitmap,
        val correctedBitmap: Bitmap,
        val processedOcrBitmap: Bitmap,
        val width: Int,
        val height: Int,
        val rotationDegrees: Int,
        val deskewAngle: Float = 0f,
        val perspectiveCorrected: Boolean = false
    )

    /**
     * Preprocesses an input menu bitmap:
     * Executes OpenCV automatic rotation, deskewing, and perspective correction,
     * producing both a clean corrected preview bitmap and an OCR-optimized high-contrast bitmap.
     */
    fun preprocessForOcr(
        source: Bitmap,
        manualRotationDegrees: Int = 0
    ): PreprocessedImageResult {
        val result = OpenCvImageProcessor.processMenuImage(source, manualRotationDegrees)

        return PreprocessedImageResult(
            originalBitmap = result.originalBitmap,
            correctedBitmap = result.correctedBitmap,
            processedOcrBitmap = result.ocrOptimizedBitmap,
            width = result.width,
            height = result.height,
            rotationDegrees = result.detectedRotationDegrees,
            deskewAngle = result.detectedDeskewAngle,
            perspectiveCorrected = result.perspectiveCorrected
        )
    }

    /**
     * Converts a Bitmap to JPEG Base64 data URL
     */
    fun toBase64DataUrl(bitmap: Bitmap, quality: Int = 85): String {
        return OpenCvImageProcessor.toBase64DataUrl(bitmap, quality)
    }

    /**
     * Decodes Base64 data URL into Android Bitmap
     */
    fun fromBase64DataUrl(base64Data: String): Bitmap? {
        val clean = base64Data.substringAfter("base64,")
        val bytes = android.util.Base64.decode(clean, android.util.Base64.DEFAULT)
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    }
}
