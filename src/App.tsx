import { useState, useRef, useEffect } from 'react';
import { Shield, Globe, CloudUpload, Check } from 'lucide-react';
import MaskingWorkspace from './components/MaskingWorkspace';
import exampleImage from './assets/masked_example.png';

type Language = 'ko' | 'en';

const translations = {
  ko: {
    brand: 'PrivacyGuard',
    language: 'English',
    locales: '로컬데이터 & 보안지능', // Matching the text in top right of mockup somewhat
    desc: '로컬 OCR 기술을 사용하여 신분증의 민감한 정보를 자동으로 가려줍니다.\n고객님의 데이터는 브라우저의 로컬저장소를 벗어나지 않습니다.',
    step1: '1. 신분증 이미지 업로드',
    dropText: '이미지를 드래그 앤 드롭하거나 클릭하여 업로드하세요.',
    formats: ['JPEG', 'PNG', 'PDF'],
    copyBtn: 'Copy to Clipboard',
    secure: 'Local Processing',
  },
  en: {
    brand: 'PrivacyGuard',
    language: '한국어',
    locales: 'Local Data & Secure Intelligence',
    desc: 'Automatically mask sensitive information on your ID cards using local OCR technology. Your data never leaves your browser.',
    step1: '1. Upload ID Card Image',
    dropText: 'Drag and drop your image here, or click to browse.',
    formats: ['JPEG', 'PNG', 'PDF'],
    copyBtn: 'Copy to Clipboard',
    secure: 'Local Processing',
  }
};

function App() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [lang, setLang] = useState<Language>('ko');
  /* Main Glowing Card */
  const [dragActive, setDragActive] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const t = translations[lang];

  const toggleLanguage = () => {
    setLang(prev => prev === 'ko' ? 'en' : 'ko');
  };

  // Drag & Drop Handlers
  const handleFile = (file: File) => {
    if (file && (file.type === "image/jpeg" || file.type === "image/png")) {
      setImageFile(file);
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

  const handleZoneClick = () => {
    inputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  // Paste Handler
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!imageFile && e.clipboardData && e.clipboardData.files.length > 0) {
        const file = e.clipboardData.files[0];
        if (file.type.startsWith('image/')) {
          handleFile(file);
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [imageFile]);


  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-300 font-sans selection:bg-white/20">
      {/* Header */}
      <header
        className="border-b border-white/10 bg-[#0a0a0a] sticky top-0 z-50"
        style={{ height: '45px', display: 'flex', alignItems: 'center' }}
      >
        <div className="responsive-container px-6 w-full flex items-center justify-between">
          <div className="flex items-center space-x-2 text-white">
            <Shield size={20} className="text-white fill-white/20" />
            <span className="font-semibold text-lg tracking-wide text-white">{t.brand}</span>
          </div>


          <div className="flex items-center space-x-4 text-xs font-medium text-light">
            <div className="flex items-center space-x-1">
              <Globe size={14} className="text-light" />
              <span>{t.locales}</span>
            </div>
            <button
              onClick={toggleLanguage}
              className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-1 rounded-full transition-colors border border-gray-600"
            >
              {t.language}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-col items-center justify-center py-12 px-2 min-h-[calc(100vh-3.5rem)] relative overflow-hidden">

        {/* Background Ambient Glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-white/5 rounded-full blur-[100px] pointer-events-none"></div>

        {/* Text Description */}
        {!imageFile && (
          <p className="responsive-container text-white text-base mb-12 text-center leading-relaxed font-light tracking-wide opacity-90 whitespace-pre-wrap">
            {t.desc}
          </p>
        )}

        {!imageFile ? (
          /* Main Glowing Card */
          <div className="responsive-container relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-white/20 to-white/20 rounded-3xl blur opacity-30 group-hover:opacity-50 transition-opacity duration-1000"></div>
            <div className="relative bg-[#111] rounded-3xl p-8 shadow-[0_0_50px_-12px_rgba(255,255,255,0.15)] flex flex-col">

              <h2 className="text-xl text-white font-medium mb-8 pl-1">{t.step1}</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[320px]">

                {/* Upload Zone */}
                <div
                  onClick={handleZoneClick}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  className={`
                    border border-dashed rounded-xl flex flex-col items-center justify-center p-6 cursor-pointer transition-all duration-300
                    ${dragActive
                      ? 'border-white bg-white/10'
                      : 'border-white/30 bg-[#161616] hover:bg-[#1a1a1a] hover:border-white/60 hover:shadow-lg hover:shadow-white/5'
                    }
                  `}
                >
                  <input ref={inputRef} type="file" className="hidden" onChange={handleInputChange} accept="image/*" />

                  <div className="w-24 h-24 mb-6 relative flex items-center justify-center">
                    <div className={`absolute inset-0 border-2 rounded-2xl transition-all duration-300 ${dragActive ? 'border-white scale-110' : 'border-white/50'}`}></div>
                    <CloudUpload size={40} className="text-white relative z-10" />
                  </div>

                  <p className="text-white text-lg font-medium text-center">
                    {t.dropText}
                  </p>
                </div>

                {/* Example Image */}
                <div className="bg-[#161616] rounded-xl overflow-hidden border border-white/5 flex items-center justify-center relative">
                  <img src={exampleImage} alt="Example ID" className="w-[85%] h-auto object-contain drop-shadow-2xl transform rotate-[-2deg] hover:rotate-0 transition-transform duration-500" />
                  {/* Gradient Overlay for "Mood" */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none"></div>
                </div>

              </div>

              {/* Footer Buttons */}
              <div className="flex flex-col md:flex-row items-center justify-between mt-8 pt-4">
                <div className="flex space-x-2">
                  <span className="px-3 py-1 bg-[#222] text-xs text-white border border-white/10 rounded">
                    {t.formats.join(', ')}
                  </span>
                </div>

                <div className="mt-4 md:mt-0">
                  <button className="flex items-center space-x-2 px-5 py-2 rounded-full border border-white/30 text-white text-sm hover:bg-white/10 transition-colors bg-white/5">
                    <span>{t.copyBtn}</span>
                    <div className="bg-white/20 rounded-full p-0.5">
                      <Check size={12} className="text-white" />
                    </div>
                  </button>
                </div>
              </div>

            </div>
          </div>
        ) : (
          <div className="responsive-container animate-in fade-in zoom-in-95 duration-300">
            <MaskingWorkspace
              imageFile={imageFile}
              onReset={() => {
                setImageFile(null);
                setIsReady(false);
              }}
              lang={lang}
              onReady={setIsReady}
            />
          </div>
        )}
      </main>

      {/* Top Button */}
      {imageFile && isReady && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-8 right-8 p-4 bg-white text-black rounded-full shadow-[0_0_20px_rgba(255,255,255,0.3)] z-[9999] hover:bg-gray-200 transition-all hover:scale-110 active:scale-95"
          aria-label="Scroll to top"
        >
          <span className="font-bold">TOP</span>
        </button>
      )}
    </div>
  );
}

export default App;
