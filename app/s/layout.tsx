import type { Metadata, Viewport } from "next";

import { StaffMobileShell } from "@/components/staff-mobile/shell";

export const metadata: Metadata = {
  title: "Loginex — диспетчер",
  description: "Мобильный пульт логиста: решения, рейсы, чат и показатели дня",
  manifest: "/manifest-staff.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Loginex",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#09090b",
};

export default function StaffMobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen text-zinc-100 flex justify-center">
      <div className="w-full max-w-md mx-auto relative">
        <StaffMobileShell>{children}</StaffMobileShell>
      </div>
    </div>
  );
}
