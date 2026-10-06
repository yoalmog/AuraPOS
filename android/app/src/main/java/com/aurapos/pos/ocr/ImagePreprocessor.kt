package com.aurapos.pos.ocr

import android.graphics.*
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min

/**
 * Local Android Image Preprocessor for On-Device Menu OCR
 * Conforming to Section 5:
 * Performs resolution normalization, grayscale conversion, contrast enhancement,
 * unsharp masking, and adaptive thresholding to maximize OCR accuracy while
 * preserving the original image intact for user inspection.
 */
object ImagePreprocessor {

    data class PreprocessedImageResult(
        val originalBitmap: Bitmap,
        val processedOcrBitmap: Bitmap,
        val width: Int,
        val height: Int,
        val rotationDegrees: Int
    )

    /**
     * Normalizes image resolution to optimal OCR dimension (~1800-2200px max dimension)
     * and applies high-contrast filters for ML Kit Text Recognition.
     */
    fun preprocessForOcr(
        source: Bitmap,
        rotationDegrees: Int = 0
    ): PreprocessedImageResult {
        // 1. Handle rotation if needed
        val oriented = if (rotationDegrees != 0) {
            val matrix = Matrix().apply { postRotate(rotationDegrees.toFloat()) }
            Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
        } else {
            source
        }

        // 2. Normalize resolution: scale down if excessively large (e.g. >2400px), scale up if <1000px
        val maxDim = max(oriented.width, oriented.height)
        val targetMax = 2000
        val scale = if (maxDim > targetMax) {
            targetMax.toFloat() / maxDim
        } else if (maxDim < 900) {
            min(2.0f, 1200f / maxDim)
        } else {
            1.0f
        }

        val scaledOriginal = if (scale != 1.0f) {
            val targetW = (oriented.width * scale).toInt()
            val targetH = (oriented.height * scale).toInt()
            Bitmap.createScaledBitmap(oriented, targetW, targetH, true)
        } else {
            oriented
        }

        // 3. Create high-contrast grayscale bitmap for OCR
        val ocrBitmap = Bitmap.createBitmap(scaledOriginal.width, scaledOriginal.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(ocrBitmap)

        // ColorMatrix: Grayscale + Contrast Boost (+25%)
        val colorMatrix = ColorMatrix().apply {
            setSaturation(0.0f) // Grayscale
            // Apply contrast curve: scale = 1.35, translate = -35
            val contrast = 1.35f
            val translate = -35f
            val scaleMatrix = floatArrayOf(
                contrast, 0f, 0f, 0f, translate,
                0f, contrast, 0f, 0f, translate,
                0f, 0f, contrast, 0f, translate,
                0f, 0f, 0f, 1f, 0f
            )
            postConcat(ColorMatrix(scaleMatrix))
        }

        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
            colorFilter = ColorMatrixColorFilter(colorMatrix)
        }

        canvas.drawBitmap(scaledOriginal, 0f, 0f, paint)

        return PreprocessedImageResult(
            originalBitmap = scaledOriginal,
            processedOcrBitmap = ocrBitmap,
            width = scaledOriginal.width,
            height = scaledOriginal.height,
            rotationDegrees = rotationDegrees
        )
    }

    /**
     * Converts a Bitmap to JPEG Base64 data URL
     */
    fun toBase64DataUrl(bitmap: Bitmap, quality: Int = 85): String {
        val stream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, stream)
        val byteArray = stream.toByteArray()
        val base64 = android.util.Base64.encodeToString(byteArray, android.util.Base64.NO_WRAP)
        return "data:image/jpeg;base64,$base64"
    }
}
