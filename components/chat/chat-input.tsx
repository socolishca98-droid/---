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
  /**
   * Режим срочного сообщения. Раньше пункт меню открывал системный
   * `prompt("Введите срочное сообщение:")`: в некоторых браузерах и webview он
   * заблокирован, текст из него не видно в контексте переписки, а отправить
   * пустое окно можно было по Enter. Теперь срочное сообщение набирается в том
   * же поле, но помечено — и уходит с типом "alert".
   */
  const [alertMode, setAlertMode] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = () => {
    const text = message.trim()
    if (!text) return
    onSend(text, alertMode ? "alert" : "text")
    setMessage("")
    setAlertMode(false)
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && alertMode) {
      e.preventDefault()
      setAlertMode(false)
      return
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleAlert = () => {
    setAlertMode(true)
    textareaRef.current?.focus()
  }

  return (
    <div className="border-t border-border p-3">
      {alertMode && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">
            Срочное сообщение: получатель увидит его как важное. Esc — отмена.
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setAlertMode(false)}
            disabled={disabled}
          >
            Отмена
          </Button>
        </div>
      )}
      <div
        className={`flex items-end gap-2 rounded-xl ${
          alertMode ? "ring-1 ring-destructive/40" : ""
        }`}
      >
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
          placeholder={
            alertMode ? "Что случилось? Сообщение уйдёт как срочное..." : "Напишите сообщение..."
          }
          disabled={disabled}
          className="min-h-[40px] max-h-[120px] resize-none"
          rows={1}
        />

        <Button
          size="icon"
          variant={alertMode ? "destructive" : "default"}
          className="h-10 w-10 flex-shrink-0"
          aria-label={alertMode ? "Отправить срочное сообщение" : "Отправить сообщение"}
          title={alertMode ? "Отправить срочное сообщение" : "Отправить сообщение"}
          onClick={handleSend}
          disabled={disabled || !message.trim()}
        >
          <Send className="h-5 w-5" />
        </Button>
      </div>
    </div>
  )
}
