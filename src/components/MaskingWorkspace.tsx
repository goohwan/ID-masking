import React, { useEffect, useState } from 'react';
import { performOCR } from '../utils/ocrHelper';
import type { OCRResult } from '../utils/ocrHelper';
import { parseOCRResult } from '../utils/idParsingLogic';
import type { ParsedIDData } from '../utils/idParsingLogic';
import type { MaskingRegion } from '../utils/maskingLogic';
import { Loader2, Check, AlertTriangle } from 'lucide-react';

interface MaskingWorkspaceProps {
    imageFile: File;
    onReset: () => void;
    lang: 'ko' | 'en';
}

const translations = {
    ko: {
        processing: '이미지 처리 중...',
        analyzing: '텍스트를 분석하고 민감한 정보를 식별하고 있습니다.',
        title: '마스킹 작업 공간',
        uploadNew: '새 이미지 업로드',
        apply: '마스킹 적용 및 다운로드',
        detected: '감지된 민감 정보',
        noDetected: '자동으로 감지된 민감 정보가 없습니다.',
        rawText: '원본 텍스트 (디버그)',
        manual: '수동 선택'
    },
    en: {
        processing: 'Processing Image...',
        analyzing: 'Analyzing text and identifying sensitive data.',
        title: 'Masking Workspace',
        uploadNew: 'Upload New Image',
        apply: 'Apply Masking',
        detected: 'Detected Sensitive Data',
        noDetected: 'No sensitive data automatically detected.',
        rawText: 'Raw Text (Debug)',
        manual: 'Manual Selection'
    }
};

const MaskingWorkspace: React.FC<MaskingWorkspaceProps> = ({ imageFile, onReset, lang }) => {
    const [status, setStatus] = useState<'idle' | 'processing' | 'ready'>('idle');
    const [progress, setProgress] = useState(0);
    const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [maskingRegions, setMaskingRegions] = useState<MaskingRegion[]>([]);
    const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
    const [parsedData, setParsedData] = useState<ParsedIDData | null>(null);

    // Manual Masking State
    const [isDrawing, setIsDrawing] = useState(false);
    const [startPos, setStartPos] = useState<{ x: number, y: number } | null>(null);
    const [currentPos, setCurrentPos] = useState<{ x: number, y: number } | null>(null);

    const t = translations[lang];

    useEffect(() => {
        if (imageFile) {
            const url = URL.createObjectURL(imageFile);
            setImageUrl(url);

            const runOCR = async () => {
                setStatus('processing');
                try {
                    const result = await performOCR(imageFile, (p) => setProgress(p));
                    setOcrResult(result);

                    // Parse ID Data
                    const parsed = parseOCRResult(result);
                    setParsedData(parsed);

                    // Convert parsed fields to masking regions
                    const newRegions: MaskingRegion[] = parsed.fields.map((field) => ({
                        id: field.id,
                        type: field.label,
                        bbox: field.bbox,
                        text: field.value
                    }));

                    setMaskingRegions(newRegions);
                    // Select sensitive fields by default if needed (e.g. RRN, License Num)
                    // For now, maybe select all or none? User requirements imply "List up" -> Toggle.
                    // Let's select RRN and License Numbers by default as they are definitely sensitive.
                    const sensitiveTypes = ['주민등록번호', '운전면허번호', '여권번호'];
                    const defaultSelected = newRegions
                        .filter(r => sensitiveTypes.includes(r.type))
                        .map(r => r.id);

                    setSelectedRegions(new Set(defaultSelected));

                    setStatus('ready');
                } catch (error) {
                    console.error("OCR Error:", error);
                    // Handle error
                }
            };

            runOCR();

            return () => URL.revokeObjectURL(url);
        }
    }, [imageFile]);

    const handleApplyMasking = async () => {
        if (!imageUrl || !ocrResult) return;

        const img = new Image();
        img.src = imageUrl;
        await new Promise((resolve) => { img.onload = resolve; });

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Draw original image
        ctx.drawImage(img, 0, 0);

        // Apply masks
        maskingRegions.forEach(region => {
            if (selectedRegions.has(region.id)) {
                const { x0, y0, x1, y1 } = region.bbox;
                const width = x1 - x0;
                const height = y1 - y0;

                // Fill with solid color (e.g., black or gray)
                ctx.fillStyle = '#000000';
                ctx.fillRect(x0, y0, width, height);

                // Optional: Add "MASKED" text
                ctx.fillStyle = '#ffffff';
                ctx.font = `${Math.max(12, height * 0.5)}px monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('MASKED', x0 + width / 2, y0 + height / 2);
            }
        });

        // Download
        const link = document.createElement('a');
        link.download = `masked-id-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    const toggleRegion = (id: string) => {
        const newSelected = new Set(selectedRegions);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedRegions(newSelected);
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setIsDrawing(true);
        setStartPos({ x, y });
        setCurrentPos({ x, y });
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isDrawing) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setCurrentPos({ x, y });
    };

    const handleMouseUp = () => {
        if (!isDrawing || !startPos || !currentPos) return;

        // Calculate bbox
        const x0 = Math.min(startPos.x, currentPos.x);
        const y0 = Math.min(startPos.y, currentPos.y);
        const x1 = Math.max(startPos.x, currentPos.x);
        const y1 = Math.max(startPos.y, currentPos.y);

        // Ignore too small areas
        if (x1 - x0 > 5 && y1 - y0 > 5) {
            const newId = `manual-${Date.now()}`;
            const newRegion: MaskingRegion = {
                id: newId,
                type: 'Manual',
                bbox: { x0, y0, x1, y1 } as any,
                text: t.manual
            };

            setMaskingRegions([...maskingRegions, newRegion]);
            setSelectedRegions(new Set([...selectedRegions, newId]));
        }

        setIsDrawing(false);
        setStartPos(null);
        setCurrentPos(null);
    };

    if (status === 'processing' || status === 'idle') {
        return (
            <div className="flex flex-col items-center justify-center p-12 bg-gray-800 rounded-xl border border-gray-700">
                <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
                <h3 className="text-xl font-semibold text-white mb-2">{t.processing}</h3>
                <p className="text-gray-400">{t.analyzing}</p>
                <div className="w-64 h-2 bg-gray-700 rounded-full mt-4 overflow-hidden">
                    <div
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${progress * 100}%` }}
                    />
                </div>
                <p className="text-sm text-gray-500 mt-2">{Math.round(progress * 100)}%</p>
            </div>
        );
    }

    return (
        <div className="w-full max-w-6xl mx-auto">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold text-white">{t.title}</h3>
                <div className="flex space-x-3">
                    <button
                        onClick={onReset}
                        className="px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                    >
                        {t.uploadNew}
                    </button>
                    <button
                        onClick={handleApplyMasking}
                        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors shadow-lg shadow-blue-500/20"
                    >
                        {t.apply}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Image Preview / Canvas Area */}
                <div className="lg:col-span-2 relative bg-gray-900 rounded-xl overflow-hidden border border-gray-700 select-none">
                    {imageUrl && (
                        <div
                            className="relative inline-block cursor-crosshair"
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                        >
                            <img src={imageUrl} alt="Original" className="max-w-full h-auto block pointer-events-none" />

                            {/* Masking Regions Overlay */}
                            {maskingRegions.map((region) => (
                                <div
                                    key={region.id}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleRegion(region.id);
                                    }}
                                    className={`absolute cursor-pointer transition-all duration-200 border-2 
                                        ${selectedRegions.has(region.id)
                                            ? 'bg-red-500/40 border-red-500'
                                            : 'bg-yellow-500/20 border-yellow-500 hover:bg-yellow-500/40'
                                        }`}
                                    style={{
                                        left: `${region.bbox.x0}px`,
                                        top: `${region.bbox.y0}px`,
                                        width: `${region.bbox.x1 - region.bbox.x0}px`,
                                        height: `${region.bbox.y1 - region.bbox.y0}px`,
                                    }}
                                    title={`${region.type}: ${region.text}`}
                                >
                                    {selectedRegions.has(region.id) && (
                                        <div className="absolute -top-3 -right-3 bg-red-500 rounded-full p-0.5 shadow-sm">
                                            <Check size={12} className="text-white" />
                                        </div>
                                    )}
                                </div>
                            ))}

                            {/* Drawing Preview */}
                            {isDrawing && startPos && currentPos && (
                                <div
                                    className="absolute border-2 border-blue-500 bg-blue-500/20 pointer-events-none"
                                    style={{
                                        left: `${Math.min(startPos.x, currentPos.x)}px`,
                                        top: `${Math.min(startPos.y, currentPos.y)}px`,
                                        width: `${Math.abs(currentPos.x - startPos.x)}px`,
                                        height: `${Math.abs(currentPos.y - startPos.y)}px`,
                                    }}
                                />
                            )}
                        </div>
                    )}
                </div>

                {/* Controls / Info Area */}
                <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 h-fit space-y-6">
                    <div>
                        <h4 className="text-lg font-medium text-white mb-4 flex items-center justify-between">
                            <div className="flex items-center">
                                <AlertTriangle size={20} className="text-yellow-500 mr-2" />
                                {t.detected}
                            </div>
                            {parsedData && (
                                <span className="text-sm bg-blue-500/20 text-blue-300 px-2 py-1 rounded">
                                    {parsedData.idType}
                                </span>
                            )}
                        </h4>

                        {maskingRegions.length === 0 ? (
                            <p className="text-gray-400 text-sm">{t.noDetected}</p>
                        ) : (
                            <div className="space-y-3">
                                {parsedData ? (
                                    // Group by Label for nicer display if needed, or just list
                                    parsedData.fields.map((field: any) => (
                                        <div
                                            key={field.id}
                                            onClick={() => toggleRegion(field.id)}
                                            className={`p-3 rounded-lg border cursor-pointer transition-all ${selectedRegions.has(field.id)
                                                ? 'bg-red-500/10 border-red-500/50'
                                                : 'bg-gray-700/50 border-gray-600 hover:bg-gray-700'
                                                }`}
                                        >
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="text-xs font-medium text-gray-300 uppercase tracking-wider">
                                                    {field.label}
                                                </span>
                                                <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedRegions.has(field.id)
                                                    ? 'bg-red-500 border-red-500'
                                                    : 'border-gray-500'
                                                    }`}>
                                                    {selectedRegions.has(field.id) && <Check size={10} className="text-white" />}
                                                </div>
                                            </div>
                                            <div className="text-sm text-gray-200 font-mono break-all">
                                                {field.value}
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    // Fallback for Manual regions if any
                                    maskingRegions.map((region) => (
                                        <div
                                            key={region.id}
                                            onClick={() => toggleRegion(region.id)}
                                            className={`p-3 rounded-lg border cursor-pointer transition-all ${selectedRegions.has(region.id)
                                                ? 'bg-red-500/10 border-red-500/50'
                                                : 'bg-gray-700/50 border-gray-600 hover:bg-gray-700'
                                                }`}
                                        >
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="text-xs font-medium text-gray-300 uppercase tracking-wider">
                                                    {region.type}
                                                </span>
                                                <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedRegions.has(region.id)
                                                    ? 'bg-red-500 border-red-500'
                                                    : 'border-gray-500'
                                                    }`}>
                                                    {selectedRegions.has(region.id) && <Check size={10} className="text-white" />}
                                                </div>
                                            </div>
                                            <div className="text-sm text-gray-200 font-mono truncate">
                                                {region.text}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {/* Raw Text for Debugging */}
            {ocrResult && (
                <div className="mt-6 pt-6 border-t border-gray-700">
                    <h4 className="text-sm font-medium text-gray-400 mb-2">원본 텍스트 (디버그)</h4>
                    <div className="bg-gray-900 p-4 rounded-lg border border-gray-700 max-h-60 overflow-y-auto text-xs font-mono text-gray-300 whitespace-pre-wrap">
                        {ocrResult.text}
                    </div>
                </div>
            )}
        </div>
    );
};

export default MaskingWorkspace;
