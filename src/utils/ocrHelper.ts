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
    debugData?: string;
}

// Helper to preprocess image (Grayscale + High Contrast) -> Returns a new File object
const preprocessImage = (imageFile: File): Promise<File> => {
    return new Promise((resolve, _reject) => {
        const img = new Image();
        const url = URL.createObjectURL(imageFile);

        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                // If context fails, return original file
                resolve(imageFile);
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
                // Luminosity
                const avg = 0.2126 * r + 0.7152 * g + 0.0722 * b;

                // Increase contrast
                const contrast = 1.3;
                let newVal = (avg - 128) * contrast + 128;
                if (newVal < 0) newVal = 0;
                if (newVal > 255) newVal = 255;

                data[i] = newVal;
                data[i + 1] = newVal;
                data[i + 2] = newVal;
            }
            ctx.putImageData(imageData, 0, 0);

            // output as Blob/File to avoid huge strings
            canvas.toBlob((blob) => {
                if (blob) {
                    const newFile = new File([blob], "preprocessed.jpg", { type: "image/jpeg" });
                    console.log("[preprocessImage] Converted to Blob File:", newFile.size);
                    resolve(newFile);
                } else {
                    resolve(imageFile);
                }
            }, 'image/jpeg', 0.9);

            URL.revokeObjectURL(url);
        };
        img.onerror = (e) => {
            console.error("Image load error:", e);
            resolve(imageFile);
        };
        img.src = url;
    });
};

const preprocessWithTimeout = async (file: File): Promise<File> => {
    let timeoutId: any;
    const timeout = new Promise<File>((resolve) => {
        timeoutId = setTimeout(() => {
            console.warn("Preprocessing timed out (15s), using original file");
            resolve(file);
        }, 15000);
    });

    const safeProcess = preprocessImage(file).then(res => {
        clearTimeout(timeoutId);
        return res;
    }).catch(err => {
        clearTimeout(timeoutId);
        console.error("Preprocessing error:", err);
        return file;
    });

    return Promise.race([safeProcess, timeout]);
};

// Helper to parse HOCR string if native objects are missing
const parseHOCR = (hocr: string): any[] => {
    console.log("parseHOCR called with length:", hocr.length); // Force update
    if (!hocr) return [];

    // In browser environment, use DOMParser
    const parser = new DOMParser();
    const doc = parser.parseFromString(hocr, 'text/html');

    const lines: any[] = [];
    const lineNodes = doc.getElementsByClassName('ocr_line');
    console.log(`[parseHOCR] Found ${lineNodes.length} line nodes`);

    Array.from(lineNodes).forEach((lineNode, _idx) => {
        const title = (lineNode as HTMLElement).title || "";
        // ... keeping existing logic
        const bboxMatch = title.match(/bbox (\d+) (\d+) (\d+) (\d+)/);
        let bbox = { x0: 0, y0: 0, x1: 0, y1: 0 };
        if (bboxMatch) {
            bbox = {
                x0: parseInt(bboxMatch[1]),
                y0: parseInt(bboxMatch[2]),
                x1: parseInt(bboxMatch[3]),
                y1: parseInt(bboxMatch[4])
            };
        }

        const words: any[] = [];
        const wordNodes = lineNode.getElementsByClassName('ocrx_word');
        // console.log(`[parseHOCR] Line ${idx} has ${wordNodes.length} words`);

        Array.from(wordNodes).forEach(wordNode => {
            // ... existing word logic
            const wTitle = (wordNode as HTMLElement).title || "";
            const wBboxMatch = wTitle.match(/bbox (\d+) (\d+) (\d+) (\d+)/);
            let wBbox = { x0: 0, y0: 0, x1: 0, y1: 0 };
            if (wBboxMatch) {
                wBbox = {
                    x0: parseInt(wBboxMatch[1]),
                    y0: parseInt(wBboxMatch[2]),
                    x1: parseInt(wBboxMatch[3]),
                    y1: parseInt(wBboxMatch[4])
                };
            }

            words.push({
                text: wordNode.textContent || "",
                bbox: wBbox,
                confidence: 100
            });
        });

        const lineText = words.map(w => w.text).join(' ');
        const finalLineText = lineText || (lineNode.textContent || "").trim();

        if (finalLineText) {
            lines.push({
                text: finalLineText,
                bbox: bbox,
                words: words
            });
        }
    });

    console.log(`[parseHOCR] Returning ${lines.length} lines`);
    return lines;
};

// Helper to reconstruct lines from words if Tesseract structure fails
const reconstructLinesFromWords = (words: any[]): any[] => {
    // Sort words by Y position then X
    const sortedWords = [...words].sort((a, b) => {
        const yDiff = a.bbox.y0 - b.bbox.y0;
        if (Math.abs(yDiff) < 10) return a.bbox.x0 - b.bbox.x0;
        return yDiff;
    });

    const lines: any[] = [];
    let currentLine: any = null;

    sortedWords.forEach(word => {
        if (!currentLine) {
            currentLine = { words: [word], bbox: { ...word.bbox } };
        } else {
            const verticalCenter = (currentLine.bbox.y0 + currentLine.bbox.y1) / 2;
            const wordVerticalCenter = (word.bbox.y0 + word.bbox.y1) / 2;
            const height = currentLine.bbox.y1 - currentLine.bbox.y0;

            if (Math.abs(verticalCenter - wordVerticalCenter) < (height * 0.6)) {
                currentLine.words.push(word);
                currentLine.bbox.x0 = Math.min(currentLine.bbox.x0, word.bbox.x0);
                currentLine.bbox.y0 = Math.min(currentLine.bbox.y0, word.bbox.y0);
                currentLine.bbox.x1 = Math.max(currentLine.bbox.x1, word.bbox.x1);
                currentLine.bbox.y1 = Math.max(currentLine.bbox.y1, word.bbox.y1);
            } else {
                currentLine.text = currentLine.words.map((w: any) => w.text).join(' ');
                lines.push(currentLine);
                currentLine = { words: [word], bbox: { ...word.bbox } };
            }
        }
    });

    if (currentLine) {
        currentLine.text = currentLine.words.map((w: any) => w.text).join(' ');
        lines.push(currentLine);
    }

    return lines;
};

// Helper wrapper around Tesseract.js
export const performOCR = async (
    image: File | string,
    _onProgress?: (progress: number) => void
): Promise<OCRResult> => {
    try {
        console.log("[performOCR] Starting Tesseract v5 (Downgraded)...");

        // Debug: Check if traineddata file is actually accessible
        const checkUrlEng = '/ID-masking/tesseract/eng.traineddata';

        try {
            const resp = await fetch(checkUrlEng, { method: 'HEAD' });
            console.log(`[performOCR] Eng check: ${checkUrlEng} -> ${resp.status}`);
        } catch (e) { console.error(e); }

        // 1. Create worker (v5 style) - Default CDN
        // Reverting to defaults to fix 'x.map' crash.
        const worker: any = await Tesseract.createWorker();

        // 2. Load Language & Initialize (Required in v5)
        console.log("[performOCR] Loading language 'kor+eng'...");
        await worker.loadLanguage('kor+eng');
        console.log("[performOCR] Initializing 'kor+eng'...");
        await worker.initialize('kor+eng');

        // 3. Set parameters (Restore structure requests)
        console.log("[performOCR] Setting parameters for structure...");
        await worker.setParameters({
            tessedit_pageseg_mode: Tesseract.PSM ? Tesseract.PSM.AUTO : 3 as any,
            tessedit_create_hocr: '1',
            tessedit_create_tsv: '1',
            tessedit_create_box: '1',
            tessedit_create_unlv: '1',
            tessedit_create_osd: '1',
        });

        let processedImage: File | string = image;
        if (image instanceof File) {
            processedImage = await preprocessWithTimeout(image);
        }

        console.log("[performOCR] Recognizing...");
        const { data } = await worker.recognize(processedImage);
        console.log("[performOCR] Recognition complete. Keys:", Object.keys(data));


        await worker.terminate();

        const debugKeys = Object.keys(data);
        const debugInfo = {
            hasHocr: !!data.hocr,
            hocrLength: data.hocr?.length,
            textLen: data.text?.length,
            hasWords: !!(data as any).words,
            wordsLen: (data as any).words?.length,
            hasLines: !!(data as any).lines,
            linesLen: (data as any).lines?.length,
            hasBlocks: !!(data as any).blocks,
            blocksLen: (data as any).blocks?.length,
            hocrType: typeof data.hocr,
            hocrVal: String(data.hocr).substring(0, 50),
            linesType: typeof (data as any).lines,
            wordsType: typeof (data as any).words,
            hocrSnippet: data.hocr ? data.hocr.substring(0, 200) + "..." : "N/A",
            tsvSnippet: (data as any).tsv ? (data as any).tsv.substring(0, 200) + "..." : "N/A",
            boxSnippet: (data as any).box ? (data as any).box.substring(0, 200) + "..." : "N/A",
            unlvSnippet: (data as any).unlv ? (data as any).unlv.substring(0, 200) + "..." : "N/A",
            // key list last
            keys: debugKeys,
        };


        // 1. Try Tesseract's nested lines from blocks
        let lines: any[] = [];
        if ((data as any).blocks) {
            (data as any).blocks.forEach((block: any) => {
                (block.paragraphs || []).forEach((para: any) => {
                    (para.lines || []).forEach((line: any) => {
                        lines.push(line);
                    });
                });
            });
        }

        // Fallback to top-level lines if blocks empty
        if (lines.length === 0 && (data as any).lines) {
            lines = (data as any).lines;
        }

        let words = ((data as any).words || []).map((w: any) => ({
            text: w.text,
            bbox: w.bbox,
            confidence: w.confidence
        }));

        // 2. Fallback: Parse HOCR if lines AND words are missing but hocr exists
        if (lines.length === 0 && words.length === 0 && data.hocr) {
            console.warn("OCR: Native objects empty, parsing HOCR.");
            const hocrLines = parseHOCR(data.hocr);
            lines = hocrLines;

            // Also populate words flat array for completeness
            words = [];
            lines.forEach(l => {
                l.words.forEach((w: any) => words.push(w));
            });
        }
        // 3. Fallback: Reconstruct lines from words if words exist but lines don't
        else if (lines.length === 0 && words.length > 0) {
            console.warn("OCR: Native lines empty, reconstructing from words.");
            lines = reconstructLinesFromWords(words);
        }
        // 4. Fallback: Text Only (Worst Case)
        else if (lines.length === 0 && data.text && data.text.length > 0) {
            console.warn("OCR: No structural data found. Falling back to raw text parsing.");
            const rawLines = data.text.split(/\r?\n/).filter((line: string) => line.trim().length > 0);

            // Create dummy lines with fake bboxes to allow parsing logic to work
            lines = rawLines.map((lineText: string, index: number) => ({
                text: lineText,
                bbox: { x0: 0, y0: index * 20, x1: 500, y1: (index * 20) + 18 }, // Fake vertical stacking
                words: lineText.split(/\s+/).map((wordText: string, wIndex: number) => ({
                    text: wordText,
                    bbox: { x0: wIndex * 50, y0: index * 20, x1: (wIndex * 50) + 40, y1: (index * 20) + 18 },
                    confidence: 0
                }))
            }));

            // Also populate flat words array for completeness
            words = [];
            lines.forEach(l => {
                l.words.forEach((w: any) => words.push(w));
            });
        }

        return {
            text: data.text,
            words: words,
            lines: lines.map((l: any) => ({
                text: l.text,
                bbox: l.bbox,
                words: (l.words || []).map((w: any) => ({
                    text: w.text,
                    bbox: w.bbox,
                    confidence: w.confidence
                }))
            })),
            debugData: JSON.stringify(debugInfo, null, 2)
        };
    } catch (error) {
        console.error("OCR Failed:", error);
        throw error;
    }
};
