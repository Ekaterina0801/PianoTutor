export function formatInteger(value: number) {
  const safe = Number.isFinite(value) ? Math.round(value) : 0;
  return String(safe).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
