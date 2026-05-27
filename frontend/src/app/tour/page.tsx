"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, AudioLines, ChevronLeft, ChevronRight, FileAudio, FlaskConical, KeyboardMusic, LineChart, Mic, Piano, Shield, Sparkles, Trophy } from "lucide-react";
import { Button, HelpTip, Pill } from "@/components/ui";

const slides = [
  {
    kicker: "Старт",
    title: "Умный пианист собирает практику в понятный самоучитель",
    text: "Вы выбираете упражнение, играете удобным способом, сохраняете отчет и получаете XP, уровни, достижения и конкретные ошибки",
    href: "/library",
    cta: "Открыть библиотеку",
    icon: Piano,
    tone: "lime",
  },
  {
    kicker: "Режимы ввода",
    title: "Экранное пианино, MIDI, микрофон и файл",
    text: "Эмулятор и MIDI дают точные события. Микрофон и аудиофайл сначала проходят распознавание нот, затем сравниваются с эталоном",
    href: "/practice/scale_c_major",
    cta: "Попробовать упражнение",
    icon: KeyboardMusic,
    tone: "cyan",
  },
  {
    kicker: "Микрофон",
    title: "Запись ведет по шагам: запись, распознавание, оценка",
    text: "Нажмите запись, сыграйте фрагмент и остановите. Сервис покажет уровень сигнала, отправит аудио на AMT и сам построит сравнение",
    href: "/practice/scale_c_major",
    cta: "Открыть запись",
    icon: Mic,
    tone: "rose",
  },
  {
    kicker: "Отчет",
    title: "После попытки видно не только балл, но и разбор",
    text: "F1, тайминг, пропущенные ноты, лишние ноты, пиано-ролл и анимация клавиш помогают понять, что именно исправлять. Используется умная система анализа",
    href: "/progress",
    cta: "К прогрессу",
    icon: LineChart,
    tone: "amber",
  },
  {
    kicker: "Геймификация",
    title: "XP, уровни, ежедневные задания и достижения",
    text: "Страница прогресса показывает текущий уровень, все будущие уровни, все достижения и историю попыток",
    href: "/progress",
    cta: "Смотреть уровни",
    icon: Trophy,
    tone: "lime",
  },
  {
    kicker: "Исследования и админка",
    title: "Для аналитики и управления есть отдельные панели",
    text: "Исследовательская лаборатория сравнивает корректоры, а админка показывает статистику пользователей, активность, риск-профили и последние отчеты",
    href: "/admin",
    cta: "Открыть админку",
    icon: Shield,
    tone: "cyan",
  },
];

function toneGradient(tone: string) {
  if (tone === "rose") return "from-rose-300 via-orange-300 to-amber-200 text-rose-950";
  if (tone === "amber") return "from-amber-300 via-lime-300 to-cyan-200 text-amber-950";
  if (tone === "cyan") return "from-cyan-300 via-sky-300 to-lime-200 text-cyan-950";
  return "from-lime-300 via-cyan-300 to-amber-200 text-lime-950";
}

export default function TourPage() {
  const [index, setIndex] = useState(0);
  const slide = slides[index];
  const Icon = slide.icon;
  const progress = useMemo(() => ((index + 1) / slides.length) * 100, [index]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((value) => (value + 1) % slides.length);
    }, 10000);
    return () => window.clearInterval(timer);
  }, []);

  const go = (delta: number) => setIndex((value) => (value + delta + slides.length) % slides.length);

  return (
    <div className="space-y-6 pb-24 lg:pb-6">
      <section className="relative min-h-[72vh] overflow-hidden rounded-[2.4rem] border border-white/10 bg-[radial-gradient(circle_at_20%_15%,rgba(132,204,22,0.25),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(34,211,238,0.20),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.07),rgba(255,255,255,0.025))] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.30)]">
        <motion.div
          className="absolute -right-16 -top-16 h-64 w-64 rounded-full border border-white/10 bg-white/5"
          animate={{ rotate: 360, scale: [1, 1.04, 1] }}
          transition={{ rotate: { duration: 24, repeat: Infinity, ease: "linear" }, scale: { duration: 5, repeat: Infinity } }}
        />
        <motion.div
          className="absolute bottom-6 right-8 hidden h-48 w-48 rounded-[3rem] border border-white/10 bg-black/15 md:block"
          animate={{ y: [0, -12, 0], rotate: [0, 4, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />

        <div className="relative flex flex-col gap-6 lg:min-h-[66vh] lg:flex-row lg:items-center">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Pill><Sparkles className="mr-1 h-3.5 w-3.5 text-lime-300" /> Интерактивный тур</Pill>
              <HelpTip text="Этот тур можно открыть в любой момент из меню. Он показывает ключевые разделы сервиса и ведет к нужной странице кнопкой на каждом слайде" />
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={slide.title}
                initial={{ opacity: 0, y: 22, filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -18, filter: "blur(8px)" }}
                transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                className="mt-8"
              >
                <div className="text-sm font-black uppercase tracking-[0.22em] text-lime-200">{slide.kicker}</div>
                <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-tight lg:text-6xl">{slide.title}</h1>
                <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-200">{slide.text}</p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <Link href={slide.href}>
                    <Button>
                      {slide.cta}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Button variant="outline" onClick={() => go(1)}>Следующий слайд</Button>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="w-full lg:w-[440px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={slide.kicker}
                initial={{ opacity: 0, scale: 0.92, rotate: -3 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.94, rotate: 3 }}
                transition={{ type: "spring", stiffness: 180, damping: 20 }}
                className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/60 p-5"
              >
                <div className={`grid h-24 w-24 place-items-center rounded-[1.8rem] bg-gradient-to-br ${toneGradient(slide.tone)} shadow-[0_20px_60px_rgba(0,0,0,0.25)]`}>
                  <Icon className="h-11 w-11" />
                </div>

                <div className="mt-6 grid grid-cols-8 gap-1">
                  {Array.from({ length: 24 }, (_, key) => (
                    <motion.div
                      key={key}
                      className={key % 7 === index % 7 ? "h-24 rounded-b-xl rounded-t-md bg-lime-300" : key % 5 === 0 ? "h-16 rounded-b-lg rounded-t-md bg-zinc-800" : "h-24 rounded-b-xl rounded-t-md bg-white"}
                      animate={key % 7 === index % 7 ? { y: [0, 8, 0], filter: ["brightness(1)", "brightness(1.25)", "brightness(1)"] } : undefined}
                      transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                    />
                  ))}
                </div>

                <div className="mt-6 grid gap-3">
                  <MiniLine icon={<AudioLines className="h-4 w-4" />} label="Аудио AMT"/>
                  <MiniLine icon={<FileAudio className="h-4 w-4" />} label="Отчет"/>
                  <MiniLine icon={<FlaskConical className="h-4 w-4" />} label="Сравнение"/>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <div className="relative mt-6 flex flex-col gap-4 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => go(-1)} className="px-3"><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" onClick={() => go(1)} className="px-3"><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <div className="flex flex-1 items-center gap-2 sm:max-w-md">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/25">
              <motion.div className="premium-xp-bar h-full rounded-full" animate={{ width: `${progress}%` }} />
            </div>
            <div className="text-xs text-[rgb(var(--muted))]">{index + 1}/{slides.length}</div>
          </div>
          <div className="flex gap-2">
            {slides.map((item, dotIndex) => (
              <button
                key={item.title}
                onClick={() => setIndex(dotIndex)}
                className={dotIndex === index ? "h-2.5 w-8 rounded-full bg-lime-300" : "h-2.5 w-2.5 rounded-full bg-white/20"}
                aria-label={`Слайд ${dotIndex + 1}`}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function MiniLine({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm">
      <span className="inline-flex items-center gap-2 text-[rgb(var(--muted))]">{icon}{label}</span>
      {value ? <span className="font-black text-lime-200">{value}</span> : null}
    </div>
  );
}
