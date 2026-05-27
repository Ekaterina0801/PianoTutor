export type ParsedSession = {
  id: string;
  exerciseId: string;
  createdAt: string;
  metrics: Record<string, any>;
};

export type Quest = {
  id: string;
  title: string;
  detail: string;
  progress: number;
  goal: number;
  rewardXp: number;
  done: boolean;
  tone: "lime" | "cyan" | "amber" | "rose";
};

export type Badge = {
  id: string;
  title: string;
  detail: string;
  earned: boolean;
  progress: number;
};

export type LevelDefinition = {
  level: number;
  title: string;
  chapter: string;
  perk: string;
  requiredXp: number;
  nextRequiredXp: number;
  span: number;
  unlocked: boolean;
  current: boolean;
  progress: number;
};

export type GamificationStats = {
  sessions: ParsedSession[];
  totalXp: number;
  level: number;
  levelTitle: string;
  levelXp: number;
  nextLevelXp: number;
  levelProgress: number;
  todayXp: number;
  streakDays: number;
  bestF1: number;
  averageF1: number;
  averageRobustness: number;
  accuracyPercent: number;
  notesMastered: number;
  quests: Quest[];
  badges: Badge[];
  levels: LevelDefinition[];
  weekly: { label: string; xp: number; sessions: number }[];
  nextLesson: {
    href: string;
    title: string;
    subtitle: string;
  };
};

export const LEVEL_TITLES = [
  "Первые клавиши",
  "Первая привычка",
  "Ровные ноты",
  "Уверенный темп",
  "Без лишних нот",
  "Две руки вместе",
  "Аккорды",
  "Чище и спокойнее",
  "Лучше держу ритм",
  "Быстрее читаю ноты",
  "Меньше промахов",
  "Стабильные занятия",
  "Лучше слышу ошибки",
  "Контроль педали",
  "Играю длиннее",
  "Техника крепче",
  "Собираю пьесу",
  "Готовлю выступление",
  "Почти без срывов",
  "Свободная игра",
];

const LEVEL_CHAPTERS = ["Начало", "Техника", "Слух", "Уверенность"];
const LEVEL_PERKS = [
  "Появляется первый отчет",
  "Начинаем считать серию занятий",
  "Видно, где ноты совпали с эталоном",
  "Отдельно смотрим задержки",
  "Следим за лишними нотами",
  "Больше внимания левой руке",
  "Появляются цели по аккордам",
  "Сравниваем попытки между собой",
  "Держим длительности нот",
  "Короткие задания на каждый день",
  "Отдельно смотрим чистоту аккордов",
  "Серия занятий становится важнее",
  "Подсказки по типичным ошибкам",
  "Проверяем педаль и длинные звуки",
  "Смотрим, хватает ли выносливости",
  "Задания на технику",
  "Путь по навыкам становится длиннее",
  "Готовим ровное исполнение",
  "Собираем лучшие отчеты",
  "Дальше можно усложнять репертуар",
];

const MS_DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

type GamificationOptions = {
  now?: Date | string | number;
};

function safeMetrics(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function safeNow(value?: Date | string | number) {
  const d = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
}

function localDayKey(raw: string) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return dayKey(local);
}

export function parseSessions(items: any[] = []): ParsedSession[] {
  return items
    .map((s) => ({
      id: String(s.id ?? ""),
      exerciseId: String(s.exercise_id ?? "practice"),
      createdAt: String(s.created_at ?? ""),
      metrics: safeMetrics(s.metrics_json ?? s.metrics),
    }))
    .filter((s) => s.id || s.createdAt)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function sessionXp(metrics: Record<string, any>) {
  const f1 = clamp01(Number(metrics.f1 ?? 0));
  const robustness = clamp01(Number(metrics.robustness_score ?? f1));
  const chord = clamp01(Number(metrics.chord_f1 ?? f1));
  const duration = clamp01(Number(metrics.duration_score ?? 0));
  const velocity = clamp01(Number(metrics.velocity_score ?? 0));
  const cleanBonus = Number(metrics.extra ?? 0) === 0 ? 12 : 0;
  return Math.max(12, Math.round(28 + f1 * 78 + robustness * 48 + chord * 32 + duration * 14 + velocity * 10 + cleanBonus));
}

function levelFromXp(totalXp: number) {
  let level = 1;
  let floor = 0;
  let next = 180;
  while (totalXp >= next) {
    level += 1;
    floor = next;
    next += 160 + level * 80;
  }
  return { level, floor, next };
}

export function buildLevelCatalog(totalXp = 0): LevelDefinition[] {
  let floor = 0;
  let next = 180;
  const currentLevel = Math.min(levelFromXp(totalXp).level, LEVEL_TITLES.length);

  return LEVEL_TITLES.map((title, index) => {
    const level = index + 1;
    const requiredXp = floor;
    const nextRequiredXp = next;
    const span = Math.max(1, nextRequiredXp - requiredXp);
    const item: LevelDefinition = {
      level,
      title,
      chapter: LEVEL_CHAPTERS[Math.min(LEVEL_CHAPTERS.length - 1, Math.floor(index / 5))],
      perk: LEVEL_PERKS[index] ?? "Новая цель практики",
      requiredXp,
      nextRequiredXp,
      span,
      unlocked: totalXp >= requiredXp,
      current: level === currentLevel,
      progress: clamp01((totalXp - requiredXp) / span),
    };
    floor = next;
    next += 160 + (level + 1) * 80;
    return item;
  });
}

function computeStreak(sessions: ParsedSession[], now: Date) {
  const days = new Set(sessions.map((s) => localDayKey(s.createdAt)).filter(Boolean));
  let cursor = new Date(now);
  cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
  if (!days.has(dayKey(cursor))) {
    cursor = new Date(cursor.getTime() - MS_DAY);
  }
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - MS_DAY);
  }
  return streak;
}

function buildWeekly(sessions: ParsedSession[], now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const buckets = Array.from({ length: 7 }, (_, index) => {
    const d = new Date(start.getTime() + index * MS_DAY);
    return {
      key: dayKey(d),
      label: WEEKDAYS_RU[d.getDay()],
      xp: 0,
      sessions: 0,
    };
  });
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const session of sessions) {
    const bucket = byKey.get(localDayKey(session.createdAt));
    if (!bucket) continue;
    bucket.sessions += 1;
    bucket.xp += sessionXp(session.metrics);
  }
  return buckets.map(({ label, xp, sessions }) => ({ label, xp, sessions }));
}

function buildQuests(sessions: ParsedSession[], todayXp: number, bestF1: number, now: Date): Quest[] {
  const today = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const todaySessions = sessions.filter((s) => localDayKey(s.createdAt) === today);
  const todayClean = todaySessions.filter((s) => Number(s.metrics.extra ?? 0) === 0).length;
  const todayHighAccuracy = todaySessions.filter((s) => Number(s.metrics.f1 ?? 0) >= 0.9).length;
  const todayChordFocus = todaySessions.filter((s) => Number(s.metrics.chord_f1 ?? 0) >= 0.82).length;
  const todayTimingFocus = todaySessions.filter((s) => Number(s.metrics.mae_s ?? 1) <= 0.06).length;
  return [
    {
      id: "daily-xp",
      title: "Позаниматься сегодня",
      detail: "Набрать 300 XP за любые упражнения",
      progress: Math.min(todayXp, 300),
      goal: 300,
      rewardXp: 60,
      done: todayXp >= 300,
      tone: "lime",
    },
    {
      id: "clean-take",
      title: "Сыграть без лишних нот",
      detail: "Сохранить одну чистую попытку",
      progress: Math.min(todayClean, 1),
      goal: 1,
      rewardXp: 45,
      done: todayClean >= 1,
      tone: "cyan",
    },
    {
      id: "accuracy",
      title: "Сыграть почти точно",
      detail: "Получить F1 не ниже 0.900",
      progress: Math.min(todayHighAccuracy, 1),
      goal: 1,
      rewardXp: 70,
      done: todayHighAccuracy >= 1 || bestF1 >= 0.95,
      tone: "amber",
    },
    {
      id: "chord-focus",
      title: "Разобраться с аккордом",
      detail: "Получить F1 аккордов не ниже 0.820",
      progress: Math.min(todayChordFocus, 1),
      goal: 1,
      rewardXp: 55,
      done: todayChordFocus >= 1,
      tone: "cyan",
    },
    {
      id: "timing-focus",
      title: "Попасть в начало ноты",
      detail: "Средняя ошибка атаки до 60 мс",
      progress: Math.min(todayTimingFocus, 1),
      goal: 1,
      rewardXp: 50,
      done: todayTimingFocus >= 1,
      tone: "rose",
    },
  ];
}

function buildBadges(sessions: ParsedSession[], averageF1: number, bestF1: number, streakDays: number): Badge[] {
  const total = sessions.length;
  const noExtra = sessions.filter((s) => Number(s.metrics.extra ?? 0) === 0).length;
  const chordWins = sessions.filter((s) => Number(s.metrics.chord_f1 ?? 0) >= 0.85).length;
  const timingWins = sessions.filter((s) => Number(s.metrics.mae_s ?? 1) <= 0.06).length;
  const longPractice = sessions.filter((s) => sessionXp(s.metrics) >= 160).length;
  return [
    {
      id: "first-song",
      title: "Первый отчет",
      detail: "Сохранить первую попытку",
      earned: total >= 1,
      progress: Math.min(1, total),
    },
    {
      id: "rhythm",
      title: "Уже ровнее",
      detail: "Средний F1 выше 0.850",
      earned: averageF1 >= 0.85,
      progress: clamp01(averageF1 / 0.85),
    },
    {
      id: "streak",
      title: "Возвращаюсь к занятиям",
      detail: "3 дня подряд",
      earned: streakDays >= 3,
      progress: clamp01(streakDays / 3),
    },
    {
      id: "clean",
      title: "Меньше случайных нот",
      detail: "3 сессии без лишних нот",
      earned: noExtra >= 3,
      progress: clamp01(noExtra / 3),
    },
    {
      id: "chords",
      title: "Аккорды звучат чище",
      detail: "3 сессии с F1 аккордов выше 0.850",
      earned: chordWins >= 3,
      progress: clamp01(chordWins / 3),
    },
    {
      id: "peak",
      title: "Очень точная попытка",
      detail: "Лучший F1 выше 0.950",
      earned: bestF1 >= 0.95,
      progress: clamp01(bestF1 / 0.95),
    },
    {
      id: "timing",
      title: "Лучше попадаю в долю",
      detail: "5 сессий с атакой до 60 мс",
      earned: timingWins >= 5,
      progress: clamp01(timingWins / 5),
    },
    {
      id: "veteran",
      title: "Занимаюсь регулярно",
      detail: "Сохранить 25 сессий",
      earned: total >= 25,
      progress: clamp01(total / 25),
    },
    {
      id: "xp-hunter",
      title: "Сильные попытки",
      detail: "5 сессий по 160 XP и выше",
      earned: longPractice >= 5,
      progress: clamp01(longPractice / 5),
    },
    {
      id: "week",
      title: "Неделя без паузы",
      detail: "7 дней серии",
      earned: streakDays >= 7,
      progress: clamp01(streakDays / 7),
    },
  ];
}

export function computeGamification(items: any[] = [], options: GamificationOptions = {}): GamificationStats {
  const now = safeNow(options.now);
  const sessions = parseSessions(items);
  const xpBySession = sessions.map((s) => sessionXp(s.metrics));
  const totalXp = xpBySession.reduce((acc, xp) => acc + xp, 0);
  const { level, floor, next } = levelFromXp(totalXp);
  const f1s = sessions.map((s) => Number(s.metrics.f1 ?? 0)).filter(Number.isFinite);
  const robustness = sessions.map((s) => Number(s.metrics.robustness_score ?? 0)).filter(Number.isFinite);
  const bestF1 = f1s.length ? Math.max(...f1s) : 0;
  const averageF1 = f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : 0;
  const averageRobustness = robustness.length ? robustness.reduce((a, b) => a + b, 0) / robustness.length : 0;
  const today = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const todayXp = sessions
    .filter((s) => localDayKey(s.createdAt) === today)
    .reduce((acc, s) => acc + sessionXp(s.metrics), 0);
  const streakDays = computeStreak(sessions, now);
  const notesMastered = sessions.reduce((acc, s) => acc + Number(s.metrics.correct ?? 0), 0);
  const nextLesson = bestF1 >= 0.86
    ? { href: "/practice/chords_c_major", title: "Аккорды до мажор", subtitle: "Пора попробовать аккорды и услышать, как сочетаются ноты" }
    : { href: "/practice/scale_c_major", title: "Гамма до мажор", subtitle: "Хорошее место, чтобы спокойно проверить темп и атаки" };

  return {
    sessions,
    totalXp,
    level,
    levelTitle: LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, level - 1)],
    levelXp: totalXp - floor,
    nextLevelXp: next - floor,
    levelProgress: clamp01((totalXp - floor) / Math.max(1, next - floor)),
    todayXp,
    streakDays,
    bestF1,
    averageF1,
    averageRobustness,
    accuracyPercent: Math.round(averageF1 * 100),
    notesMastered,
    quests: buildQuests(sessions, todayXp, bestF1, now),
    badges: buildBadges(sessions, averageF1, bestF1, streakDays),
    levels: buildLevelCatalog(totalXp),
    weekly: buildWeekly(sessions, now),
    nextLesson,
  };
}
