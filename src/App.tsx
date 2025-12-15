import { useState } from 'react'
import ImageUploader from './components/ImageUploader'
import MaskingWorkspace from './components/MaskingWorkspace'
import { Shield, Lock, EyeOff } from 'lucide-react'

function App() {
  const [image, setImage] = useState<File | null>(null)

  const handleImageUpload = (file: File) => {
    setImage(file)
    console.log("Image uploaded:", file.name)
    // TODO: Trigger OCR
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-600/20 rounded-lg">
              <Shield className="text-blue-500" size={24} />
            </div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              Secure ID Masker
            </h1>
          </div>
          <div className="flex items-center space-x-6 text-sm text-gray-400">
            <div className="flex items-center space-x-2">
              <Lock size={16} />
              <span>Local Processing</span>
            </div>
            <div className="flex items-center space-x-2">
              <EyeOff size={16} />
              <span>No Server Storage</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold mb-4 text-white">
            Protect Your Identity
          </h2>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            Automatically mask sensitive information on your ID cards using local OCR technology.
            Your data never leaves your browser.
          </p>
        </div>

        <div className="flex flex-col items-center justify-center space-y-8 w-full">
          {!image ? (
            <ImageUploader onImageUpload={handleImageUpload} />
          ) : (
            <MaskingWorkspace
              imageFile={image}
              onReset={() => setImage(null)}
            />
          )}
        </div>
      </main>
    </div>
  )
}

export default App
