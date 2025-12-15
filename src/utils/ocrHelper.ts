import Tesseract from 'tesseract.js';

export interface OCRResult {
    text: string;
    words: {
        text: string;
        bbox: Tesseract.Bbox;
        confidence: number;
    }[];
}

export const performOCR = async (
    image: File | string,
    onProgress?: (progress: number) => void
): Promise<OCRResult> => {
    const worker = await Tesseract.createWorker('kor+eng', 1, {
        logger: m => {
            if (m.status === 'recognizing text') {
                onProgress?.(m.progress);
            }
        }
    });

    const { data } = await worker.recognize(image);

    await worker.terminate();

    return {
        text: data.text,
        words: ((data as any).words || []).map((w: any) => ({
            text: w.text,
            bbox: w.bbox,
            confidence: w.confidence
        }))
    };
};
