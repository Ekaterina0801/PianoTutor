"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogIn } from "lucide-react";
import { useAuth } from "@/components/auth";
import { Button, Card, CardBody, CardHeader, Pill } from "@/components/ui";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("researcher@piano.local");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    try {
      await login(email, password);
      router.push("/");
    } catch {
      setError("Не удалось войти. Проверьте email и пароль.");
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Card>
        <CardHeader title="Вход" subtitle="Локальная ролевая система для студента, преподавателя, исследователя и администратора" />
        <CardBody>
          <div className="space-y-3">
            <input value={email} onChange={(e)=>setEmail(e.target.value)} className="w-full rounded-xl2 border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="email" />
            <input value={password} onChange={(e)=>setPassword(e.target.value)} type="password" className="w-full rounded-xl2 border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="пароль" />
            {error ? <div className="rounded-xl2 border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
            <Button onClick={submit} className="w-full"><LogIn className="h-4 w-4" /> Войти</Button>
          </div>
          <div className="mt-4 grid gap-2 text-xs text-[rgb(var(--muted))]">
            <div>Демо: student@piano.local / teacher@piano.local / researcher@piano.local / admin@piano.local</div>
            <div>Пароль для всех демо-ролей: demo1234</div>
            <div>Яна Михайловна, я это уберу потом :)</div>
            <Link href="/register" className="text-cyan-200 hover:underline">Создать аккаунт студента</Link>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
