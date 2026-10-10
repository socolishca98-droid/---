// lib/auth/owner.ts
//
// Владелец платформы: аккаунт, который может войти в любой другой аккаунт.
//
// Это не отдельная роль в базе, а признак конкретного email: у владельца
// обычная учётная запись логиста/администратора со своим паролем, плюс право
// на «вход как». Так сделано по двум причинам:
//   1. пароль и сессии обычные — ничего нового хранить и защищать не нужно;
//   2. право нельзя получить через интерфейс: email задан в окружении
//      (OWNER_EMAIL) и совпадает с email пользователя из проверенной сессии.
//
// Файл чистый (без Prisma и Next), чтобы правило можно было тестировать.

/** Срок сессии владельца: через это время нужен снова логин и пароль. */
export const OWNER_SESSION_TTL_MINUTES = 30

/** Email владельца платформы. Меняется переменной окружения OWNER_EMAIL. */
export const DEFAULT_OWNER_EMAIL = "socolishca98@gmail.com"

/** Список email'ов владельцев: основной из OWNER_EMAIL + значение по умолчанию. */
export function ownerEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.OWNER_EMAIL ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  const defaults = [DEFAULT_OWNER_EMAIL]
  return [...new Set([...configured, ...defaults])]
}

export function isOwnerEmail(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = (email ?? "").trim().toLowerCase()
  if (!value) return false
  return ownerEmails(env).includes(value)
}
