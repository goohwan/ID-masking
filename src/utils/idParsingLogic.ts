import type { OCRResult } from './ocrHelper';
import Tesseract from 'tesseract.js';

export interface ParsedField {
    id: string; // unique ID for toggling
    label: string;
    value: string; // The recognized text
    ids: string[]; // List of IDs (words/lines) that make up this field (for multi-selection if needed) or just use bbox
    bbox: Tesseract.Bbox;
}

export interface ParsedIDData {
    idType: string;
    fields: ParsedField[];
}

// Helper to merge bboxes
const mergeBBoxes = (bboxes: Tesseract.Bbox[]): Tesseract.Bbox => {
    if (bboxes.length === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
    return {
        x0: Math.min(...bboxes.map(b => b.x0)),
        y0: Math.min(...bboxes.map(b => b.y0)),
        x1: Math.max(...bboxes.map(b => b.x1)),
        y1: Math.max(...bboxes.map(b => b.y1))
    };
};

export const parseOCRResult = (result: OCRResult): ParsedIDData => {
    const text = result.text || "";
    let idType = "Unknown";
    const fields: ParsedField[] = [];

    const lines = result.lines || [];
    const words = result.words || [];

    // --- Regex Definitions ---

    // RRN: 6 digits - 7 digits (allow spaces everywhere)
    // Try: 6 digits, then any non-digits (or nothing), then 7 digits (first being 1-4)
    const rrnRegex = /(\d{6})[^0-9]*([1-4][0-9\s]{6,})/;

    // DL Number:
    // Pattern: 2 digits - 6 digits - 2 digits (Total 10) OR 2-2-6-2 (Total 12)
    // Relaxed separator: [^0-9]+
    // "05-009337-70"
    const dlRegex = /(\d{2})[^0-9]+(\d{6})[^0-9]+(\d{2})/;

    // Passport: Letter + 8 digits
    const passportNumRegex = /[A-Z][0-9A-Z]{8}/;


    // --- 1. Field Extraction (Run first to help ID Type inference) ---

    // Resident Registration Number (RRN)
    lines.forEach((line, idx) => {
        const match = line.text.match(rrnRegex);
        if (match) {
            // Check if clean count is 13 digits
            const digits = match[0].replace(/\D/g, '');
            if (digits.length >= 13) {
                fields.push({
                    id: `rrn-${idx}`,
                    label: "주민등록번호",
                    value: match[0],
                    ids: [`line-${idx}`],
                    bbox: line.bbox
                });
            }
        }
    });

    // Driver License Number
    lines.forEach((line, idx) => {
        // Check for 10-digit pattern (Region Text + Num) or 12-digit
        const match = line.text.match(dlRegex);
        if (match) {
            // Verify digit count to be safe
            const digits = match[0].replace(/\D/g, '');
            if (digits.length >= 10) {
                // It is likely a DL number
                fields.push({
                    id: `dl-num-${idx}`,
                    label: "운전면허번호",
                    value: match[0],
                    ids: [`line-${idx}`],
                    bbox: line.bbox
                });
            }
        }
    });

    // Passport Number
    words.forEach((word, idx) => {
        if (word.text.length === 9 && passportNumRegex.test(word.text)) {
            fields.push({
                id: `passport-num-${idx}`,
                label: "여권번호",
                value: word.text,
                ids: [],
                bbox: word.bbox
            });
        }
    });


    // --- 2. Determine ID Type (Keyword + Inference) ---

    if (text.includes("운전") || text.toLowerCase().includes("driver") || text.toLowerCase().includes("drivers")) {
        idType = "운전면허증";
    } else if (text.includes("주민") || text.includes("등록증")) {
        idType = "주민등록증";
    } else if (text.includes("여권") || text.includes("PASSPORT")) {
        idType = "여권";
    } else {
        // Inference
        const hasDL = fields.some(f => f.label === "운전면허번호");
        const hasPassport = fields.some(f => f.label === "여권번호");
        const hasRRN = fields.some(f => f.label === "주민등록번호");

        if (hasDL) {
            idType = "운전면허증";
        } else if (hasPassport) {
            idType = "여권";
        } else if (hasRRN) {
            // RRN is common to both DL and Resident Card, but if no DL number found, maybe Resident Card?
            // Or Unknown but at least likely a Korean ID.
            // Let's default to 주민등록증 if it looks like one (e.g. title missing but has RRN and Name?)
            // Safe to leave Unknown or guess Residents.
            idType = "주민등록증(추정)";
        }
    }


    // --- 3. Extract Additional Fields based on Determined ID Type ---

    // Address extraction (Generic)
    const regions = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충청", "전라", "전북", "경상", "제주", "충북", "충남", "전남", "경북", "경남"];

    for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i].text.replace(/\s/g, '');
        const hasRegion = regions.some(r => lineText.includes(r));

        if (hasRegion) {
            // Additional heuristic: Address usually contains "시", "구", "동", "읍", "면", "길"
            if (!/[시구동읍면길]/.test(lines[i].text)) {
                // If the line is JUST a region name (e.g. "전북"), check next line
                // But usually address starts with that.
                // Let's be permissive.
            }

            const addressLines = [lines[i]];
            for (let j = 1; j <= 3; j++) {
                if (i + j < lines.length) {
                    const nextLine = lines[i + j];
                    const currentHeight = lines[i].bbox.y1 - lines[i].bbox.y0;
                    const gap = nextLine.bbox.y0 - lines[i + j - 1].bbox.y1;

                    if (gap > currentHeight * 2.5) break;
                    // Stop if date-like (YYYY.MM.DD) as that is likely Issue Date or Period
                    if (/\d{4}[.-]\d{2}[.-]\d{2}/.test(nextLine.text)) break;

                    addressLines.push(nextLine);
                }
            }

            // Only add if we haven't added an address yet or this looks "better"?
            // Simple logic: just one address.
            const fullAddress = addressLines.map(l => l.text).join(" ");
            const mergedBBox = mergeBBoxes(addressLines.map(l => l.bbox));

            // Check overlap with DL number? (Sometimes Region is in both)
            // If the same line is used for DL number, don't use it for address.
            const isDLLine = fields.some(f => f.label === "운전면허번호" && f.bbox.y0 === lines[i].bbox.y0); // rough check

            if (!isDLLine) {
                fields.push({
                    id: `addr-${i}`,
                    label: "주소",
                    value: fullAddress,
                    ids: addressLines.map((_, idx) => `addr-line-${i}-${idx}`),
                    bbox: mergedBBox
                });
                break;
            }
        }
    }


    if (idType.includes("운전면허증")) {
        // Renewal Period
        const periodRegex = /\d{4}\s*[.\-]\s*\d{2}\s*[.\-]\s*\d{2}\s*~\s*\d{4}\s*[.\-]\s*\d{2}\s*[.\-]\s*\d{2}/;
        lines.forEach((line, idx) => {
            if (periodRegex.test(line.text)) {
                fields.push({
                    id: `period-${idx}`,
                    label: "갱신기간",
                    value: line.text,
                    ids: [],
                    bbox: line.bbox
                });
            }
        });

        // Issue Date (Single date, not period)
        const dateRegex = /(\d{4}\s*[.\-]\s*\d{2}\s*[.\-]\s*\d{2})/;
        // Search from bottom
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            const match = line.text.match(dateRegex);
            if (match) {
                // Check if it's already used in period
                const isPeriod = periodRegex.test(line.text);
                // Check if it's DOB in RRN
                // RRN usually doesn't have YYYY.MM.DD format, just digits.

                if (!isPeriod) {
                    fields.push({
                        id: `issue-date-${i}`,
                        label: "발급일",
                        value: match[0],
                        ids: [],
                        bbox: line.bbox
                    });
                    break;
                }
            }
        }

        // Identification Number (Alpha+Num 6 chars)
        const idNumRegex = /^[A-Z0-9]{6}$/;
        words.forEach((word, idx) => {
            // Heuristic: Length 6, mixed alpha/num if possible
            if (idNumRegex.test(word.text) && word.text.length === 6) {
                const isDatePart = /^\d+$/.test(word.text); // Pure digits might be date parts
                // User's example "78711P" or "AB1234"
                const hasAlpha = /[A-Z]/.test(word.text);
                if (hasAlpha) {
                    fields.push({
                        id: `id-code-${idx}`,
                        label: "식별번호",
                        value: word.text,
                        ids: [],
                        bbox: word.bbox
                    });
                }
            }
        });

    } else if (idType.includes("여권")) {
        // Issue Date: Dates after "SEX" or "성별"
        let sexIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].text.includes("SEX") || lines[i].text.includes("성별") || lines[i].text.includes("/F") || lines[i].text.includes("/M")) {
                sexIndex = i;
                break;
            }
        }

        if (sexIndex !== -1) {
            const dateFields = [];
            for (let i = sexIndex; i < lines.length; i++) {
                if (/\d/.test(lines[i].text) && (lines[i].text.includes("JAN") || lines[i].text.includes("Feb") || lines[i].text.includes("20"))) {
                    dateFields.push(lines[i]);
                }
            }
            if (dateFields.length > 0) {
                fields.push({
                    id: `passport-dates`,
                    label: "발급일",
                    value: dateFields.map(l => l.text).join(" / "),
                    ids: [],
                    bbox: mergeBBoxes(dateFields.map(l => l.bbox))
                });
            }
        }
    }

    return {
        idType,
        fields
    };
};
