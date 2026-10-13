// lib/mailer.ts
//
// Отправка писем. Сейчас система отправляет только письма восстановления
// пароля, но канал один — его же получит всё остальное (приглашения, уведомления).
//
// Драйверы:
//
//   console (по умолчанию) — письмо не уходит наружу, а пишется в журнал
//   приложения и в исходящий ящик процесса (getMailOutbox). Для разработки,
//   песочницы и первого выката: восстановление пароля работает end-to-end,
//   а ссылку администратор видит в логах и может передать вручную.
//
//   unisender — Unisender (российский сервис, платежи в рублях, 152-ФЗ).
//   Задайте MAIL_DRIVER=unisender, UNISENDER_API_KEY, UNISENDER_LIST_ID и
//   MAIL_FROM. Запросы идут по HTTPS через fetch — новых зависимостей нет.
//
//   resend — Resend (зарубежный сервис). MAIL_DRIVER=resend + RESEND_API_KEY.
//
// Если драйвер не настроен или письмо не ушло, восстановление пароля не
// ломается молча: функция возвращает результат, а маршрут объясняет человеку,
// что письмо не отправлено и нужно обратиться к администратору.
//
// Переменные окружения:
//   MAIL_DRIVER     console | unisender | resend   (по умолчанию console)
//   MAIL_FROM       адрес отправителя, например "Loginex <no-reply@loginex.ru>"
//   MAIL_FROM_EMAIL адрес отправителя, если MAIL_FROM не задан
//   UNISENDER_API_KEY, UNISENDER_LIST_ID
//   RESEND_API_KEY
//   APP_URL         адрес приложения для ссылок в письмах (https://…)

import "server-only"

export type OutgoingEmail = {
  to: string
  subject: string
  text: string
  html?: string
}

export type MailResult =
  | { ok: true; driver: MailDriver; messageId?: string }
  | { ok: false; driver: MailDriver; error: string }

export type MailDriver = "console" | "unisender" | "resend"

/** Исходящие письма текущего процесса: в консольном режиме сюда попадает
 *  ссылка восстановления — её видно в логах и в тестах. */
const outbox: OutgoingEmail[] = []

/** Ограничение, чтобы исходящий ящик не рос бесконечно на долгоживущем сервере. */
const OUTBOX_LIMIT = 50

export function getMailOutbox(): readonly OutgoingEmail[] {
  return outbox
}

export function resetMailOutbox(): void {
  outbox.length = 0
}

export function mailDriver(): MailDriver {
  const raw = String(process.env.MAIL_DRIVER ?? "").trim().toLowerCase()
  if (raw === "unisender" || raw === "resend") return raw
  return "console"
}

export function mailFrom(): string {
  return (
    String(process.env.MAIL_FROM ?? "").trim() ||
    String(process.env.MAIL_FROM_EMAIL ?? "").trim() ||
    "Loginex <no-reply@loginex.local>"
  )
}

/** Адрес приложения для ссылок в письмах. */
export function appUrl(): string {
  const raw =
    String(process.env.APP_URL ?? "").trim() ||
    String(process.env.NEXTAUTH_URL ?? "").trim() ||
    "http://localhost:3000"
  return raw.replace(/\/+$/, "")
}

/** Отправляет письмо выбранным драйвером. */
export async function sendEmail(email: OutgoingEmail): Promise<MailResult> {
  const driver = mailDriver()
  const to = String(email.to ?? "").trim()
  if (!to) {
    return { ok: false, driver, error: "Не указан получатель письма" }
  }

  if (driver === "console") {
    outbox.push({ ...email, to })
    if (outbox.length > OUTBOX_LIMIT) outbox.shift()
    console.log(
      `[mailer:console] письмо «${email.subject}» → ${to}\n` +
        `${email.text.split("\n").map((line) => `    ${line}`).join("\n")}`,
    )
    return { ok: true, driver }
  }

  try {
    if (driver === "unisender") return await sendViaUnisender(email, to)
    return await sendViaResend(email, to)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[mailer:${driver}] письмо не отправлено:`, message)
    return { ok: false, driver, error: message }
  }
}

async function sendViaUnisender(email: OutgoingEmail, to: string): Promise<MailResult> {
  const apiKey = String(process.env.UNISENDER_API_KEY ?? "").trim()
  const listId = String(process.env.UNISENDER_LIST_ID ?? "").trim()
  if (!apiKey || !listId) {
    return {
      ok: false,
      driver: "unisender",
      error: "Не заданы UNISENDER_API_KEY / UNISENDER_LIST_ID",
    }
  }

  const payload = {
    api_key: apiKey,
    sender_email: mailFrom(),
    sender_name: "Loginex",
    subject: email.subject,
    body: email.html ?? escapeHtml(email.text),
    list_id: listId,
    email: to,
    lang: "ru",
  }

  const response = await fetch("https://api.unisender.com/ru/api/sendEmail?format=json", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(payload as Record<string, string>).toString(),
    cache: "no-store",
  })

  const data = (await response.json().catch(() => null)) as
    | { result?: { email_id?: string }; error?: string }
    | null

  if (!response.ok || data?.error) {
    return { ok: false, driver: "unisender", error: data?.error || `Unisender ответил ${response.status}` }
  }

  return { ok: true, driver: "unisender", messageId: data?.result?.email_id }
}

async function sendViaResend(email: OutgoingEmail, to: string): Promise<MailResult> {
  const apiKey = String(process.env.RESEND_API_KEY ?? "").trim()
  if (!apiKey) {
    return { ok: false, driver: "resend", error: "Не задан RESEND_API_KEY" }
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: mailFrom(),
      to: [to],
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
    cache: "no-store",
  })

  const data = (await response.json().catch(() => null)) as { id?: string; message?: string } | null
  if (!response.ok) {
    return { ok: false, driver: "resend", error: data?.message || `Resend ответил ${response.status}` }
  }

  return { ok: true, driver: "resend", messageId: data?.id }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />")
}

/** Письмо восстановления пароля. Ссылка ведёт на страницу смены пароля. */
export function buildPasswordResetEmail(params: {
  to: string
  resetUrl: string
  expiresInMinutes: number
  productName?: string
}): OutgoingEmail {
  const product = params.productName || "Loginex TMS"
  const minutes = Math.max(1, Math.round(params.expiresInMinutes))

  return {
    to: params.to,
    subject: `${product}: восстановление пароля`,
    text:
      `Здравствуйте!\n\n` +
      `Вы попросили восстановить пароль в ${product}. ` +
      `Чтобы задать новый пароль, откройте ссылку:\n\n${params.resetUrl}\n\n` +
      `Ссылка работает ${minutes} минут и одноразовая — повторно её использовать не получится.\n\n` +
      `Если пароль восстанавливать не нужно, просто проигнорируйте письмо: ` +
      `пароль останется прежним, но на всякий случай проверить вход стоит.\n\n` +
      `— Команда ${product}`,
    html:
      `<p>Здравствуйте!</p>` +
      `<p>Вы попросили восстановить пароль в <b>${product}</b>. ` +
      `Чтобы задать новый пароль, нажмите кнопку:</p>` +
      `<p><a href="${params.resetUrl}" style="display:inline-block;padding:10px 18px;` +
      `background:#2563eb;color:#fff;text-decoration:none;border-radius:8px">` +
      `Задать новый пароль</a></p>` +
      `<p>Или скопируйте ссылку: <br /><a href="${params.resetUrl}">${params.resetUrl}</a></p>` +
      `<p>Ссылка работает ${minutes} минут и одноразовая.</p>` +
      `<p>Если пароль восстанавливать не нужно, проигнорируйте письмо — ` +
      `пароль останется прежним.</p>` +
      `<p>— Команда ${product}</p>`,
  }
}
