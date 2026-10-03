// Módulo de Reconocimiento Óptico de Caracteres (OCR) para Etiquetas de Góndola
// Utiliza Tesseract.js directamente en el navegador del cliente (compatible con GitHub Pages)

const ShelfTagOCR = {
    worker: null,
    isProcessing: false,

    /**
     * Limpia y preprocesa una imagen en un Canvas HTML para mejorar el reconocimiento de texto
     */
    preprocessImage: function (imageElement) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Escalar manteniendo proporción con un ancho estándar para OCR óptimo (1200px)
        const scale = Math.min(1, 1600 / Math.max(imageElement.width, imageElement.height));
        canvas.width = Math.round(imageElement.width * scale);
        canvas.height = Math.round(imageElement.height * scale);

        ctx.drawImage(imageElement, 0, 0, canvas.width, canvas.height);

        // Ajuste de contraste y escala de grises
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;

        for (let i = 0; i < data.length; i += 4) {
            // Conversión a escala de grises ponderada
            const gray = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
            
            // Aumento de contraste simple
            const contrast = 1.25;
            const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
            const adjusted = Math.min(255, Math.max(0, factor * (gray - 128) + 128));

            data[i] = adjusted;
            data[i + 1] = adjusted;
            data[i + 2] = adjusted;
        }

        ctx.putImageData(imgData, 0, 0);
        return canvas;
    },

    /**
     * Procesa una imagen dada (Blob, File o DataURL) con Tesseract.js
     * @param {File|Blob|string} imageSource 
     * @param {Function} onProgress Callback de progreso (0 a 100)
     * @returns {Promise<{name: string, price: number, rawText: string}>}
     */
    recognizeTag: async function (imageSource, onProgress = () => {}) {
        if (typeof Tesseract === 'undefined') {
            throw new Error('Tesseract.js no está cargado. Asegúrate de tener conexión o la librería en caché.');
        }

        this.isProcessing = true;

        try {
            // Cargar imagen en un elemento HTMLImageElement para poder preprocesar
            const img = await this.loadImage(imageSource);
            const processedCanvas = this.preprocessImage(img);

            const result = await Tesseract.recognize(
                processedCanvas,
                'spa+eng',
                {
                    logger: m => {
                        if (m.status === 'recognizing text' && m.progress) {
                            onProgress(Math.round(m.progress * 100));
                        }
                    }
                }
            );

            const text = result.data.text || '';
            const parsed = this.parseShelfTagText(text);

            return {
                name: parsed.name,
                price: parsed.price,
                allPricesFound: parsed.allPricesFound,
                rawText: text,
                confidence: result.data.confidence
            };
        } finally {
            this.isProcessing = false;
        }
    },

    /**
     * Carga una fuente de imagen en un elemento Image de JS
     */
    loadImage: function (source) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => resolve(img);
            img.onerror = (e) => reject(new Error('No se pudo cargar la imagen seleccionada.'));

            if (typeof source === 'string') {
                img.src = source;
            } else if (source instanceof Blob || source instanceof File) {
                img.src = URL.createObjectURL(source);
            } else {
                reject(new Error('Formato de imagen no soportado.'));
            }
        });
    },

    /**
     * Analiza el texto en bruto devuelto por el OCR para deducir el Nombre del Producto y su Precio
     * Optimizado para etiquetas de supermercados (Plaza Vea, Metro, Tottus, Wong, etc.)
     */
    parseShelfTagText: function (rawText) {
        if (!rawText) return { name: '', price: 0, allPricesFound: [] };

        const lines = rawText.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0);

        // Palabras a ignorar que son comunes en flejes de góndola
        const ignoredWords = [
            'precio', 'regular', 'oferta', 'vigencia', 'unidad', 'unid', 'un', 'ruc',
            'supermercados', 'metro', 'vea', 'tottus', 'wong', 'vivanda', 'plazavea',
            'codigo', 'cod', 'sku', 'ean', 'p.unit', 'p.u', 'x kg', 'x lt', 'x gr',
            'tarjeta', 'oh', 'cencosud', 'falabella', 'exclusivo', 'total', 'peso'
        ];

        // 1. Extraer todos los números candidatos a precios
        // Patrones tipo: S/ 14.90, S/. 9.50, 19,90, 8.50, $ 12.00
        const priceRegex = /(?:s\/?\.?\s*|\$\s*)?(\d{1,4}[.,]\d{2})(?!\d)/gi;
        const pricesFound = [];
        let match;

        for (const line of lines) {
            // Verificar si es una línea de precio por kilo/litro (suele ser secundaria)
            const isUnitPriceLine = /x\s*(kg|lt|litro|kilo|gr|g|ml)/i.test(line);

            while ((match = priceRegex.exec(line)) !== null) {
                const rawNum = match[1].replace(',', '.');
                const val = parseFloat(rawNum);
                if (!isNaN(val) && val > 0 && val < 5000) {
                    pricesFound.push({
                        val,
                        line,
                        isSecondary: isUnitPriceLine,
                        isOffer: /oferta|rebaja|exclusivo|ahora/i.test(line)
                    });
                }
            }
        }

        // Selección del precio más probable:
        // Priorizar precios asociados a "oferta" o aquellos que no sean "precio x kg"
        let chosenPrice = 0;
        if (pricesFound.length > 0) {
            const offerPrice = pricesFound.find(p => p.isOffer);
            const mainPrices = pricesFound.filter(p => !p.isSecondary);

            if (offerPrice) {
                chosenPrice = offerPrice.val;
            } else if (mainPrices.length > 0) {
                // Tomar el valor más frecuente o el primero prominente
                chosenPrice = mainPrices[0].val;
            } else {
                chosenPrice = pricesFound[0].val;
            }
        }

        // 2. Extraer el nombre del producto
        // Buscar líneas de texto que tengan letras, ignorando números puros y palabras comunes de fleje
        const candidateNameLines = [];

        for (const line of lines) {
            const cleanLine = line.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s]/g, ' ').trim();
            const lower = cleanLine.toLowerCase();

            // Descartar líneas muy cortas o que son puramente números
            if (cleanLine.length < 3 || /^\d+$/.test(cleanLine)) continue;

            // Descartar si solo contiene precios
            if (/^(s\/?\.?|\$)?\s*\d+([.,]\d{2})?$/i.test(line)) continue;

            // Descartar si coincide enteramente con una palabra ignorada
            const isIgnored = ignoredWords.some(w => lower === w || lower.startsWith(w + ' '));
            if (isIgnored && cleanLine.length < 15) continue;

            // Si contiene más de 3 letras alfabéticas consecutivas, es buen candidato
            if (/[a-zA-Z]{3,}/.test(cleanLine)) {
                // Limpiar prefijos de precios o códigos
                const sanitized = cleanLine
                    .replace(/\b(s\/?\.?|\$)\b/gi, '')
                    .replace(/\b\d{6,}\b/g, '') // descartar códigos EAN largos
                    .trim();

                if (sanitized.length >= 3) {
                    candidateNameLines.push(sanitized);
                }
            }
        }

        // Tomar la línea más representativa (o unir las 2 primeras líneas de descripción)
        let chosenName = '';
        if (candidateNameLines.length > 0) {
            chosenName = candidateNameLines.slice(0, 2).join(' ').trim();
            // Capitalizar estilo título
            chosenName = chosenName.charAt(0).toUpperCase() + chosenName.slice(1).toLowerCase();
        }

        return {
            name: chosenName,
            price: chosenPrice,
            allPricesFound: pricesFound.map(p => p.val)
        };
    }
};
