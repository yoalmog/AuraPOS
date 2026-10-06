package com.aurapos.pos.ocr

import android.graphics.Bitmap
import android.util.Log

/**
 * ImageProcessor utility class that integrates directly with OpenCV for Android
 * to perform rotation, deskewing, and perspective correction on the captured
 * bitmap from CameraX before passing it to the ML Kit Text Recognizer.
 */
class ImageProcessor {

    companion object {
        private const val TAG = "ImageProcessor"

        /**
         * Convenience static processor method
         */
        @JvmStatic
        fun process(capturedBitmap: Bitmap, manualRotationDegrees: Int = 0): ProcessedImage {
            return ImageProcessor().processImage(capturedBitmap, manualRotationDegrees)
        }
    }

    data class ProcessedImage(
        val originalBitmap: Bitmap,
        val correctedBitmap: Bitmap,
        val ocrReadyBitmap: Bitmap,
        val rotationApplied: Int,
        val deskewAngle: Float,
        val perspectiveCorrected: Boolean,
        val width: Int,
        val height: Int
    )

    /**
     * Performs rotation, deskewing, and perspective correction on the captured bitmap from CameraX.
     * Integrates with OpenCvImageProcessor (native OpenCV functions: Canny, findContours, approxPolyDP,
     * warpPerspective, HoughLinesP, and CLAHE adaptive thresholding).
     */
    fun processImage(bitmap: Bitmap, manualRotationDegrees: Int = 0): ProcessedImage {
        Log.i(TAG, "Starting OpenCV ImageProcessor pipeline for bitmap (${bitmap.width}x${bitmap.height})")
        val result = OpenCvImageProcessor.processMenuImage(bitmap, manualRotationDegrees)

        return ProcessedImage(
            originalBitmap = result.originalBitmap,
            correctedBitmap = result.correctedBitmap,
            ocrReadyBitmap = result.ocrOptimizedBitmap,
            rotationApplied = result.detectedRotationDegrees,
            deskewAngle = result.detectedDeskewAngle,
            perspectiveCorrected = result.perspectiveCorrected,
            width = result.width,
            height = result.height
        )
    }

    /**
     * Helper to encode bitmap for web/bridge transmission
     */
    fun toBase64(bitmap: Bitmap, quality: Int = 85): String {
        return OpenCvImageProcessor.toBase64DataUrl(bitmap, quality)
    }
}
