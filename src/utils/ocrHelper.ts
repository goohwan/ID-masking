import Tesseract from 'tesseract.js';

export interface OCRResult {
    text: string;
    words: {
        text: string;
        bbox: Tesseract.Bbox;
        confidence: number;
    }[];
    lines: {
        text: string;
        bbox: Tesseract.Bbox;
        words: {
            text: string;
            bbox: Tesseract.Bbox;
            confidence: number;
        }[];
    }[];
}

// Helper to preprocess image (Grayscale + High Contrast)
const preprocessImage = (imageFile: File): Promise<string> => {
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(imageFile);
        img.src = url;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(url); // fallback to original url if context fails
                return;
            }
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

            // Simple Grayscale & Contrast
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                // Luminosity formula
                const avg = 0.2126 * r + 0.7152 * g + 0.0722 * b;

                // Increase contrast
                // (val - 128) * contrast + 128
                const contrast = 1.3;
                let newVal = (avg - 128) * contrast + 128;
                if (newVal < 0) newVal = 0;
                if (newVal > 255) newVal = 255;

                data[i] = newVal;
                data[i + 1] = newVal;
                data[i + 2] = newVal;
                // Alpha remains same
            }
            ctx.putImageData(imageData, 0, 0);
            const dataUrl = canvas.toDataURL('image/jpeg');
            resolve(dataUrl);
            URL.revokeObjectURL(url);
        };
        img.onerror = () => {
            console.error("Image load error in preprocessing");
            resolve(url); // fallback
        };
    });
};

const preprocessWithTimeout = async (file: File): Promise<string | File> => {
    // 3 second timeout for preprocessing
    const timeout = new Promise<File>((resolve) => setTimeout(() => {
        console.warn("Preprocessing timed out, using original file");
        resolve(file);
    }, 3000));

    // We need to catch errors in preprocessImage too just in case
    const safeProcess = preprocessImage(file).catch(err => {
        console.error("Preprocessing error:", err);
        return file;
    });

    return Promise.race([safeProcess, timeout]);
};

export const performOCR = async (
    image: File | string,
    onProgress?: (progress: number) => void
): Promise<OCRResult> => {
    try {
        const worker = await Tesseract.createWorker('kor+eng', 1, {
            logger: m => {
                if (m.status === 'recognizing text') {
                    // Tesseract might report 0-1 or 0-100. Clamp and normalize.
                    let p = m.progress;
                    if (p > 1) {
                        // Assume it's already percentage
                    } else {
                        p = p * 100;
                    }
                    onProgress?.(Math.min(100, Math.round(p)));
                }
            },
            workerPath: '/ID-masking/tesseract/worker.min.js',
            corePath: '/ID-masking/tesseract/tesseract-core.wasm.js',
            cachePath: undefined,
        });

        let processedImage: string | File = image;
        if (image instanceof File) {
            processedImage = await preprocessWithTimeout(image);
        }

        const { data } = await worker.recognize(processedImage);

        await worker.terminate();

        // Robust Line Extraction: Tesseract sometimes nests lines in paragraphs/blocks
        let lines: any[] = (data as any).lines || [];
        if (lines.length === 0 && (data as any).blocks) {
            (data as any).blocks.forEach((block: any) => {
                (block.paragraphs || []).forEach((para: any) => {
                    (para.lines || []).forEach((line: any) => {
                        lines.push(line);
                    });
                });
            });
        }

        return {
            text: data.text,
            words: ((data as any).words || []).map((w: any) => ({
                text: w.text,
                bbox: w.bbox,
                confidence: w.confidence
            })),
            lines: lines.map((l: any) => ({
                text: l.text,
                bbox: l.bbox,
                words: (l.words || []).map((w: any) => ({
                    text: w.text,
                    bbox: w.bbox,
                    confidence: w.confidence
                }))
            }))
        };
    } catch (error) {
        console.error("OCR Failed:", error);
        throw error;
    }
};
