"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Redirect old infrastructure path to the new admin section.
 * Bookmarks and old links will automatically land on the correct page.
 */
export default function InfrastructureRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/admin/infrastructure");
  }, [router]);

  return null;
}
