// components/driver-mobile/photo-capture.tsx

"use client"

import { useState, useRef } from "react"
import { Camera, X, Check, RefreshCw, Upload } from "lucide-react"

interface PhotoCaptureProps {
  onCapture: (file: File) => void
  onCancel: () => void
}

export function PhotoCapture({ onCapture, onCancel }: PhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [image, setImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Запуск камеры
  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" } // Задняя камера
      })
      setStream(mediaStream)
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream
      }
    } catch (err) {
      setError("Нет доступа к камере. Разрешите доступ в настройках браузера.")
    }
  }

  // Сделать фото
  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current
      const canvas = canvasRef.current
      
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      
      const context = canvas.getContext("2d")
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        const imgUrl = canvas.toDataURL("image/jpeg")
        setImage(imgUrl)
        stopCamera()
      }
    }
  }

  // Остановить камеру
  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop())
      setStream(null)
    }
  }

  // Подтвердить фото
  const confirmPhoto = async () => {
    if (image) {
      const res = await fetch(image)
      const blob = await res.blob()
      const file = new File([blob], "photo.jpg", { type: "image/jpeg" })
      onCapture(file)
    }
  }

  // Ретрай
  const retake = () => {
    setImage(null)
    startCamera()
  }

  // При монтировании запускаем камеру
  useState(() => {
    startCamera()
    return () => stopCamera()
  })

  if (error) {
    return (
      <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center text-white p-6">
        <p className="text-center mb-4 text-red-500">{error}</p>
        <button 
          onClick={onCancel}
          className="px-6 py-2 bg-gray-800 rounded-lg"
        >
          Закрыть
        </button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black z-[100] flex flex-col">
      {/* Область просмотра */}
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
        {!image ? (
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            className="w-full h-full object-cover"
          />
        ) : (
          <img src={image} alt="Captured" className="w-full h-full object-contain" />
        )}
        <canvas ref={canvasRef} className="hidden" />
        
        {/* Кнопка закрытия */}
        <button 
          onClick={() => { stopCamera(); onCancel() }}
          className="absolute top-4 right-4 p-2 bg-black/50 rounded-full text-white"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* Панель управления */}
      <div className="h-32 bg-black flex items-center justify-around px-8 pb-safe">
        {!image ? (
          <button 
            onClick={takePhoto}
            className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center active:scale-95 transition"
          >
            <div className="w-16 h-16 bg-white rounded-full" />
          </button>
        ) : (
          <>
            <button 
              onClick={retake}
              className="flex flex-col items-center gap-1 text-gray-400"
            >
              <RefreshCw className="h-8 w-8" />
              <span className="text-xs">Переснять</span>
            </button>
            
            <button 
              onClick={confirmPhoto}
              className="w-16 h-16 bg-orange-600 rounded-full flex items-center justify-center text-white shadow-lg active:scale-95 transition"
            >
              <Check className="h-8 w-8" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}