import React, { useCallback, useState } from 'react';
import { Upload, X } from 'lucide-react';

interface ImageUploaderProps {
    onImageUpload: (file: File) => void;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({ onImageUpload }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            processFile(file);
        }
    }, []);

    const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            processFile(file);
        }
    }, []);

    const processFile = (file: File) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            setPreview(reader.result as string);
        };
        reader.readAsDataURL(file);
        onImageUpload(file);
    };

    const clearImage = () => {
        setPreview(null);
        // Reset file input if needed, but for now just clear preview
    };

    if (preview) {
        return (
            <div className="relative w-full max-w-2xl mx-auto mt-8 p-4 bg-gray-800 rounded-xl shadow-lg border border-gray-700">
                <button
                    onClick={clearImage}
                    className="absolute top-2 right-2 p-1 bg-gray-900/80 rounded-full hover:bg-red-500/80 transition-colors text-white"
                >
                    <X size={20} />
                </button>
                <img src={preview} alt="Uploaded ID" className="w-full h-auto rounded-lg" />
            </div>
        );
    }

    return (
        <div
            className={`w-full max-w-2xl mx-auto mt-8 p-12 border-2 border-dashed rounded-xl transition-all duration-300 ease-in-out cursor-pointer
        ${isDragging
                    ? 'border-blue-500 bg-blue-500/10 scale-[1.02]'
                    : 'border-gray-600 hover:border-blue-400 hover:bg-gray-800/50'
                }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => document.getElementById('fileInput')?.click()}
        >
            <input
                type="file"
                id="fileInput"
                className="hidden"
                accept="image/*"
                onChange={handleFileInput}
            />
            <div className="flex flex-col items-center justify-center text-gray-400">
                <div className={`p-4 rounded-full bg-gray-800 mb-4 transition-transform duration-300 ${isDragging ? 'scale-110' : ''}`}>
                    <Upload size={48} className={isDragging ? 'text-blue-400' : 'text-gray-500'} />
                </div>
                <h3 className="text-xl font-semibold mb-2 text-gray-200">Upload ID Card Image</h3>
                <p className="text-sm text-gray-500 text-center max-w-xs">
                    Drag and drop your image here, or click to browse.
                    <br />
                    <span className="text-xs mt-2 block text-gray-600">Supported formats: JPG, PNG</span>
                </p>
            </div>
        </div>
    );
};

export default ImageUploader;
