/**
 * /login — экран входа сотрудника.
 *
 * Серверный компонент: читает ?next= и передаёт его в форму, чтобы после входа
 * вернуть человека на ту страницу, с которой его развернул middleware.
 * middleware отдельно следит, чтобы уже вошедший пользователь сюда не попадал.
 */

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { LoginForm } from "@/components/login-form";
import type { Metadata } from "next";
import { PRODUCT_NAME, STAFF_COOKIE } from "@/lib/auth/constants";
import { verifySessionToken } from "@/lib/auth/token";
import { isMobileUserAgent } from "@/lib/device";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Вход · ${PRODUCT_NAME}`,
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = params?.next;

  // Уже вошедший сотрудник не должен видеть форму входа
  const cookieStore = await cookies();
  try {
    const session = await verifySessionToken(
      cookieStore.get(STAFF_COOKIE)?.value,
    );
    if (session && session.kind === "staff") {
      if (next && next.startsWith("/")) redirect(next);
      const headerStore = await headers();
      redirect(
        isMobileUserAgent(headerStore.get("user-agent")) ? "/s" : "/dashboard",
      );
    }
  } catch {
    // AUTH_SECRET не задан или токен битый — показываем форму входа
  }

  return <LoginForm nextPath={next} />;
}
