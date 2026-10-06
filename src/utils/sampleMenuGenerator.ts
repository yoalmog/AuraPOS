/**
 * AuraPOS - Sample Menu Generator for Testing & Demo
 * Generates crisp 1200x1600 menu page images in high-resolution canvas/JPEG format
 */
import { ScannedMenuPage, OcrResult, OcrLine, OcrTextBlock } from '../types/menuScanner.ts';

interface SamplePageConfig {
  pageTitle: string;
  categoryName: string;
  subtitle: string;
  accentColor: string;
  items: Array<{
    name: string;
    desc: string;
    price: string;
    variants?: string;
  }>;
}

const SAMPLE_PAGES_CONFIG: SamplePageConfig[] = [
  {
    pageTitle: 'TRATTORIA & PIZZERIA BELLA NAPOLI',
    categoryName: 'ANTIPASTI & ENTRADAS',
    subtitle: 'Auténticos sabores mediterráneos para compartir',
    accentColor: '#b91c1c',
    items: [
      {
        name: 'Bruschetta Tradizionale',
        desc: 'Pan campesino tostado, tomates marinados con albahaca fresca, ajo y aceite de oliva virgen extra',
        price: 'S/ 24.00'
      },
      {
        name: 'Carpaccio di Manzo al Tartufo',
        desc: 'Finas láminas de lomo de res, rúcula silvestre, lascas de parmesano reggiano y aceite de trufa',
        price: 'S/ 42.00'
      },
      {
        name: 'Calamari Fritti alla Romana',
        desc: 'Calamares crujientes acompañados de salsa tártara artesanal y limón eureka',
        price: 'S/ 38.00'
      },
      {
        name: 'Insalata Caprese di Bufala',
        desc: 'Mozzarella fresca di bufala, tomates madurados al sol, pesto de albahaca y reducción balsámica',
        price: 'S/ 34.00'
      },
      {
        name: 'Arancini Siciliani (4 uds)',
        desc: 'Croquetas de arroz carnaroli rellenas de ragú boloñés y queso provolone fundido',
        price: 'S/ 28.00'
      }
    ]
  },
  {
    pageTitle: 'TRATTORIA & PIZZERIA BELLA NAPOLI',
    categoryName: 'PIZZAS AL FORNO DI LEGNA',
    subtitle: 'Masa fermentada 48 horas al horno de leña napolitano',
    accentColor: '#c2410c',
    items: [
      {
        name: 'Pizza Margherita DOC',
        desc: 'Salsa pomodoro San Marzano, mozzarella fior di latte, albahaca fresca y aceite de oliva',
        price: 'S/ 36.00',
        variants: 'Personal: S/ 22.00 | Mediana: S/ 36.00 | Familiar: S/ 52.00'
      },
      {
        name: 'Pizza Diavola Piccante',
        desc: 'Pomodoro, mozzarella, salame calabrese picante, hojuelas de peperoncino y orégano',
        price: 'S/ 44.00',
        variants: 'Personal: S/ 26.00 | Mediana: S/ 44.00 | Familiar: S/ 62.00'
      },
      {
        name: 'Pizza Quattro Formaggi',
        desc: 'Mozzarella, gorgonzola cremoso, provolone ahumado y parmigiano reggiano 24 meses',
        price: 'S/ 48.00',
        variants: 'Personal: S/ 28.00 | Mediana: S/ 48.00 | Familiar: S/ 66.00'
      },
      {
        name: 'Pizza Prosciutto e Funghi',
        desc: 'Pomodoro, fior di latte, jamón prosciutto cotto italiano y champiñones frescos salteados',
        price: 'S/ 42.00',
        variants: 'Personal: S/ 25.00 | Mediana: S/ 42.00 | Familiar: S/ 58.00'
      },
      {
        name: 'Pizza Tartufata & Burrata',
        desc: 'Crema de trufa negra, burrata fresca al centro, jamón de parma y rúcula fresca',
        price: 'S/ 56.00',
        variants: 'Mediana: S/ 56.00 | Familiar: S/ 78.00'
      }
    ]
  },
  {
    pageTitle: 'TRATTORIA & PIZZERIA BELLA NAPOLI',
    categoryName: 'PASTAS ARTESANALES & CARNES',
    subtitle: 'Pasta fresca hecha a mano diariamente en nuestro obrador',
    accentColor: '#15803d',
    items: [
      {
        name: 'Spaghetti alla Carbonara Autentica',
        desc: 'Spaghetti al dente con guanciale crujiente, yemas de huevo de corral y pecorino romano',
        price: 'S/ 42.00'
      },
      {
        name: 'Fettuccine ai Funghi Porcini & Tartufo',
        desc: 'Fettuccine artesanales con hongos porcini salteados en mantequilla clarificada y salsa de trufa',
        price: 'S/ 48.00'
      },
      {
        name: 'Lasagna Tradizionale Emiliana',
        desc: 'Capas de pasta casera con ragú boloñés de cocción lenta de 6 horas y bechamel nuez moscada',
        price: 'S/ 39.00'
      },
      {
        name: 'Bife Angosto a la Fiorentina (400g)',
        desc: 'Corte premium a la parrilla con sal de maras, romero fresco y papas rústicas al horno',
        price: 'S/ 68.00'
      },
      {
        name: 'Salmone alla Griglia con Espárragos',
        desc: 'Filete de salmón noruego a la plancha sobre cama de espárragos y emulsión de limón siciliano',
        price: 'S/ 58.00'
      }
    ]
  },
  {
    pageTitle: 'TRATTORIA & PIZZERIA BELLA NAPOLI',
    categoryName: 'BEBIDAS & COCTELERÍA DE AUTOR',
    subtitle: 'Cócteles clásicos italianos, vinos y refrescos naturales',
    accentColor: '#1d4ed8',
    items: [
      {
        name: 'Aperol Spritz Veneziano',
        desc: 'Aperol, prosecco DOC Treviso, soda y rodaja de naranja fresca',
        price: 'S/ 28.00'
      },
      {
        name: 'Negroni Classico di Torino',
        desc: 'Gin London Dry, Campari bitter, vermouth rosso y piel de naranja confitada',
        price: 'S/ 32.00'
      },
      {
        name: 'Pisco Sour Catedral',
        desc: 'Pisco quebranta 4 oz, jugo de limón recién exprimido, jarabe de goma y gotas de amargo de angostura',
        price: 'S/ 30.00'
      },
      {
        name: 'Birra Moretti / Peroni Nastro Azzurro',
        desc: 'Cerveza italiana premium en botella 330ml helada',
        price: 'S/ 18.00'
      },
      {
        name: 'Chicha Morada de Maíz Morado Artesanal (1L)',
        desc: 'Hervida con manzana, piña, membrillo, clavo y canela',
        price: 'S/ 16.00',
        variants: 'Copa: S/ 7.00 | Jarra 1L: S/ 16.00'
      }
    ]
  },
  {
    pageTitle: 'TRATTORIA & PIZZERIA BELLA NAPOLI',
    categoryName: 'POSTRES CASEROS & CAFETERÍA',
    subtitle: 'El dulce final con auténtico café espresso italiano',
    accentColor: '#7e22ce',
    items: [
      {
        name: 'Tiramisù Tradizionale al Mascarpone',
        desc: 'Bizcochos savoiardi bañados en café espresso y licor amaretto con crema pura de mascarpone',
        price: 'S/ 22.00'
      },
      {
        name: 'Panna Cotta ai Frutti di Bosco',
        desc: 'Suave crema de leche cocida a fuego lento servida con coulis tibio de frutos rojos silvestres',
        price: 'S/ 20.00'
      },
      {
        name: 'Cannoli Siciliani con Pistacchio (2 uds)',
        desc: 'Masa frita crocante rellena de ricotta dulce di pecora con chispas de chocolate y pistachos',
        price: 'S/ 24.00'
      },
      {
        name: 'Espresso Italiano / Ristretto',
        desc: 'Extracción corta 30ml de granos tostados estilo Napolitano',
        price: 'S/ 8.00'
      },
      {
        name: 'Cappuccino cremoso con cacao',
        desc: 'Espresso con leche texturizada y espuma de leche espolvoreada con cacao amargo',
        price: 'S/ 12.00'
      }
    ]
  }
];

export async function generateSampleMenuPages(): Promise<ScannedMenuPage[]> {
  const resultPages: ScannedMenuPage[] = [];

  for (let idx = 0; idx < SAMPLE_PAGES_CONFIG.length; idx++) {
    const cfg = SAMPLE_PAGES_CONFIG[idx];
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1400;
    const ctx = canvas.getContext('2d');

    if (!ctx) continue;

    // Background paper texture
    ctx.fillStyle = '#fdfbf7';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle menu border
    ctx.strokeStyle = '#d6cebd';
    ctx.lineWidth = 4;
    ctx.strokeRect(30, 30, canvas.width - 60, canvas.height - 60);

    ctx.strokeStyle = cfg.accentColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(36, 36, canvas.width - 72, canvas.height - 72);

    // Header Restaurant Title
    ctx.fillStyle = '#1c1917';
    ctx.font = 'bold 26px "Playfair Display", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(cfg.pageTitle, canvas.width / 2, 90);

    // Decorative line
    ctx.strokeStyle = cfg.accentColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2 - 120, 110);
    ctx.lineTo(canvas.width / 2 + 120, 110);
    ctx.stroke();

    // Category Title Banner
    ctx.fillStyle = cfg.accentColor;
    ctx.font = '900 32px "Inter", Arial, sans-serif';
    ctx.fillText(cfg.categoryName, canvas.width / 2, 160);

    // Subtitle
    ctx.fillStyle = '#78716c';
    ctx.font = 'italic 16px "Inter", Arial, sans-serif';
    ctx.fillText(cfg.subtitle, canvas.width / 2, 190);

    // Horizontal divider
    ctx.strokeStyle = '#e7e5e4';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(80, 215);
    ctx.lineTo(canvas.width - 80, 215);
    ctx.stroke();

    const ocrLines: OcrLine[] = [];

    // Header title OCR line
    ocrLines.push({
      text: cfg.pageTitle,
      boundingBox: {
        left: 0.1,
        top: 70 / canvas.height,
        right: 0.9,
        bottom: 105 / canvas.height,
        width: 0.8,
        height: 35 / canvas.height
      },
      confidence: 0.98
    });

    // Category banner OCR line
    ocrLines.push({
      text: cfg.categoryName,
      boundingBox: {
        left: 0.1,
        top: 135 / canvas.height,
        right: 0.9,
        bottom: 175 / canvas.height,
        width: 0.8,
        height: 40 / canvas.height
      },
      confidence: 0.99
    });

    // Subtitle OCR line
    ocrLines.push({
      text: cfg.subtitle,
      boundingBox: {
        left: 0.15,
        top: 178 / canvas.height,
        right: 0.85,
        bottom: 205 / canvas.height,
        width: 0.7,
        height: 27 / canvas.height
      },
      confidence: 0.95
    });

    // Items list
    let currentY = 270;
    const itemSpacing = 190;

    for (let i = 0; i < cfg.items.length; i++) {
      const item = cfg.items[i];

      // Item Name
      ctx.textAlign = 'left';
      ctx.fillStyle = '#0c0a09';
      ctx.font = 'bold 22px "Inter", Arial, sans-serif';
      ctx.fillText(item.name, 80, currentY);

      const nameMetrics = ctx.measureText(item.name);
      const nameNormRight = (80 + nameMetrics.width) / canvas.width;

      // Price aligned right
      ctx.textAlign = 'right';
      ctx.fillStyle = cfg.accentColor;
      ctx.font = 'bold 22px "Inter", Arial, sans-serif';
      ctx.fillText(item.price, canvas.width - 80, currentY);

      // OCR line for Name + Price
      ocrLines.push({
        text: `${item.name} ...... ${item.price}`,
        boundingBox: {
          left: 80 / canvas.width,
          top: (currentY - 24) / canvas.height,
          right: (canvas.width - 80) / canvas.width,
          bottom: (currentY + 6) / canvas.height,
          width: (canvas.width - 160) / canvas.width,
          height: 30 / canvas.height
        },
        elements: [
          {
            text: item.name,
            boundingBox: {
              left: 80 / canvas.width,
              top: (currentY - 24) / canvas.height,
              right: nameNormRight,
              bottom: (currentY + 6) / canvas.height,
              width: nameNormRight - 80 / canvas.width,
              height: 30 / canvas.height
            },
            confidence: 0.97
          },
          {
            text: item.price,
            boundingBox: {
              left: (canvas.width - 200) / canvas.width,
              top: (currentY - 24) / canvas.height,
              right: (canvas.width - 80) / canvas.width,
              bottom: (currentY + 6) / canvas.height,
              width: 120 / canvas.width,
              height: 30 / canvas.height
            },
            confidence: 0.98
          }
        ],
        confidence: 0.97
      });

      // Dotted leader line
      ctx.strokeStyle = '#d6d3d1';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      const textWidth = ctx.measureText(item.name).width;
      ctx.moveTo(80 + textWidth + 15, currentY - 5);
      ctx.lineTo(canvas.width - 80 - 110, currentY - 5);
      ctx.stroke();
      ctx.setLineDash([]); // reset line dash

      // Description text (wrapped)
      ctx.textAlign = 'left';
      ctx.fillStyle = '#57534e';
      ctx.font = '15px "Inter", Arial, sans-serif';
      
      const words = item.desc.split(' ');
      let line = '';
      let lineY = currentY + 28;
      const maxWidth = canvas.width - 160;

      for (let w = 0; w < words.length; w++) {
        const testLine = line + words[w] + ' ';
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && w > 0) {
          ctx.fillText(line, 80, lineY);
          line = words[w] + ' ';
          lineY += 22;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, 80, lineY);

      // OCR line for Description
      ocrLines.push({
        text: item.desc,
        boundingBox: {
          left: 80 / canvas.width,
          top: (currentY + 10) / canvas.height,
          right: (canvas.width - 80) / canvas.width,
          bottom: (lineY + 15) / canvas.height,
          width: (canvas.width - 160) / canvas.width,
          height: (lineY - currentY + 5) / canvas.height
        },
        confidence: 0.94
      });

      // Optional variants / sizes line
      if (item.variants) {
        ctx.fillStyle = '#0369a1';
        ctx.font = 'bold 13px "Inter", Arial, sans-serif';
        ctx.fillText(`★ Tamaños disponibles: ${item.variants}`, 80, lineY + 24);

        ocrLines.push({
          text: `Tamaños: ${item.variants}`,
          boundingBox: {
            left: 80 / canvas.width,
            top: (lineY + 12) / canvas.height,
            right: 0.85,
            bottom: (lineY + 36) / canvas.height,
            width: 0.77,
            height: 24 / canvas.height
          },
          confidence: 0.92
        });
      }

      currentY += itemSpacing;
    }

    // Footer Page Number & Brand
    ctx.textAlign = 'center';
    ctx.fillStyle = '#a8a29e';
    ctx.font = '13px "Inter", Arial, sans-serif';
    ctx.fillText(`Página ${idx + 1} de ${SAMPLE_PAGES_CONFIG.length} — Menú Oficial Bella Napoli`, canvas.width / 2, canvas.height - 50);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    const ocrResult: OcrResult = {
      fullText: ocrLines.map(l => l.text).join('\n'),
      lines: ocrLines,
      textBlocks: [
        {
          text: ocrLines.map(l => l.text).join('\n'),
          boundingBox: { left: 0.05, top: 0.05, right: 0.95, bottom: 0.95, width: 0.9, height: 0.9 },
          lines: ocrLines,
          confidence: 0.96,
          recognizedLanguage: 'es'
        }
      ],
      imageWidth: canvas.width,
      imageHeight: canvas.height,
      pageNumber: idx + 1,
      detectedLanguage: 'es',
      processingTimeMs: 45
    };

    resultPages.push({
      id: `sample_page_${idx + 1}_${Date.now()}`,
      name: `Menú Pág. ${idx + 1} - ${cfg.categoryName}`,
      dataUrl,
      processedOcrDataUrl: dataUrl,
      mimeType: 'image/jpeg',
      rotation: 0,
      timestamp: new Date().toISOString(),
      fileSize: Math.round(dataUrl.length * 0.75),
      ocrResult,
      width: canvas.width,
      height: canvas.height
    });
  }

  return resultPages;
}
