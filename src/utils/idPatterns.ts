export interface IDPattern {
    name: string;
    type: 'rrn' | 'driver' | 'passport' | 'address' | 'name';
    regex: RegExp;
    description: string;
}

export const ID_PATTERNS: IDPattern[] = [
    {
        name: 'Resident Registration Number',
        type: 'rrn',
        // Matches 6 digits - 7 digits (with or without hyphen)
        // Be careful with OCR errors (e.g. 'I' instead of '1', 'O' instead of '0')
        regex: /(\d{6})[- ]?([1-4]\d{6})/g,
        description: '주민등록번호'
    },
    {
        name: 'Driver License Number',
        type: 'driver',
        // Matches typical format: 11-11-111111-11
        regex: /(\d{2})[- ]?(\d{2})[- ]?(\d{6})[- ]?(\d{2})/g,
        description: '운전면허번호'
    },
    // Add more patterns as needed
];

// Helper to clean OCR text for better matching (e.g. replace common OCR errors)
export const cleanOCRText = (text: string): string => {
    return text.replace(/O/g, '0').replace(/I/g, '1').replace(/l/g, '1');
};
