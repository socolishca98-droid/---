"use client"

import type React from "react"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Send, Paperclip, Camera, MapPin, AlertTriangle } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

interface ChatInputProps {
  onSend: (content: string, type?: "text" | "photo" | "location" | "alert") => void
  disabled?: boolean
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [message, setMessage] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = () => {
    if (!message.trim()) return
    onSend(message.trim(), "text")
    setMessage("")
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleAlert = () => {
    const alertMessage = prompt("Введите срочное сообщение:")
    if (alertMessage) {
      onSend(alertMessage, "alert")
    }
  }

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-end gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 flex-shrink-0"
              aria-label="Прикрепить фото или документ"
              title="Прикрепить фото или документ"
            >
              <Paperclip className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem>
              <Camera className="h-4 w-4 mr-2" />
              Фото
            </DropdownMenuItem>
            <DropdownMenuItem>
              <MapPin className="h-4 w-4 mr-2" />
              Геолокация
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleAlert} className="text-amber-600">
              <AlertTriangle className="h-4 w-4 mr-2" />
              Срочное сообщение
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Напишите сообщение..."
          disabled={disabled}
          className="min-h-[40px] max-h-[120px] resize-none"
          rows={1}
        />

        <Button
          size="icon"
          className="h-10 w-10 flex-shrink-0"
          aria-label="Отправить сообщение"
          title="Отправить сообщение"
          onClick={handleSend}
          disabled={disabled || !message.trim()}
        >
          <Send className="h-5 w-5" />
        </Button>
      </div>
    </div>
  )
}
