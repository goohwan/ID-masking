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

// Helper to interpolate bbox horizontally with improved vertical fit
const interpolateBBox = (fullBBox: Tesseract.Bbox, totalLength: number, start: number, length: number): Tesseract.Bbox => {
    const width = fullBBox.x1 - fullBBox.x0;
    const charWidth = width / totalLength;

    // Add a small buffer to x0 and x1 to ensure coverage, but don't exceed bounds too much
    const x0 = fullBBox.x0 + (charWidth * start);
    const x1 = fullBBox.x0 + (charWidth * (start + length));

    // Vertical Fit Adjustment:
    // Tesseract boxes are often too tall. Shrink by ~20% (10% top, 10% bottom) to fit text better and avoid overlap.
    const height = fullBBox.y1 - fullBBox.y0;
    const verticalPadding = height * 0.15;

    return {
        x0: Math.floor(x0),
        y0: Math.floor(fullBBox.y0 + verticalPadding),
        x1: Math.ceil(x1),
        y1: Math.ceil(fullBBox.y1 - verticalPadding)
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
    // Relaxed to capture cases where hyphen is misread as a digit
    const rrnRegex = /(\d{6})[^\d\n]*([\d\s-]{7,})/;

    // DL Number: 12 digits total usually
    const dlRegex = /(\d{2})[^0-9]+(\d{6})[^0-9]+(\d{2})/;

    // Passport: Letter + 8 digits
    const passportNumRegex = /[A-Z][0-9A-Z]{8}/;


    // --- 1. Field Extraction ---

    // Resident Registration Number (RRN)
    lines.forEach((line, idx) => {
        const match = line.text.match(rrnRegex);
        if (match) {
            // match[1] = Birth (6 digits)
            // match[2] = Back part (Mixed digits, spaces, hyphens)
            // If OCR misread '-' as '4', match[2] might look like '41234567' (8 digits)

            const birthPartRaw = match[1];
            let backPartRaw = match[2].trim();

            // Extract pure digits from back part
            const backDigits = backPartRaw.replace(/\D/g, '');

            // RRN must have at least 13 digits total (6 + 7)
            if (birthPartRaw.length + backDigits.length >= 13) {

                fields.push({
                    id: `rrn-${idx}`,
                    label: "주민등록번호",
                    value: match[0],
                    ids: [`line-${idx}`],
                    bbox: line.bbox
                });
                logs.push(`Found RRN on line ${idx}: ${match[0]}`);

                // --- Visual Localization Logic ---
                const matchString = match[0];
                let firstVisibleIdx = 0;
                let lastVisibleIdx = matchString.length - 1;
                while (firstVisibleIdx < matchString.length && /\s/.test(matchString[firstVisibleIdx])) firstVisibleIdx++;
                while (lastVisibleIdx >= 0 && /\s/.test(matchString[lastVisibleIdx])) lastVisibleIdx--;
                const visibleLength = (lastVisibleIdx >= firstVisibleIdx) ? (lastVisibleIdx - firstVisibleIdx + 1) : matchString.length;

                // 1. Birth Date
                const birthStartIndex = matchString.indexOf(birthPartRaw);
                const birthLength = birthPartRaw.length;
                const birthDate = birthPartRaw;

                // 2. Back Part Handling
                // We need to identify the TRUE 7 digits.
                // Case A: 7 digits found. Good.
                // Case B: 8 digits found. Likely 1st digit is a misread hyphen (like '4' or '1' or '7').

                let validBackDigits = backDigits;
                let skipLeadingChars = 0;

                if (backDigits.length === 8) {
                    // Start from 2nd digit
                    validBackDigits = backDigits.substring(1);
                    skipLeadingChars = 1;
                    logs.push(`Back part has 8 digits. Assuming 1st digit '${backDigits[0]}' is noise`);
                }

                // If massive noise, fallback to standard subs
                if (validBackDigits.length < 7) {
                    logs.push("Back part has insufficient digits even after noise check");
                    return;
                }

                const genderVal = validBackDigits[0];
                const backNumVal = validBackDigits.substring(1, 7); // Next 6

                // Locate these in the original string to get BBox
                const backPartStartInMatch = matchString.indexOf(backPartRaw);

                // We need to find where the *Valid Gender Digit* actually is in backPartRaw
                // It's the (skipLeadingChars + 1)-th digit in backPartRaw
                let currentDigitCount = 0;
                let relativeGenderIdx = -1;

                for (let i = 0; i < backPartRaw.length; i++) {
                    if (/\d/.test(backPartRaw[i])) {
                        if (currentDigitCount === skipLeadingChars) {
                            relativeGenderIdx = i;
                            break;
                        }
                        currentDigitCount++;
                    }
                }

                if (relativeGenderIdx === -1) relativeGenderIdx = 0; // Fallback

                const genderGlobalIndex = backPartStartInMatch + relativeGenderIdx;

                // Find Start of Back Digits (after gender)
                // We want the range for the remaining 6 digits
                let relativeBackStartIdx = -1;
                let relativeBackEndIdx = -1;
                let digitsFound = 0;

                for (let i = relativeGenderIdx + 1; i < backPartRaw.length; i++) {
                    if (/\d/.test(backPartRaw[i])) {
                        if (relativeBackStartIdx === -1) relativeBackStartIdx = i;
                        relativeBackEndIdx = i;
                        digitsFound++;
                        if (digitsFound === 6) break;
                    }
                }

                if (relativeBackStartIdx === -1) relativeBackStartIdx = relativeGenderIdx + 1;
                if (relativeBackEndIdx === -1) relativeBackEndIdx = backPartRaw.length - 1;

                const backNumGlobalIndex = backPartStartInMatch + relativeBackStartIdx;
                const backNumLength = (relativeBackEndIdx - relativeBackStartIdx) + 1;

                // Get BBoxes
                const getBBoxForRange = (start: number, len: number) => {
                    const relativeStart = start - firstVisibleIdx;
                    return interpolateBBox(line.bbox, visibleLength, relativeStart, len);
                };

                const birthBBox = getBBoxForRange(birthStartIndex, birthLength);
                const genderBBox = getBBoxForRange(genderGlobalIndex, 1);

                let backBBox = getBBoxForRange(backNumGlobalIndex, backNumLength);
                // Slight shift to prevent overlap
                backBBox.x0 += 2;

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
                logs.push(`Potential RRN match on line ${idx} too short/invalid patterns`);
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
        // Check for 'period' keywords or tilde patterns
        const periodRegex = /\d{4}\s*[.\-]\s*\d{2}\s*[.\-]\s*\d{2}\s*~\s*\d{4}\s*[.\-]\s*\d{2}\s*[.\-]\s*\d{2}/;
        const simplePeriodRegex = /~\s*\d{4}[.\-]\d{2}[.\-]\d{2}/; // Matches " ~ 2033.12.31"
        const keywordPeriodRegex = /(적성|검사|기간)/;

        lines.forEach((line, idx) => {
            const isPeriod = periodRegex.test(line.text) || simplePeriodRegex.test(line.text) || keywordPeriodRegex.test(line.text);

            if (isPeriod) {
                // If contains date, add as period
                if (/\d{4}[.\-]\d{2}[.\-]\d{2}/.test(line.text)) {
                    fields.push({
                        id: `period-${idx}`,
                        label: "갱신기간",
                        value: line.text,
                        ids: [],
                        bbox: line.bbox
                    });
                    logs.push(`Found Period at line ${idx}`);
                }
            }
        });

        // Issue Date
        // Strategy: Look for date pattern. Must NOT be 'Period'.
        // Preference: Start from bottom. If line contains "Authority" (Police), it's the one.
        const dateRegex = /(\d{4}\s*[.\-]\s*\d{2}\s*[.\-]\s*\d{2})/;
        const authorityRegex = /[가-힣]+(지방)?경찰청장/;

        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            const match = line.text.match(dateRegex);

            if (match) {
                // Check if this line is part of period
                const isPeriod = periodRegex.test(line.text) || simplePeriodRegex.test(line.text) || line.text.includes("기간") || line.text.includes("적성");
                const isRRNLine = fields.some(f => f.label === "주민등록번호" && Math.abs(f.bbox.y0 - line.bbox.y0) < 10);

                if (!isPeriod && !isRRNLine) {
                    const authorityMatch = line.text.match(authorityRegex);

                    if (authorityMatch) {
                        // Split Date and Authority
                        const dateStr = match[0];
                        const dateIndex = match.index || 0;
                        const dateBBox = interpolateBBox(line.bbox, line.text.length, dateIndex, dateStr.length);

                        fields.push({
                            id: `issue-date-${i}`,
                            label: "발급일",
                            value: dateStr,
                            ids: [],
                            bbox: dateBBox
                        });

                        const authStr = authorityMatch[0];
                        const authIndex = authorityMatch.index || 0;
                        const authBBox = interpolateBBox(line.bbox, line.text.length, authIndex, authStr.length);

                        fields.push({
                            id: `issue-authority-${i}`,
                            label: "발급기관",
                            value: authStr,
                            ids: [],
                            bbox: authBBox
                        });

                        logs.push(`Found Issue Date & Authority at line ${i} (Split)`);
                    } else {
                        // If no authority on same line, it might still be issue date (lowest date)
                        // But ensure it's not the end date of period (which might be on its own line)
                        // If we already found period lines above, check if this line is physically below them

                        fields.push({
                            id: `issue-date-${i}`,
                            label: "발급일",
                            value: match[0],
                            ids: [],
                            bbox: line.bbox
                        });
                        logs.push(`Found Issue Date at line ${i}`);
                    }
                    // Once we find the valid bottom date, stop.
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
