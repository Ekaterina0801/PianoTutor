import type { UserRole } from "@/lib/types";

export function roleLabel(role?: UserRole | string | null) {
  if (role === "student") return "Студент";
  if (role === "teacher") return "Преподаватель";
  if (role === "researcher") return "Исследователь";
  if (role === "admin") return "Администратор";
  return "Гость";
}

export function assistantLabelRu(mode?: string | null) {
  if (!mode) return "—";
  if (mode === "off") return "Без корректора";
  if (mode === "heuristic" || mode === "on") return "Эвристический";
  if (mode === "tcn") return "TCN";
  if (mode === "bilstm") return "BiLSTM";
  if (mode === "transformer") return "Transformer";
  if (mode === "experimental") return "Экспериментальный";
  return mode;
}

export function decisionLabelRu(value?: string | null) {
  if (!value) return "решение недоступно";
  if (value === "off") return "выключен";
  if (value === "accepted") return "принято";
  if (value === "rejected") return "отклонено";
  if (value === "fallback") return "резервный режим";
  return value;
}

export function alignerLabelRu(mode?: string | null) {
  if (!mode) return "—";
  if (mode === "offset") return "Смещение";
  if (mode === "linear_dtw") return "Линейный DTW";
  if (mode === "safe_linear_dtw") return "Безопасный DTW";
  if (mode === "basic") return "Базовое";
  if (mode === "dtw") return "DTW";
  return mode;
}

export function sourceLabelRu(source?: string | null) {
  if (!source) return "источник неизвестен";
  if (source === "midi") return "MIDI";
  if (source === "mic") return "микрофон";
  return source;
}
