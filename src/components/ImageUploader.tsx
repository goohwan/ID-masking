import React, { useEffect, useState, useRef } from 'react';
import { Upload } from 'lucide-react';

interface ImageUploaderProps {
    onImageSelect: (file: File) => void;
    labels: {
        title: string;
        desc: string;
        formats: string;
    };
}

const ImageUploader: React.FC<ImageUploaderProps> = ({ onImageSelect, labels }) => {
    const [dragActive, setDragActive] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFile = (file: File) => {
        if (file && (file.type === "image/jpeg" || file.type === "image/png")) {
            onImageSelect(file);
        }
    };

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    };

    // Paste Handler
    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => {
            if (e.clipboardData && e.clipboardData.files.length > 0) {
                const file = e.clipboardData.files[0];
                handleFile(file);
            }
        };

        window.addEventListener('paste', handlePaste);
        return () => {
            window.removeEventListener('paste', handlePaste);
        };
    }, []);

    const onButtonClick = () => {
        inputRef.current?.click();
    };

    return (
        <div
            className={`relative w-full h-64 border-2 border-dashed rounded-xl transition-all duration-300 ease-in-out flex flex-col items-center justify-center cursor-pointer group
                ${dragActive
                    ? "border-blue-500 bg-blue-500/10 scale-[1.02]"
                    : "border-gray-700 bg-gray-800/50 hover:border-blue-400 hover:bg-gray-800"
                }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={onButtonClick}
        >
            <input
                ref={inputRef}
                type="file"
                className="hidden"
                accept="image/jpeg, image/png"
                onChange={handleChange}
            />

            <div className="flex flex-col items-center text-center p-6 space-y-4">
                <div className={`p-4 rounded-full transition-colors duration-300 ${dragActive ? 'bg-blue-500 text-white' : 'bg-gray-700 text-gray-400 group-hover:bg-gray-600 group-hover:text-blue-400'}`}>
                    <Upload size={32} />
                </div>
                <div>
                    <p className="text-lg font-medium text-white mb-1">
                        {labels.title}
                    </p>
                    <p className="text-sm text-gray-400">
                        {labels.desc}
                    </p>
                </div>
                <p className="text-xs text-gray-500 font-mono border border-gray-700 px-2 py-1 rounded">
                    {labels.formats}
                </p>
            </div>
        </div>
    );
};

export default ImageUploader;
