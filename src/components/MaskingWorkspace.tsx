import React, { useEffect, useState } from 'react';
import { performOCR } from '../utils/ocrHelper';
import type { OCRResult } from '../utils/ocrHelper';
import { parseOCRResult } from '../utils/idParsingLogic';
import type { ParsedIDData } from '../utils/idParsingLogic';
import type { MaskingRegion } from '../utils/maskingLogic';
import { Loader2, Check, AlertTriangle, ArrowLeft } from 'lucide-react';

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
        uploadNew: '다시 올리기',
        apply: '마스킹 적용 및 다운로드',
        detected: '감지된 민감 정보',
        noDetected: '자동으로 감지된 민감 정보가 없습니다.',
        rawText: '원본 텍스트 (디버그)',
        manual: '수동 선택',
        viewOriginal: '원본 이미지',
        viewProcessed: '분석된 이미지(흑백)'
    },
    en: {
        processing: 'Processing Image...',
        analyzing: 'Analyzing text and identifying sensitive data.',
        title: 'Masking Workspace',
        uploadNew: 'Upload New',
        apply: 'Apply Masking',
        detected: 'Detected Sensitive Data',
        noDetected: 'No sensitive data automatically detected.',
        rawText: 'Raw Text (Debug)',
        manual: 'Manual Selection',
        viewOriginal: 'Original Image',
        viewProcessed: 'Analyzed Image (B/W)'
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
    const [naturalDimensions, setNaturalDimensions] = useState<{ width: number; height: number } | null>(null);

    // Manual Masking State
    const [isDrawing, setIsDrawing] = useState(false);
    const [startPos, setStartPos] = useState<{ x: number, y: number } | null>(null);
    const [currentPos, setCurrentPos] = useState<{ x: number, y: number } | null>(null);
    const [isDebugVisible, setIsDebugVisible] = useState(false);

    const [viewMode, setViewMode] = useState<'original' | 'processed'>('original');

    const t = translations[lang];

    useEffect(() => {
        if (imageFile) {
            // Default to showing original file initially
            const url = URL.createObjectURL(imageFile);
            setImageUrl(url); // Initial showing

            // Reset state
            setOcrResult(null);
            setMaskingRegions([]);
            setSelectedRegions(new Set());
            setParsedData(null);
            setStatus('processing');
            setProgress(0);

            const runOCR = async () => {
                try {
                    const result = await performOCR(imageFile, (p) => setProgress(p));
                    setOcrResult(result);

                    // Parse ID Data
                    const parsed = parseOCRResult(result);
                    setParsedData(parsed);

                    // Convert parsed fields to masking regions
                    const sensitiveRegions: MaskingRegion[] = parsed.fields.map((field) => ({
                        id: field.id,
                        type: field.label,
                        bbox: field.bbox,
                        text: field.value
                    }));

                    // Process raw lines to find text that wasn't identified as sensitive
                    const otherRegions: MaskingRegion[] = [];
                    if (result.lines) {
                        result.lines.forEach((line, idx) => {
                            // Check overlap with sensitive regions
                            // Simple overlap check: if the intersection area is significant compared to the line area
                            const isOverlapping = sensitiveRegions.some(sr => {
                                const x0 = Math.max(line.bbox.x0, sr.bbox.x0);
                                const y0 = Math.max(line.bbox.y0, sr.bbox.y0);
                                const x1 = Math.min(line.bbox.x1, sr.bbox.x1);
                                const y1 = Math.min(line.bbox.y1, sr.bbox.y1);

                                if (x1 > x0 && y1 > y0) {
                                    const intersectionArea = (x1 - x0) * (y1 - y0);
                                    const lineArea = (line.bbox.x1 - line.bbox.x0) * (line.bbox.y1 - line.bbox.y0);
                                    // If > 30% of the line is covered by a sensitive field, skip it
                                    return (intersectionArea / lineArea) > 0.3;
                                }
                                return false;
                            });

                            if (!isOverlapping && line.text.trim().length > 0) {
                                otherRegions.push({
                                    id: `raw-line-${idx}`,
                                    type: 'Text',
                                    bbox: line.bbox,
                                    text: line.text
                                });
                            }
                        });
                    }

                    const newRegions = [...sensitiveRegions, ...otherRegions];
                    setMaskingRegions(newRegions);

                    // Select sensitive fields by default
                    const sensitiveTypes = ['주민등록번호', '운전면허번호', '여권번호'];
                    const defaultSelected = sensitiveRegions
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

            return () => {
                URL.revokeObjectURL(url);
            };
        }
    }, [imageFile]);

    // Handle view mode change
    useEffect(() => {
        if (!ocrResult) return;

        let url = '';
        if (viewMode === 'processed' && ocrResult.processedFile) {
            url = URL.createObjectURL(ocrResult.processedFile);
        } else {
            url = URL.createObjectURL(imageFile);
        }

        setImageUrl(url);
        return () => { if (url) URL.revokeObjectURL(url); }
    }, [viewMode, ocrResult, imageFile]);

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

        // Calculate Scale Factor and handle potential rotation swapping
        let scaleX = 1;
        let scaleY = 1;
        // Padding if needed, or origin shift (currently unused but kept for structure)
        // let pX0 = 0, pY0 = 0;

        if (ocrResult.imageDimensions && ocrResult.imageDimensions.width > 0) {
            const ocrW = ocrResult.imageDimensions.width;
            const ocrH = ocrResult.imageDimensions.height;
            const imgW = img.width;
            const imgH = img.height;

            // Simple heuristic to detect rotation swap (90 deg) because
            // Tesseract might have run on a rotated version of what we are currently drawing.
            // If aspect ratios are inverted (approx)
            const isSwapped = (Math.abs(ocrW - imgH) < 50 && Math.abs(ocrH - imgW) < 50);

            if (isSwapped && viewMode === 'original') {
                // CRITICAL FIX: If we are viewing original (exif rotated usually) 
                // but OCR ran on preprocessed (normalized) buffer.
                // Tesseract coordinates (x, y) map to the Preprocessed (Rotated relative to current?).
                // Actually, if preprocessed was 1000x2000 (Portrait) and Original is 2000x1000 (Landscape with Exif=90),
                // The Browser displays Original as 1000x2000 (Portrait).
                // So dimensions match! 
                // BUT if dimensions match, `isSwapped` would be FALSE.

                // If `isSwapped` is TRUE, it means:
                // OCR Image: 1000x500
                // Display Image: 500x1000
                // This implies Tesseract likely rotated it internally or preprocess behaved differently.
                // In this rare case, we just scale normally because x/y mapping is too complex to guess without OSD.
                // We trust basic scaling:
                scaleX = imgW / ocrW;
                scaleY = imgH / ocrH;
            } else {
                scaleX = imgW / ocrW;
                scaleY = imgH / ocrH;
            }
        }

        // Apply masks
        maskingRegions.forEach(region => {
            if (selectedRegions.has(region.id)) {
                let { x0: rX0, y0: rY0, x1: rX1, y1: rY1 } = region.bbox;

                const x0 = rX0 * scaleX;
                const y0 = rY0 * scaleY;
                const width = (rX1 - rX0) * scaleX;
                const height = (rY1 - rY0) * scaleY;

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

    const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
        const refDims = ocrResult?.imageDimensions || naturalDimensions;
        if (!isDrawing || !startPos || !currentPos || !refDims) return;

        // Use the event target to get the image/container dimensions
        // The handler is on the CONTAINER div (className="relative inline-block...")
        // We need the width/height of this container to know the scaling factor.
        // Or get the IMG element specifically. 
        const container = e.currentTarget;
        const rect = container.getBoundingClientRect();

        const renderedWidth = rect.width;
        const renderedHeight = rect.height;
        const scaleX = refDims.width / renderedWidth;
        const scaleY = refDims.height / renderedHeight;

        // Calculate bbox in screen coords relative to top-left of container
        const screenX0 = Math.min(startPos.x, currentPos.x);
        const screenY0 = Math.min(startPos.y, currentPos.y);
        const screenX1 = Math.max(startPos.x, currentPos.x);
        const screenY1 = Math.max(startPos.y, currentPos.y);

        // Convert to Natural Coords
        const x0 = Math.round(screenX0 * scaleX);
        const y0 = Math.round(screenY0 * scaleY);
        const x1 = Math.round(screenX1 * scaleX);
        const y1 = Math.round(screenY1 * scaleY);

        // Ignore too small areas
        if (Math.abs(screenX1 - screenX0) > 5 && Math.abs(screenY1 - screenY0) > 5) {
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
            <div className="flex flex-col items-center justify-center p-12 bg-[#161616] rounded-3xl border border-white/10 shadow-2xl">
                <Loader2 className="animate-spin text-white mb-4" size={48} />
                <h3 className="text-xl font-medium text-white mb-2">{t.processing}</h3>
                <p className="text-gray-400">{t.analyzing}</p>
                <div className="w-64 h-1 bg-gray-800 rounded-full mt-6 overflow-hidden">
                    <div
                        className="h-full bg-white transition-all duration-300"
                        style={{ width: `${progress * 100}%` }}
                    />
                </div>
                <p className="text-xs text-gray-500 mt-2 font-mono">{Math.round(progress * 100)}%</p>
            </div>
        );
    }

    // Separate sensitive vs other for display
    const sensitiveList = maskingRegions.filter(r => r.type !== 'Text' && r.type !== 'Manual');
    const manualList = maskingRegions.filter(r => r.type === 'Manual');
    const textList = maskingRegions.filter(r => r.type === 'Text');

    return (
        <div className="w-full">
            {/* Header / Controls */}
            {/* Control Bar */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 mb-8 sticky top-4 z-40 bg-[#121212]/90 backdrop-blur-md p-4 rounded-2xl border border-white/5 shadow-xl">

                {/* View Mode Toggle */}
                {/* View Mode Toggle */}
                <button
                    onClick={() => setViewMode(viewMode === 'original' ? 'processed' : 'original')}
                    className="w-full md:w-auto h-12 px-6 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-medium flex items-center justify-center gap-3 transition-all"
                >
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${viewMode === 'original' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-gray-600'}`} />
                        <span className={viewMode === 'original' ? 'text-white' : 'text-gray-500'}>{t.viewOriginal}</span>
                    </div>
                    <div className="w-px h-4 bg-white/20 mx-1"></div>
                    <div className="flex items-center gap-2">
                        <span className={viewMode === 'processed' ? 'text-white' : 'text-gray-500'}>{t.viewProcessed}</span>
                        <div className={`w-2 h-2 rounded-full ${viewMode === 'processed' ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]' : 'bg-gray-600'}`} />
                    </div>
                </button>

                {/* Action Buttons */}
                <div className="flex gap-2 w-full md:w-auto">
                    <button
                        onClick={onReset}
                        className="flex-1 md:flex-none flex items-center justify-center gap-2 h-12 px-6 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all group"
                    >
                        <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
                        <span className="font-semibold text-sm">{t.uploadNew}</span>
                    </button>

                    <button
                        onClick={handleApplyMasking}
                        className="flex-[2] md:flex-none h-12 px-8 rounded-xl bg-white text-black font-bold text-sm md:text-base flex items-center justify-center gap-2 hover:bg-[#f2f2f2] transition-all transform hover:-translate-y-0.5 active:scale-95 shadow-lg shadow-white/10"
                    >
                        {t.apply}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Image Preview / Canvas Area */}
                <div className="lg:col-span-2 relative bg-[#111] rounded-2xl overflow-hidden border border-white/10 select-none shadow-xl flex items-center justify-center bg-black/50 min-h-[300px]">
                    {imageUrl && (
                        <div
                            className="relative inline-block max-w-full"
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                        >
                            <img
                                ref={(el) => {
                                    if (el && !naturalDimensions) {
                                        setNaturalDimensions({ width: el.naturalWidth, height: el.naturalHeight });
                                    }
                                }}
                                src={imageUrl}
                                alt="Original"
                                className="max-w-full h-auto block pointer-events-none"
                                onLoad={(e) => {
                                    const img = e.currentTarget;
                                    setNaturalDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                                }}
                            />

                            {/* Masking Regions Overlay */}
                            {maskingRegions.map((region) => {
                                const isSelected = selectedRegions.has(region.id);

                                // Calculate percentages using OCR reference dimensions if available
                                let style: React.CSSProperties = {};
                                const refDims = ocrResult?.imageDimensions || naturalDimensions;

                                if (refDims) {
                                    const { width, height } = refDims;
                                    style = {
                                        left: `${(region.bbox.x0 / width) * 100}%`,
                                        top: `${(region.bbox.y0 / height) * 100}%`,
                                        width: `${((region.bbox.x1 - region.bbox.x0) / width) * 100}%`,
                                        height: `${((region.bbox.y1 - region.bbox.y0) / height) * 100}%`,
                                    };
                                } else {
                                    // Fallback to absolute pixels (only works if image is displayed at natural size)
                                    style = {
                                        left: `${region.bbox.x0}px`,
                                        top: `${region.bbox.y0}px`,
                                        width: `${region.bbox.x1 - region.bbox.x0}px`,
                                        height: `${region.bbox.y1 - region.bbox.y0}px`,
                                    };
                                }

                                return (
                                    <div
                                        key={region.id}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleRegion(region.id);
                                        }}
                                        className={`absolute cursor-pointer transition-all duration-200 border-2 
                                            ${isSelected
                                                ? 'bg-white/80 border-white z-10'
                                                : 'border-transparent hover:border-white/20 bg-transparent z-0'
                                            }`}
                                        style={style}
                                        title={`${region.type}: ${region.text}`}
                                    >
                                        {isSelected && (
                                            <div className="absolute -top-3 -right-3 bg-white rounded-full p-0.5 shadow-sm">
                                                <Check size={12} className="text-black" />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Drawing Preview */}
                            {isDrawing && startPos && currentPos && (
                                <div
                                    className="absolute border-2 border-white bg-white/20 pointer-events-none"
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
                <div className="bg-[#111] p-6 rounded-2xl border border-white/10 h-fit space-y-6 shadow-xl max-h-[80vh] overflow-y-auto">
                    <div>
                        <h4 className="text-lg font-medium text-white mb-4 flex items-center justify-between">
                            <div className="flex items-center">
                                <AlertTriangle size={20} className="text-white mr-2" />
                                {t.detected}
                            </div>
                            {parsedData && (
                                <span className="text-sm bg-white/10 text-white px-2 py-1 rounded border border-white/10">
                                    {parsedData.idType}
                                </span>
                            )}
                        </h4>

                        {maskingRegions.length === 0 ? (
                            <p className="text-gray-500 text-sm">{t.noDetected}</p>
                        ) : (
                            <div className="space-y-6">
                                {/* Sensitive Data Section */}
                                {sensitiveList.length > 0 && (
                                    <div className="space-y-2">
                                        <h5 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2">Sensitive Data</h5>
                                        {sensitiveList.map((field) => (
                                            <div
                                                key={field.id}
                                                onClick={() => toggleRegion(field.id)}
                                                className={`p-3 rounded-lg border cursor-pointer transition-all ${selectedRegions.has(field.id)
                                                    ? 'bg-white/10 border-white/50'
                                                    : 'bg-[#1a1a1a] border-white/5 hover:border-white/20'
                                                    }`}
                                            >
                                                <div className="flex justify-between items-start mb-1">
                                                    <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                                                        {field.type}
                                                    </span>
                                                    <div className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${selectedRegions.has(field.id)
                                                        ? 'bg-blue-600 border-blue-600'
                                                        : 'border-gray-500 hover:border-gray-300'
                                                        }`}>
                                                        {selectedRegions.has(field.id) && <Check size={16} className="text-white" />}
                                                    </div>
                                                </div>
                                                <div className="text-sm text-gray-200 font-mono break-all ml-1">
                                                    {field.text}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Manual Section */}
                                {manualList.length > 0 && (
                                    <div className="space-y-2">
                                        <h5 className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2">Manual Selection</h5>
                                        {manualList.map((region) => (
                                            <div
                                                key={region.id}
                                                onClick={() => toggleRegion(region.id)}
                                                className={`p-3 rounded-lg border cursor-pointer transition-all ${selectedRegions.has(region.id)
                                                    ? 'bg-white/10 border-white/50'
                                                    : 'bg-[#1a1a1a] border-white/5 hover:border-white/20'
                                                    }`}
                                            >
                                                <div className="flex justify-between items-center mb-1">
                                                    <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                                                        {region.type}
                                                    </span>
                                                    <div className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${selectedRegions.has(region.id)
                                                        ? 'bg-blue-600 border-blue-600'
                                                        : 'border-gray-500 hover:border-gray-300'
                                                        }`}>
                                                        {selectedRegions.has(region.id) && <Check size={16} className="text-white" />}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Other Text Section */}
                                {textList.length > 0 && (
                                    <div className="space-y-2 opacity-80 hover:opacity-100 transition-opacity">
                                        <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Other Detected Text</h5>
                                        {textList.map((field) => (
                                            <div
                                                key={field.id}
                                                onClick={() => toggleRegion(field.id)}
                                                className={`p-2 rounded border cursor-pointer transition-all ${selectedRegions.has(field.id)
                                                    ? 'bg-white/10 border-white/50'
                                                    : 'bg-[#1a1a1a] border-white/5 hover:border-white/20'
                                                    }`}
                                            >
                                                <div className="flex justify-between items-center">
                                                    <span className="text-xs text-gray-400 truncate flex-1 mr-2">
                                                        {field.text}
                                                    </span>
                                                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${selectedRegions.has(field.id)
                                                        ? 'bg-blue-600 border-blue-600'
                                                        : 'border-gray-600'
                                                        }`}>
                                                        {selectedRegions.has(field.id) && <Check size={10} className="text-white" />}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>


            {/* Raw Text for Debugging */}
            {ocrResult && (
                <div className="mt-8 pt-8 border-t border-white/10 transition-opacity">
                    <button
                        onClick={() => setIsDebugVisible(!isDebugVisible)}
                        className="flex items-center gap-2 text-xs font-medium text-gray-500 mb-4 hover:text-white transition-colors"
                    >
                        <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`transition-transform duration-200 ${isDebugVisible ? 'rotate-90' : ''}`}
                        >
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                        {t.rawText}
                    </button>

                    {isDebugVisible && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
                            <div className="bg-black/50 p-4 rounded-lg border border-white/5 max-h-40 overflow-y-auto text-[10px] font-mono text-gray-500 whitespace-pre-wrap">
                                {ocrResult.text}
                            </div>
                            {parsedData && parsedData.logs && (
                                <div className="bg-black/50 p-4 rounded-lg border border-white/5 max-h-40 overflow-y-auto text-[10px] font-mono text-gray-500 whitespace-pre-wrap">
                                    {parsedData.logs.join('\n')}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default MaskingWorkspace;
