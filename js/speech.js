// Módulo de Reconocimiento de Voz para ListExpress
// Utiliza la Web Speech API nativa en navegadores móviles (Chrome Android, Safari iOS)
// Permite agregar productos dictando con la voz sin tener que tipear.

const VoiceInput = {
    recognition: null,
    isListening: false,

    isSupported: function () {
        return Boolean('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
    },

    init: function () {
        if (!this.isSupported()) return null;
        const SpeechClass = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechClass();
        this.recognition.lang = 'es-PE'; // Español de Perú / LatAm
        this.recognition.continuous = false;
        this.recognition.interimResults = false;
        return this.recognition;
    },

    /**
     * Inicia la escucha por voz
     * @param {Object} callbacks { onStart, onResult, onError, onEnd }
     */
    startListening: function (callbacks = {}) {
        if (!this.isSupported()) {
            if (callbacks.onError) callbacks.onError('El reconocimiento de voz no está soportado en este navegador.');
            return;
        }

        if (!this.recognition) {
            this.init();
        }

        this.recognition.onstart = () => {
            this.isListening = true;
            if (callbacks.onStart) callbacks.onStart();
        };

        this.recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            const parsed = this.parseSpanishVoiceText(transcript);
            if (callbacks.onResult) {
                callbacks.onResult({
                    rawText: transcript,
                    ...parsed
                });
            }
        };

        this.recognition.onerror = (event) => {
            this.isListening = false;
            let errorMsg = 'Error en el reconocimiento de voz';
            if (event.error === 'not-allowed') {
                errorMsg = 'Permiso de micrófono denegado.';
            } else if (event.error === 'no-speech') {
                errorMsg = 'No se detectó ninguna voz.';
            }
            if (callbacks.onError) callbacks.onError(errorMsg);
        };

        this.recognition.onend = () => {
            this.isListening = false;
            if (callbacks.onEnd) callbacks.onEnd();
        };

        try {
            this.recognition.start();
        } catch (e) {
            console.warn('Error al iniciar SpeechRecognition:', e);
        }
    },

    stopListening: function () {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
            this.isListening = false;
        }
    },

    /**
     * Convierte palabras numéricas comunes en español a números
     */
    wordToNumber: function (word) {
        const numbers = {
            'un': 1, 'una': 1, 'uno': 1,
            'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
            'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
            'once': 11, 'doce': 12, 'trece': 13, 'catorce': 14, 'quince': 15,
            'veinte': 20, 'treinta': 30, 'cuarenta': 40, 'cincuenta': 50
        };
        return numbers[word.toLowerCase()] || null;
    },

    /**
     * Interpreta la frase dictada en español para extraer Nombre, Cantidad y Precio
     * Ejemplos soportados:
     * - "tres leches gloria a cuatro soles cincuenta"
     * - "arroz costeño 5 kilos a 22.50"
     * - "detergente ariel quince soles"
     * - "aceite primor 11 con 90"
     */
    parseSpanishVoiceText: function (transcript) {
        if (!transcript) return { name: '', quantity: 1, price: 0 };

        let text = transcript.trim();
        let quantity = 1;
        let price = 0;

        // 1. Extraer cantidad al inicio si existe (ej. "3 latas...", "dos paquetes...")
        const qtyMatch = text.match(/^(\d+|\b(un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce)\b)\s+(?:de\s+)?(.*)/i);
        if (qtyMatch) {
            const firstToken = qtyMatch[1];
            const num = parseInt(firstToken, 10);
            if (!isNaN(num)) {
                quantity = num;
            } else {
                quantity = this.wordToNumber(firstToken) || 1;
            }
            text = qtyMatch[3]; // Resto del texto
        }

        // 2. Extraer precio al final de la frase
        // Casos: "a 15 soles con 50", "a 15.50", "15 soles", "12 con 90", "14 soles cincuenta"
        const pricePattern = /(?:a\s+|cuesta\s+|precio\s+)?(\d{1,4}(?:[.,]\d{1,2})?|\b[a-záéíóú]+\b)\s*(?:soles?|sol|pesos?|dólares?)?\s*(?:con|punto)?\s*(\d{1,2}|\b[a-záéíóú]+\b)?\s*$/i;
        
        // Buscar primero precio numérico explícito al final
        const directNumMatch = text.match(/(?:a\s+|cuesta\s+)?(?:s\/?\.?\s*)?(\d{1,4}[.,]\d{1,2})\s*(?:soles?)?$/i);
        if (directNumMatch) {
            price = parseFloat(directNumMatch[1].replace(',', '.'));
            text = text.substring(0, directNumMatch.index).trim();
        } else {
            // Caso: "X soles con Y" o "X soles"
            const complexMatch = text.match(/(?:a\s+|cuesta\s+)?(\d+)\s*(?:soles?)?(?:\s*(?:con|y|punto)\s*(\d{1,2}))?\s*(?:soles?|céntimos)?$/i);
            if (complexMatch && complexMatch.index > 0) {
                const enteros = parseInt(complexMatch[1], 10);
                const centimos = complexMatch[2] ? parseInt(complexMatch[2], 10) : 0;
                // Si centimos es ej "5" suele ser 50 céntimos cuando se habla
                const dec = centimos < 10 && complexMatch[2].length === 1 ? centimos * 10 : centimos;
                price = enteros + (dec / 100);
                text = text.substring(0, complexMatch.index).trim();
            }
        }

        // Limpiar conectores finales del nombre ("a", "por", "en")
        let name = text
            .replace(/\b(a|por|en|precio)\s*$/i, '')
            .trim();

        // Capitalizar nombre
        if (name) {
            name = name.charAt(0).toUpperCase() + name.slice(1);
        }

        return {
            name,
            quantity,
            price: Number(price.toFixed(2))
        };
    }
};
