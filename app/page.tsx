import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">Reserving Copilot</h1>
      <p className="text-sm text-gray-600">
        Agentic insurance reserving with a deterministic engine.
      </p>
      <Link
        href="/sign-in"
        className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
      >
        Sign in
      </Link>
    </main>
  );
}
