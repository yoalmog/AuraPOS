package com.aurapos.pos.ocr

import java.util.Locale
import java.util.regex.Pattern
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * On-Device Menu Spatial Layout & Structure Detection Parser
 * Conforming to Sections 6, 7, 8 & 9:
 * Analyzes OCR bounding boxes, lines, typography, and horizontal/vertical baselines
 * to extract Categories, Products, Descriptions, Prices, Variants, and Modifiers.
 */
object MenuStructureParser {

    // Regex to match diverse price representations:
    // e.g. "$12", "$ 12.50", "12.50 USD", "S/ 12.00", "S/12", "€ 14,00", "14,50", "28.00", "28"
    private val PRICE_PATTERN = Pattern.compile(
        """(?i)(?:[$€£¥₪₹]|s\/\.?|usd|pen|brl)?\s*([0-9]{1,4}(?:[.,][0-9]{2})?|[0-9]{1,4})\s*(?:usd|pen|brl|[$€£¥₪₹])?"""
    )

    private val PURE_PRICE_TOKEN = Pattern.compile(
        """^(?:[$€£¥₪₹]|s\/\.?|usd|pen|brl)?\s*([0-9]{1,4}(?:[.,][0-9]{2})?)\s*(?:usd|pen|brl|[$€£¥₪₹])?$""",
        Pattern.CASE_INSENSITIVE
    )

    data class ParsedPriceResult(
        val value: Double,
        val originalText: String,
        val isLowConfidence: Boolean,
        val boundingBox: BoundingBox?
    )

    data class ParseStructureResult(
        val categories: List<MenuImportCategory>,
        val products: List<MenuImportProduct>,
        val detectedCurrency: String,
        val menuTitle: String?
    )

    /**
     * Parses OCR text lines using their visual layout & 2D spatial relationships.
     */
    fun parseOcrResult(
        ocrResult: OcrResult,
        pageNumber: Int = 1,
        existingProducts: List<String> = emptyList() // list of existing product names for duplicate check
    ): ParseStructureResult {
        val lines = ocrResult.lines.filter { it.text.trim().isNotBlank() }
        if (lines.isEmpty()) {
            return ParseStructureResult(emptyList(), emptyList(), "$", null)
        }

        // Sort lines primarily top-to-bottom, secondarily left-to-right (accounting for columns)
        val sortedLines = lines.sortedWith(Comparator { a, b ->
            val yDiff = a.boundingBox.top - b.boundingBox.top
            // If lines are roughly on the same vertical band (within 1.5% height), sort left-to-right
            if (abs(yDiff) < 0.015f) {
                a.boundingBox.left.compareTo(b.boundingBox.left)
            } else {
                yDiff.compareTo(0f)
            }
        })

        val categories = mutableListOf<MenuImportCategory>()
        val products = mutableListOf<MenuImportProduct>()

        var currentCategory: MenuImportCategory? = null
        var currentProductCandidate: MutableProductBuilder? = null

        // Detect currency symbol from whole text
        val detectedCurrency = detectCurrency(ocrResult.fullText)

        for (i in sortedLines.indices) {
            val line = sortedLines[i]
            val rawText = line.text.trim()

            // 1. Check if line is a Category / Section Heading
            // Heuristic:
            // - Capitalized or UPPERCASE
            // - No price token anywhere on this line
            // - Relative height/width or centered
            // - Short length (<40 chars), e.g. "APPETIZERS", "PIZZAS", "BEBIDAS", "ENSALADAS", "POSTRES"
            if (isCategoryHeading(rawText, line, sortedLines)) {
                // Finalize previous product if pending
                currentProductCandidate?.let {
                    products.add(it.build(pageNumber, existingProducts))
                    currentProductCandidate = null
                }

                val cleanCatName = cleanHeadingText(rawText)
                val catId = "cat_local_${categories.size + 1}_${System.currentTimeMillis()}"
                val newCat = MenuImportCategory(
                    tempId = catId,
                    name = cleanCatName,
                    sourcePage = pageNumber,
                    sourceBoundingBox = line.boundingBox,
                    extractedText = rawText,
                    confidence = 0.95f
                )
                categories.add(newCat)
                currentCategory = newCat
                continue
            }

            // 2. Check if line contains a Price
            val priceFound = extractPriceFromLine(line)

            if (priceFound != null) {
                // Line has a price!
                // It can be:
                // Case A: Product Name + Price on the same line (e.g. "Margherita Pizza ........ $14.50")
                // Case B: Price is standalone (e.g. right column), and previous line was the Product Name
                val namePart = removePriceFromLine(rawText, priceFound.originalText).trim()

                if (namePart.length >= 2) {
                    // Line has both Name and Price!
                    currentProductCandidate?.let {
                        products.add(it.build(pageNumber, existingProducts))
                    }

                    val catName = currentCategory?.name ?: "General"
                    val builder = MutableProductBuilder(
                        tempId = "prod_local_${products.size + 1}_${System.currentTimeMillis()}",
                        name = cleanProductName(namePart),
                        categoryName = catName,
                        price = priceFound.value,
                        isLowConfidence = priceFound.isLowConfidence,
                        sourceBoundingBox = line.boundingBox,
                        extractedText = rawText,
                        originalOcrText = rawText
                    )
                    currentProductCandidate = builder
                } else if (currentProductCandidate != null && currentProductCandidate!!.price == 0.0) {
                    // Previous product was missing price, and this line is just the price
                    currentProductCandidate!!.price = priceFound.value
                    currentProductCandidate!!.isLowConfidence = priceFound.isLowConfidence
                    currentProductCandidate!!.expandBoundingBox(line.boundingBox)
                    currentProductCandidate!!.originalOcrText += " | " + rawText
                } else {
                    // Standalone price with no preceding product, or variant price
                    currentProductCandidate?.let {
                        if (it.variants.isEmpty()) {
                            it.variants.add(
                                MenuImportVariant(
                                    tempId = "var_${System.currentTimeMillis()}",
                                    name = "Standard",
                                    price = priceFound.value
                                )
                            )
                        }
                    }
                }
            } else {
                // Line has NO price.
                // Could be:
                // - A product description (e.g. "Fresh mozzarella, tomato sauce, basil")
                // - A variant or modifier description
                // - Or a product name whose price is on the next line or right column
                if (currentProductCandidate != null && currentProductCandidate!!.description.isBlank()) {
                    // Check if line looks like an ingredient / description
                    if (isDescriptionLine(rawText)) {
                        currentProductCandidate!!.description = rawText
                        currentProductCandidate!!.expandBoundingBox(line.boundingBox)
                        currentProductCandidate!!.originalOcrText += "\n" + rawText
                    } else if (currentProductCandidate!!.price > 0.0) {
                        // Product already has price and this is a new line with no price -> new product candidate
                        products.add(currentProductCandidate!!.build(pageNumber, existingProducts))
                        val catName = currentCategory?.name ?: "General"
                        currentProductCandidate = MutableProductBuilder(
                            tempId = "prod_local_${products.size + 1}_${System.currentTimeMillis()}",
                            name = cleanProductName(rawText),
                            categoryName = catName,
                            price = 0.0,
                            isLowConfidence = true, // Price missing -> low confidence flag
                            sourceBoundingBox = line.boundingBox,
                            extractedText = rawText,
                            originalOcrText = rawText
                        )
                    } else {
                        // Append to product name
                        currentProductCandidate!!.name += " " + cleanProductName(rawText)
                        currentProductCandidate!!.expandBoundingBox(line.boundingBox)
                    }
                } else {
                    // New product candidate with price = 0.0 (waiting for price)
                    currentProductCandidate?.let {
                        products.add(it.build(pageNumber, existingProducts))
                    }
                    val catName = currentCategory?.name ?: "General"
                    currentProductCandidate = MutableProductBuilder(
                        tempId = "prod_local_${products.size + 1}_${System.currentTimeMillis()}",
                        name = cleanProductName(rawText),
                        categoryName = catName,
                        price = 0.0,
                        isLowConfidence = true,
                        sourceBoundingBox = line.boundingBox,
                        extractedText = rawText,
                        originalOcrText = rawText
                    )
                }
            }
        }

        // Flush last product
        currentProductCandidate?.let {
            products.add(it.build(pageNumber, existingProducts))
        }

        // Ensure at least one default category if products exist
        val finalCategories = if (categories.isEmpty() && products.isNotEmpty()) {
            val gen = MenuImportCategory(
                tempId = "cat_local_default",
                name = "General Menu",
                sourcePage = pageNumber,
                sourceBoundingBox = null,
                extractedText = "General Menu",
                productCount = products.size
            )
            listOf(gen)
        } else {
            categories.map { cat ->
                val count = products.count { it.categoryName.equals(cat.name, ignoreCase = true) }
                cat.copy(productCount = count)
            }
        }

        return ParseStructureResult(
            categories = finalCategories,
            products = products,
            detectedCurrency = detectedCurrency,
            menuTitle = finalCategories.firstOrNull()?.name ?: "Menu Scan"
        )
    }

    private fun isCategoryHeading(
        text: String,
        line: OcrLine,
        allLines: List<OcrLine>
    ): Boolean {
        if (text.length < 3 || text.length > 45) return false

        // Categories must NOT contain a price
        if (extractPriceFromLine(line) != null) return false

        // Common category keywords
        val lower = text.toLowerCase(Locale.US)
        val categoryKeywords = listOf(
            "appetizers", "starters", "entrees", "mains", "pizzas", "pasta",
            "salads", "desserts", "beverages", "drinks", "cocktails", "wines",
            "sides", "burgers", "sandwiches", "tacos", "soups", "combos",
            "entradas", "platos", "fondos", "postres", "bebidas", "cafes",
            "ensaladas", "guarniciones", "piqueos", "especiales"
        )

        if (categoryKeywords.any { lower.contains(it) }) {
            return true
        }

        // All uppercase check (e.g. "HOT DRINKS", "SPECIALS")
        val letters = text.filter { it.isLetter() }
        if (letters.length >= 4 && letters.all { it.isUpperCase() }) {
            return true
        }

        return false
    }

    private fun isDescriptionLine(text: String): Boolean {
        val lower = text.toLowerCase(Locale.US)
        // Check for ingredient list indicators (commas, "with", "served with", "con", "y")
        if (text.contains(",") || lower.contains("with ") || lower.contains("served with") || lower.contains("con ")) {
            return true
        }
        return text.length > 25
    }

    private fun extractPriceFromLine(line: OcrLine): ParsedPriceResult? {
        val text = line.text.trim()

        // 1. Check line elements first (for precise spatial coords)
        for (elem in line.elements.reversed()) {
            val matcher = PURE_PRICE_TOKEN.matcher(elem.text.trim())
            if (matcher.find()) {
                val numStr = matcher.group(1)?.replace(",", ".") ?: continue
                val value = numStr.toDoubleOrNull() ?: continue
                if (value > 0.0 && value < 10000.0) {
                    return ParsedPriceResult(
                        value = Math.round(value * 100.0) / 100.0,
                        originalText = elem.text.trim(),
                        isLowConfidence = elem.confidence < 0.7f,
                        boundingBox = elem.boundingBox
                    )
                }
            }
        }

        // 2. Check full line text via regex
        val matcher = PRICE_PATTERN.matcher(text)
        var lastMatch: ParsedPriceResult? = null

        while (matcher.find()) {
            val numStr = matcher.group(1)?.replace(",", ".") ?: continue
            val value = numStr.toDoubleOrNull() ?: continue
            if (value > 0.0 && value < 10000.0) {
                lastMatch = ParsedPriceResult(
                    value = Math.round(value * 100.0) / 100.0,
                    originalText = matcher.group(0) ?: numStr,
                    isLowConfidence = false,
                    boundingBox = line.boundingBox
                )
            }
        }

        return lastMatch
    }

    private fun removePriceFromLine(lineText: String, priceStr: String): String {
        return lineText.replace(priceStr, "")
            .replace(Regex("""[.·-]{2,}"""), "") // remove dot leaders e.g. "Margherita .... 12"
            .trim()
    }

    private fun cleanHeadingText(text: String): String {
        return text.replace(Regex("""^[\d\s.\-#*]+"""), "")
            .replace(Regex("""[\s.\-#*]+$"""), "")
            .trim()
    }

    private fun cleanProductName(text: String): String {
        return text.replace(Regex("""^[\d\s.\-#*]+"""), "")
            .replace(Regex("""[.·-]{2,}"""), "")
            .trim()
    }

    private fun detectCurrency(fullText: String): String {
        return when {
            fullText.contains("S/.") || fullText.contains("S/") -> "S/"
            fullText.contains("€") -> "€"
            fullText.contains("£") -> "£"
            fullText.contains("₪") -> "₪"
            fullText.contains("R$") -> "R$"
            else -> "$"
        }
    }

    private class MutableProductBuilder(
        val tempId: String,
        var name: String,
        val categoryName: String,
        var price: Double,
        var isLowConfidence: Boolean,
        var sourceBoundingBox: BoundingBox,
        var extractedText: String,
        var originalOcrText: String,
        var description: String = "",
        val variants: MutableList<MenuImportVariant> = mutableListOf(),
        val modifiers: MutableList<MenuImportModifier> = mutableListOf()
    ) {
        fun expandBoundingBox(box: BoundingBox) {
            val newL = min(sourceBoundingBox.left, box.left)
            val newT = min(sourceBoundingBox.top, box.top)
            val newR = max(sourceBoundingBox.right, box.right)
            val newB = max(sourceBoundingBox.bottom, box.bottom)
            sourceBoundingBox = BoundingBox(newL, newT, newR, newB)
        }

        fun build(pageNumber: Int, existingProductNames: List<String>): MenuImportProduct {
            val cleanN = name.trim()
            val warnings = mutableListOf<String>()

            if (price <= 0.0) {
                warnings.add("Price missing or unclear. Please verify.")
                isLowConfidence = true
            }

            // Duplicate detection conforming to Requirement 9
            val duplicateMatch = when {
                existingProductNames.any { it.equals(cleanN, ignoreCase = true) } -> "MATCH"
                existingProductNames.any {
                    it.toLowerCase(Locale.US).contains(cleanN.toLowerCase(Locale.US)) ||
                            cleanN.toLowerCase(Locale.US).contains(it.toLowerCase(Locale.US))
                } -> "POSSIBLE DUPLICATE"
                else -> "NEW"
            }

            if (duplicateMatch != "NEW") {
                warnings.add("Matched existing product in database: $duplicateMatch")
            }

            return MenuImportProduct(
                tempId = tempId,
                name = cleanN,
                categoryName = categoryName,
                description = description.trim(),
                price = price,
                sourcePage = pageNumber,
                sourceBoundingBox = sourceBoundingBox,
                extractedText = extractedText,
                originalOcrText = originalOcrText,
                confidence = if (isLowConfidence) 0.65f else 0.92f,
                isLowConfidence = isLowConfidence,
                warnings = warnings,
                variants = variants,
                modifiers = modifiers,
                duplicateMatch = duplicateMatch
            )
        }
    }
}
