export const localWorkDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
export const workNumber = (value, maximumFractionDigits = 4) => value == null ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits }).format(Number(value));
export const workCountLabel = (count) => {
  const lastTwo = count % 100;
  const last = count % 10;
  return `${count} ${lastTwo >= 11 && lastTwo <= 14 ? 'работ' : last === 1 ? 'работа' : last >= 2 && last <= 4 ? 'работы' : 'работ'}`;
};
export const workError = (error) => {
  const detail = error?.response?.data?.detail;
  return typeof detail === 'string' ? detail : Array.isArray(detail)
    ? 'Проверьте объёмы, даты и обязательные поля. Объём должен быть неотрицательным, не более четырёх знаков после запятой.'
    : 'Не удалось выполнить операцию. Проверьте подключение и повторите попытку.';
};
export const PLAN_FIELDS = [
  ['section', 'Раздел'], ['name', 'Работа'], ['unit', 'Ед. изм.'],
  ['planned_quantity', 'Плановый объём', 'number'], ['weight', 'Вес в общем объёме работ', 'number'],
  ['initial_quantity', 'Начальный выполненный объём', 'number'], ['initial_date', 'Начальный объём на дату', 'date'],
  ['planned_start', 'Начало — план', 'date'], ['revised_start', 'Начало — корректировка', 'date'], ['actual_start', 'Начало — факт', 'date'],
  ['planned_end', 'Окончание — план', 'date'], ['revised_end', 'Окончание — корректировка', 'date'], ['actual_end', 'Окончание — факт', 'date'],
  ['material_comment', 'Комментарий к поставке ТМЦ'], ['production_comment', 'Примечание к производству'],
];
export const emptyWorkPlan = () => ({
  section: '', name: '', unit: '', planned_quantity: '0', weight: null,
  initial_quantity: '0', initial_date: null, planned_start: null, revised_start: null, actual_start: null,
  planned_end: null, revised_end: null, actual_end: null, material_comment: '', production_comment: '', sort_order: 0, archived: false,
});
