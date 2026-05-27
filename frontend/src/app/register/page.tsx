"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { useAuth } from "@/components/auth";
import { Button, Card, CardBody, CardHeader, Pill } from "@/components/ui";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    try {
      await register(email, password, name);
      router.push("/");
    } catch {
      setError("Регистрация не выполнена. Минимальный пароль: 6 символов.");
    }
  };

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader title="Регистрация студента" subtitle="Преподавателей, исследователей и администраторов создаёт администратор." right={<Pill>Студент</Pill>} />
        <CardBody>
          <div className="space-y-3">
            <input value={name} onChange={(e)=>setName(e.target.value)} className="w-full rounded-xl2 border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="имя" />
            <input value={email} onChange={(e)=>setEmail(e.target.value)} className="w-full rounded-xl2 border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="email" />
            <input value={password} onChange={(e)=>setPassword(e.target.value)} type="password" className="w-full rounded-xl2 border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="пароль" />
            {error ? <div className="rounded-xl2 border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
            <Button onClick={submit} className="w-full"><UserPlus className="h-4 w-4" /> Создать аккаунт</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
