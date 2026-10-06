package com.aurapos.pos.ocr

import android.graphics.Rect
import org.json.JSONArray
import org.json.JSONObject

/**
 * Normalized 0.0 - 1.0 and Absolute Spatial Bounding Box
 */
data class BoundingBox(
    val left: Float,
    val top: Float,
    val right: Float,
    val bottom: Float,
    val width: Float = right - left,
    val height: Float = bottom - top
) {
    fun toJsonObject(): JSONObject = JSONObject().apply {
        put("left", left)
        put("top", top)
        put("right", right)
        put("bottom", bottom)
        put("width", width)
        put("height", height)
    }

    companion object {
        fun fromRect(rect: Rect, imageWidth: Int, imageHeight: Int): BoundingBox {
            val w = if (imageWidth > 0) imageWidth.toFloat() else 1f
            val h = if (imageHeight > 0) imageHeight.toFloat() else 1f
            val l = (rect.left.toFloat() / w).coerceIn(0f, 1f)
            val t = (rect.top.toFloat() / h).coerceIn(0f, 1f)
            val r = (rect.right.toFloat() / w).coerceIn(0f, 1f)
            val b = (rect.bottom.toFloat() / h).coerceIn(0f, 1f)
            return BoundingBox(l, t, r, b)
        }
    }
}

data class OcrElement(
    val text: String,
    val boundingBox: BoundingBox,
    val confidence: Float = 0.95f
) {
    fun toJsonObject(): JSONObject = JSONObject().apply {
        put("text", text)
        put("boundingBox", boundingBox.toJsonObject())
        put("confidence", confidence)
    }
}

data class OcrLine(
    val text: String,
    val boundingBox: BoundingBox,
    val elements: List<OcrElement> = emptyList(),
    val confidence: Float = 0.95f
) {
    fun toJsonObject(): JSONObject = JSONObject().apply {
        put("text", text)
        put("boundingBox", boundingBox.toJsonObject())
        put("confidence", confidence)
        put("elements", JSONArray().apply {
            elements.forEach { put(it.toJsonObject()) }
        })
    }
}

data class OcrTextBlock(
    val text: String,
    val boundingBox: BoundingBox,
    val lines: List<OcrLine> = emptyList(),
    val confidence: Float = 0.95f,
    val recognizedLanguage: String? = null
) {
    fun toJsonObject(): JSONObject = JSONObject().apply {
        put("text", text)
        put("boundingBox", boundingBox.toJsonObject())
        put("confidence", confidence)
        recognizedLanguage?.let { put("recognizedLanguage", it) }
        put("lines", JSONArray().apply {
            lines.forEach { put(it.toJsonObject()) }
        })
    }
}

data class OcrResult(
    val fullText: String,
    val textBlocks: List<OcrTextBlock>,
    val lines: List<OcrLine>,
    val elements: List<OcrElement>,
    val imageWidth: Int,
    val imageHeight: Int,
    val pageNumber: Int = 1,
    val detectedLanguage: String? = null,
    val processingTimeMs: Long = 0L
) {
    fun toJsonObject(): JSONObject = JSONObject().apply {
        put("fullText", fullText)
        put("imageWidth", imageWidth)
        put("imageHeight", imageHeight)
        put("pageNumber", pageNumber)
        detectedLanguage?.let { put("detectedLanguage", it) }
        put("processingTimeMs", processingTimeMs)
        put("textBlocks", JSONArray().apply {
            textBlocks.forEach { put(it.toJsonObject()) }
        })
        put("lines", JSONArray().apply {
            lines.forEach { put(it.toJsonObject()) }
        })
    }
}

/**
 * Structured Internal Menu Models conforming to Requirements 7 & 8
 */
data class MenuImportVariant(
    val tempId: String,
    val name: String,
    val price: Double,
    val sku: String? = null,
    val confidence: Float = 0.9f
) {
    fun toJsonObject(): JSONObject = JSONObject().apply {
        put("id", tempId)
        put("tempId", tempId)
        put("name", name)
        put("price", price)
        sku?.let { put("sku", it) }
        put("confidence", confidence)
    }
}

data class MenuImportModifier(
    val tempId: String,
    val name: String,
    val required: Boolean = false,
    val options: List<MenuImportModifierOption> = emptyList()
) {
    fun toJsonObject(): JSONObject = JSONObject().apply {
        put("id", tempId)
        put("name", name)
        put("required", required)
        put("options", JSONArray().apply {
            options.forEach { put(it.toJsonObject()) }
        })
    }
}

data class MenuImportModifierOption(
    val tempId: String,
    val name: String,
    val priceDelta: Double = 0.0
) {
    fun toJsonObject(): JSONObject = JSONObject().apply {
        put("id", tempId)
        put("name", name)
        put("priceDelta", priceDelta)
    }
}

data class MenuImportCategory(
    val tempId: String,
    val name: String,
    val sourcePage: Int,
    val sourceBoundingBox: BoundingBox?,
    val extractedText: String,
    val confidence: Float = 0.95f,
    val productCount: Int = 0,
    val warnings: List<String> = emptyList()
) {
    fun toJsonObject(): JSONObject = JSONObject().apply {
        put("id", tempId)
        put("tempId", tempId)
        put("name", name)
        put("sourcePage", sourcePage)
        sourceBoundingBox?.let { put("sourceBoundingBox", it.toJsonObject()) }
        put("extractedText", extractedText)
        put("confidence", confidence)
        put("productCount", productCount)
        put("warnings", JSONArray(warnings))
        put("selected", true)
        put("resolution", "create_new")
    }
}

data class MenuImportProduct(
    val tempId: String,
    val name: String,
    val categoryName: String,
    val description: String,
    val price: Double,
    val sourcePage: Int,
    val sourceBoundingBox: BoundingBox?,
    val extractedText: String,
    val originalOcrText: String,
    val confidence: Float = 0.9f,
    val isLowConfidence: Boolean = false,
    val warnings: List<String> = emptyList(),
    val variants: List<MenuImportVariant> = emptyList(),
    val modifiers: List<MenuImportModifier> = emptyList(),
    val duplicateMatch: String = "NEW" // "NEW", "MATCH", "POSSIBLE DUPLICATE"
) {
    fun toJsonObject(): JSONObject = JSONObject().apply {
        put("id", tempId)
        put("tempId", tempId)
        put("name", name)
        put("categoryName", categoryName)
        put("description", description)
        put("price", price)
        put("cost", Math.round(price * 0.35 * 100) / 100.0)
        put("sourcePage", sourcePage)
        sourceBoundingBox?.let { put("sourceBoundingBox", it.toJsonObject()) }
        put("extractedText", extractedText)
        put("originalOcrText", originalOcrText)
        put("confidence", confidence)
        put("isLowConfidence", isLowConfidence)
        put("warnings", JSONArray(warnings))
        put("duplicateMatch", duplicateMatch)
        put("selected", true)
        put("resolution", if (duplicateMatch == "MATCH") "update_existing" else "create_new")
        put("variants", JSONArray().apply {
            variants.forEach { put(it.toJsonObject()) }
        })
        put("modifiers", JSONArray().apply {
            modifiers.forEach { put(it.toJsonObject()) }
        })
    }
}
