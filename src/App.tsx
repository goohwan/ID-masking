import { useState } from 'react';
import { Shield, Globe } from 'lucide-react';
import ImageUploader from './components/ImageUploader';
import MaskingWorkspace from './components/MaskingWorkspace';
import exampleImage from './assets/masked_example.png';

type Language = 'ko' | 'en';

const translations = {
  ko: {
    title: '신분증 자동 마스킹 서비스',
    subtitle: '로컬 OCR 기술을 사용하여 신분증의 민감한 정보를 자동으로 가려줍니다. 데이터는 브라우저를 벗어나지 않습니다.',
    secure: '로컬 처리 & 서버 저장 없음',
    uploadTitle: '신분증 이미지 업로드',
    uploadDesc: '이미지를 드래그 앤 드롭하거나 클릭하여 업로드하세요.',
    formats: '지원 형식: JPG, PNG',
    example: '마스킹 예시',
    toggleLang: 'English'
  },
  en: {
    title: 'Protect Your Identity',
    subtitle: 'Automatically mask sensitive information on your ID cards using local OCR technology. Your data never leaves your browser.',
    secure: 'Local Processing & No Server Storage',
    uploadTitle: 'Upload ID Card Image',
    uploadDesc: 'Drag and drop your image here, or click to browse.',
    formats: 'Supported formats: JPG, PNG',
    example: 'Masking Example',
    toggleLang: '한국어'
  }
};

function App() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [lang, setLang] = useState<Language>('ko');

  const t = translations[lang];

  const toggleLanguage = () => {
    setLang(prev => prev === 'ko' ? 'en' : 'ko');
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Shield className="text-blue-500" size={24} />
            <span className="font-bold text-lg tracking-tight">PrivacyGuard</span>
          </div>
          <div className="flex items-center space-x-6">
            <div className="flex items-center text-xs text-gray-400 bg-gray-800 px-3 py-1 rounded-full border border-gray-700">
              <Shield size={12} className="mr-1.5" />
              {t.secure}
            </div>
            <button
              onClick={toggleLanguage}
              className="flex items-center text-sm text-gray-300 hover:text-white transition-colors"
            >
              <Globe size={16} className="mr-1.5" />
              {t.toggleLang}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-12 flex flex-col items-center">
        {!imageFile ? (
          <div className="w-full flex flex-col items-center text-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="space-y-4 max-w-2xl">
              <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400 pb-1">
                {t.title}
              </h1>
              <p className="text-lg text-gray-400 leading-relaxed">
                {t.subtitle}
              </p>
            </div>

            {/* Example Image */}
            <div className="relative group w-full max-w-md mx-auto rounded-xl overflow-hidden shadow-2xl border border-gray-800">
              <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-transparent to-transparent opacity-60 z-10"></div>
              <img src={exampleImage} alt="Example" className="w-full h-auto transform group-hover:scale-105 transition-transform duration-500" />
              <div className="absolute bottom-4 left-0 right-0 text-center z-20">
                <span className="text-sm font-medium text-white/90 bg-black/50 px-3 py-1 rounded-full backdrop-blur-md">
                  {t.example}
                </span>
              </div>
            </div>

            <div className="w-full max-w-xl">
              <ImageUploader
                onImageSelect={setImageFile}
                labels={{
                  title: t.uploadTitle,
                  desc: t.uploadDesc,
                  formats: t.formats
                }}
              />
            </div>
          </div>
        ) : (
          <div className="w-full animate-in fade-in zoom-in-95 duration-300">
            <MaskingWorkspace
              imageFile={imageFile}
              onReset={() => setImageFile(null)}
              lang={lang}
            />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
