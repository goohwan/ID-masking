import type { OCRResult } from './ocrHelper';
import { ID_PATTERNS, cleanOCRText } from './idPatterns';
import Tesseract from 'tesseract.js';

export interface MaskingRegion {
    id: string;
    type: string;
    bbox: Tesseract.Bbox;
    text: string;
}

export const identifySensitiveData = (ocrResult: OCRResult): MaskingRegion[] => {
    const regions: MaskingRegion[] = [];
    const words = ocrResult.words;

    // Simple word-based matching first
    // TODO: Implement more complex multi-word matching if needed

    words.forEach((word, index) => {
        const text = cleanOCRText(word.text);

        for (const pattern of ID_PATTERNS) {
            if (pattern.regex.test(text)) {
                regions.push({
                    id: `auto-${index}`,
                    type: pattern.name,
                    bbox: word.bbox,
                    text: word.text
                });
            }
        }
    });

    // Heuristic for split RRN (e.g. "123456" "-" "1234567")
    // This is a basic implementation and might need refinement
    for (let i = 0; i < words.length - 2; i++) {
        const w1 = words[i];
        const w2 = words[i + 1];
        const w3 = words[i + 2];

        const combined = cleanOCRText(w1.text + w2.text + w3.text);
        // Check if combined matches RRN pattern
        const rrnPattern = ID_PATTERNS.find(p => p.type === 'rrn')?.regex;

        if (rrnPattern && rrnPattern.test(combined)) {
            // Create a combined bbox
            const bbox = {
                x0: Math.min(w1.bbox.x0, w2.bbox.x0, w3.bbox.x0),
                y0: Math.min(w1.bbox.y0, w2.bbox.y0, w3.bbox.y0),
                x1: Math.max(w1.bbox.x1, w2.bbox.x1, w3.bbox.x1),
                y1: Math.max(w1.bbox.y1, w2.bbox.y1, w3.bbox.y1),
            };

            regions.push({
                id: `auto-combined-${i}`,
                type: 'Resident Registration Number (Combined)',
                bbox: bbox,
                text: combined
            });
        }
    }

    return regions;
};
