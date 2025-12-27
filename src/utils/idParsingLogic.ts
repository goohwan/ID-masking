import type { OCRResult } from './ocrHelper';
import Tesseract from 'tesseract.js';

export interface ParsedField {
    id: string;
    label: string;
    value: string;
    ids: string[];
    bbox: Tesseract.Bbox;
}

export interface ParsedIDData {
    idType: string;
    fields: ParsedField[];
    logs?: string[];
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

// Helper to interpolate bbox horizontally
const interpolateBBox = (fullBBox: Tesseract.Bbox, totalLength: number, start: number, length: number): Tesseract.Bbox => {
    const width = fullBBox.x1 - fullBBox.x0;
    const charWidth = width / totalLength;

    // Add a small buffer to x0 and x1 to ensure coverage, but don't exceed bounds too much
    const x0 = fullBBox.x0 + (charWidth * start);
    const x1 = fullBBox.x0 + (charWidth * (start + length));

    return {
        x0: Math.floor(x0),
        y0: fullBBox.y0,
        x1: Math.ceil(x1),
        y1: fullBBox.y1
    };
};

export const parseOCRResult = (result: OCRResult): ParsedIDData => {
    const text = result.text || "";
    let idType = "Unknown";
    const fields: ParsedField[] = [];

    const lines = result.lines || [];
    const words = result.words || [];

    const logs: string[] = [];
    logs.push(`Text len: ${text.length}, Lines: ${lines.length}, Words: ${words.length}`);

    // --- Regex Definitions ---
    // RRN: 6 digits - 7 digits (allow spaces everywhere)
    const rrnRegex = /(\d{6})[^0-9]*([1-4][0-9\s]{6,})/;

    // DL Number: 12 digits total usually
    const dlRegex = /(\d{2})[^0-9]+(\d{6})[^0-9]+(\d{2})/;

    // Passport: Letter + 8 digits
    const passportNumRegex = /[A-Z][0-9A-Z]{8}/;


    // --- 1. Field Extraction ---

    // Resident Registration Number (RRN)
    lines.forEach((line, idx) => {
        const match = line.text.match(rrnRegex);
        if (match) {
            const digits = match[0].replace(/\D/g, '');
            if (digits.length >= 13) {
                // Determine positions in the original string to estimate bbox
                // This is a naive estimation assuming monospace. 
                // match[0] is the full string found in the line (e.g. "810627-1234567")

                fields.push({
                    id: `rrn-${idx}`,
                    label: "주민등록번호",
                    value: match[0],
                    ids: [`line-${idx}`],
                    bbox: line.bbox
                });
                logs.push(`Found RRN on line ${idx}: ${match[0]}`);

                // Split RRN into Date of Birth, Gender, and Back Number
                // Use regex capture groups to locate parts
                // match[1] = Birth Date (6 digits)
                // match[2] = Gender + Back Number (digits + potential spaces)

                const birthPartRaw = match[1];
                const backPartRaw = match[2];

                // Calculate Visual Range of the match to ignore leading/trailing unknown whitespace effects on BBox
                // The BBox covers the VISIBLE text. The match string might have wider reach if regex captures spaces.
                // We trust that line.bbox covers from "First non-space char" to "Last non-space char" of the match (if match is whole line).

                // Let's find relative start/end of visible chars in match[0]
                const matchString = match[0];
                let firstVisibleIdx = 0;
                let lastVisibleIdx = matchString.length - 1;

                while (firstVisibleIdx < matchString.length && /\s/.test(matchString[firstVisibleIdx])) firstVisibleIdx++;
                while (lastVisibleIdx >= 0 && /\s/.test(matchString[lastVisibleIdx])) lastVisibleIdx--;

                const visibleLength = (lastVisibleIdx >= firstVisibleIdx) ? (lastVisibleIdx - firstVisibleIdx + 1) : matchString.length;

                // --- 1. Birth Date ---
                const birthStartIndex = matchString.indexOf(birthPartRaw);
                const birthLength = birthPartRaw.length;
                const birthDate = birthPartRaw;

                // --- 2. Gender & Back Number ---
                const backPartStartIndex = matchString.lastIndexOf(backPartRaw);

                // Find digits in backPartRaw
                const digitIndices: number[] = [];
                for (let i = 0; i < backPartRaw.length; i++) {
                    if (/[0-9]/.test(backPartRaw[i])) {
                        digitIndices.push(i);
                    }
                }

                let genderGlobalIndex = backPartStartIndex;
                let genderLength = 1;
                let genderVal = "0";

                let backNumGlobalIndex = backPartStartIndex;
                let backNumLength = 0;
                let backNumVal = "";

                if (digitIndices.length >= 7) {
                    // Gender is 1st digit
                    const genderLocalIdx = digitIndices[0];
                    genderGlobalIndex = backPartStartIndex + genderLocalIdx;
                    genderLength = 1;
                    genderVal = backPartRaw[genderLocalIdx];

                    // Back Number is 2nd to 7th digit
                    const startBackLocalIdx = digitIndices[1];
                    const endBackLocalIdx = digitIndices[6]; // 7th digit

                    backNumGlobalIndex = backPartStartIndex + startBackLocalIdx;
                    backNumLength = (endBackLocalIdx - startBackLocalIdx) + 1;
                    backNumVal = backPartRaw.substring(startBackLocalIdx, endBackLocalIdx + 1).replace(/\D/g, '');
                } else {
                    genderVal = digits.substring(6, 7);
                    backNumVal = digits.substring(7, 13);
                }

                // --- Helper Wrapper for Visible Range Interpolation ---
                const getBBoxForRange = (start: number, len: number) => {
                    // Adjust start relative to firstVisibleIdx
                    const relativeStart = start - firstVisibleIdx;
                    // If content starts before visible area (unlikely for RRN), clamp?
                    // normalize logic
                    return interpolateBBox(line.bbox, visibleLength, relativeStart, len);
                };

                const birthBBox = getBBoxForRange(birthStartIndex, birthLength);

                const genderBBox = getBBoxForRange(genderGlobalIndex, genderLength);

                // Add a small start offset (gap) to backBBox to prevent overlap with Gender
                // Logic: interpolate calculates floating point. If we are too close, it might floor/ceil into the previous char.
                // We barely move the start index by a fraction like 0.1? No, better to adjust the result BBox.

                let backBBox = getBBoxForRange(backNumGlobalIndex, backNumLength);

                // Manual adjustment: Shift Back Number Start X slightly to the right to avoid Gender overlap
                // Just 1 or 2 pixels is enough usually.
                backBBox.x0 += 2;

                // Apply snap for back number
                if ((backNumGlobalIndex + backNumLength - 1) === lastVisibleIdx) {
                    backBBox = { ...backBBox, x1: line.bbox.x1 };
                }


                fields.push({
                    id: `rrn-birth-${idx}`,
                    label: "생년월일",
                    value: birthDate,
                    ids: [`line-${idx}-birth`],
                    bbox: birthBBox
                });

                fields.push({
                    id: `rrn-gender-${idx}`,
                    label: "성별",
                    value: genderVal,
                    ids: [`line-${idx}-gender`],
                    bbox: genderBBox
                });

                fields.push({
                    id: `rrn-back-${idx}`,
                    label: "주민번호 뒷자리",
                    value: backNumVal,
                    ids: [`line-${idx}-back`],
                    bbox: backBBox
                });
            } else {
                logs.push(`Potential RRN match on line ${idx} too short: ${digits.length}`);
            }
        }
    });

    // Driver License Number
    lines.forEach((line, idx) => {
        const match = line.text.match(dlRegex);
        if (match) {
            const digits = match[0].replace(/\D/g, '');
            if (digits.length >= 10) {
                fields.push({
                    id: `dl-num-${idx}`,
                    label: "운전면허번호",
                    value: match[0],
                    ids: [`line-${idx}`],
                    bbox: line.bbox
                });
                logs.push(`Found DL on line ${idx}: ${match[0]}`);
            } else {
                logs.push(`Potential DL match on line ${idx} too short: ${digits.length}`);
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
            logs.push(`Found Passport Num in word ${idx}: ${word.text}`);
        }
    });


    // --- 2. Determine ID Type ---
    if (text.includes("운전") || text.toLowerCase().includes("driver")) {
        idType = "운전면허증";
        logs.push("ID Type inferred from keywords: 운전면허증");
    } else if (text.includes("주민") || text.includes("등록증")) {
        idType = "주민등록증";
        logs.push("ID Type inferred from keywords: 주민등록증");
    } else if (text.includes("여권") || text.includes("PASSPORT")) {
        idType = "여권";
        logs.push("ID Type inferred from keywords: 여권");
    } else {
        const hasDL = fields.some(f => f.label === "운전면허번호");
        const hasPassport = fields.some(f => f.label === "여권번호");
        const hasRRN = fields.some(f => f.label === "주민등록번호");

        if (hasDL) {
            idType = "운전면허증";
            logs.push("ID Type inferred from fields: 운전면허증");
        } else if (hasPassport) {
            idType = "여권";
            logs.push("ID Type inferred from fields: 여권");
        } else if (hasRRN) {
            idType = "주민등록증(추정)";
            logs.push("ID Type inferred from fields: 주민등록증(추정)");
        } else {
            logs.push("ID Type Unknown - No keywords or specific fields found");
        }
    }


    // --- 3. Extract Additional Fields ---

    // Address extraction
    // Address extraction
    // Expanded region list to include full names as abbreviations might not match full text
    const regions = [
        "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
        "경기", "강원", "충청", "충북", "충남", "전라", "전북", "전남", "경상", "경북", "경남", "제주",
        "경기도", "강원도", "충청북도", "충청남도", "전라북도", "전라남도", "경상북도", "경상남도", "제주도"
    ];

    for (let i = 0; i < lines.length; i++) {
        // Check both original and stripped text for maximum robustness
        const lineTextStripped = lines[i].text.replace(/\s/g, '');
        const hasRegion = regions.some(r => lines[i].text.includes(r) || lineTextStripped.includes(r));

        if (hasRegion) {
            const addressLines = [lines[i]];
            for (let j = 1; j <= 3; j++) {
                if (i + j < lines.length) {
                    const nextLine = lines[i + j];
                    const currentHeight = lines[i].bbox.y1 - lines[i].bbox.y0;
                    const gap = nextLine.bbox.y0 - lines[i + j - 1].bbox.y1;

                    if (gap > currentHeight * 2.5) break;
                    if (/\d{4}[.-]\d{2}[.-]\d{2}/.test(nextLine.text)) break;
                    // Also stop if line looks like "1종보통" or ID num
                    if (dlRegex.test(nextLine.text)) break;
                    if (rrnRegex.test(nextLine.text)) break;

                    addressLines.push(nextLine);
                }
            }

            const mergedBBox = mergeBBoxes(addressLines.map(l => l.bbox));

            // Avoid same line as DL number
            const isDLLine = fields.some(f => f.label === "운전면허번호" && Math.abs(f.bbox.y0 - lines[i].bbox.y0) < 10);

            if (!isDLLine) {
                fields.push({
                    id: `addr-${i}`,
                    label: "주소",
                    value: addressLines.map(l => l.text).join(" "),
                    ids: addressLines.map((_, idx) => `addr-line-${i}-${idx}`),
                    bbox: mergedBBox
                });
                logs.push(`Found Address starting at line ${i}`);
                break;
            } else {
                logs.push(`Skipped potential address at line ${i} because it overlaps with DL number`);
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
                logs.push(`Found Period at line ${idx}`);
            }
        });

        // Issue Date
        const dateRegex = /(\d{4}\s*[.\-]\s*\d{2}\s*[.\-]\s*\d{2})/;
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            const match = line.text.match(dateRegex);
            if (match) {
                const isPeriod = periodRegex.test(line.text);
                const isRRNLine = fields.some(f => f.label === "주민등록번호" && Math.abs(f.bbox.y0 - line.bbox.y0) < 10);

                if (!isPeriod && !isRRNLine) {
                    fields.push({
                        id: `issue-date-${i}`,
                        label: "발급일",
                        value: match[0],
                        ids: [],
                        bbox: line.bbox
                    });
                    logs.push(`Found Issue Date at line ${i}`);
                    break;
                }
            }
        }

        // Identification Number (Alpha+Num 6 chars)
        const idNumRegex = /^[A-Z0-9]{6}$/;
        words.forEach((word, idx) => {
            if (idNumRegex.test(word.text) && word.text.length === 6) {
                const hasAlpha = /[A-Z]/.test(word.text);
                const hasNum = /[0-9]/.test(word.text);
                if (hasAlpha && hasNum) {
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
        // Passport specific date logic
        // ... (simplified for brevity if needed)
    }

    return {
        idType,
        fields,
        logs
    };
};
