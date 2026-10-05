/**
 * Textos de GoBills en español, inglés y ruso. Una sola fuente para el
 * dashboard y las secciones nuevas; el selector de idioma guarda la elección
 * en localStorage ('gocab_lang') y avisa con el evento 'gocab_lang_change'.
 */
export const IDIOMAS = ['es', 'en', 'ru'];

export const LANGS = {
  es: {
    greeting: (name) => `Hola, ${name} 👋`,
    reports_label: 'Reportes disponibles',
    bills_title: 'Reporte de Bills',
    bills_sub: 'Cobros por conductor y vehículo · Pendientes y completados',
    financial_title: 'Reporte Financiero',
    financial_sub: 'Consolidado SumUp · Transacciones y balance de cuentas',
    tareas_title: 'Tareas Operacionales',
    tareas_sub: 'Mapa de tareas por proceso y persona · Editable en equipo',
    managers_badge: 'Gerentes',
    no_access: 'No tienes acceso a este reporte.',
    historial_title: 'Historial de vehículos',
    historial_sub: 'Ficha de cada auto · Entregas, recepciones, talleres, siniestros y gastos',
    carga_title: 'Carga de datos',
    carga_sub: 'Exports de Fleet · Vehículos, conductores, bills y multas',
    en_construccion: 'Esta sección está en construcción.',
    volver_dashboard: 'Dashboard',
  },
  en: {
    greeting: (name) => `Hello, ${name} 👋`,
    reports_label: 'Available reports',
    bills_title: 'Bills Report',
    bills_sub: 'Driver & vehicle charges · Pending and completed',
    financial_title: 'Financial Report',
    financial_sub: 'SumUp summary · Transactions and account balance',
    tareas_title: 'Operational Tasks',
    tareas_sub: 'Task map by process and person · Team-editable',
    managers_badge: 'Managers',
    no_access: 'You do not have access to this report.',
    historial_title: 'Vehicle history',
    historial_sub: 'Record for each car · Handovers, returns, workshops, claims and expenses',
    carga_title: 'Data upload',
    carga_sub: 'Fleet exports · Vehicles, drivers, bills and fines',
    en_construccion: 'This section is under construction.',
    volver_dashboard: 'Dashboard',
  },
  ru: {
    greeting: (name) => `Привет, ${name} 👋`,
    reports_label: 'Доступные отчёты',
    bills_title: 'Отчёт по счетам',
    bills_sub: 'Начисления по водителям и ТС · Ожидающие и завершённые',
    financial_title: 'Финансовый отчёт',
    financial_sub: 'Сводка SumUp · Транзакции и баланс счетов',
    tareas_title: 'Операционные задачи',
    tareas_sub: 'Карта задач по процессам и людям · Совместное редактирование',
    managers_badge: 'Менеджеры',
    no_access: 'У вас нет доступа к этому отчёту.',
    historial_title: 'История автомобилей',
    historial_sub: 'Карточка каждого авто · Выдачи, приёмки, сервис, страховые случаи и расходы',
    carga_title: 'Загрузка данных',
    carga_sub: 'Выгрузки Fleet · Автомобили, водители, счета и штрафы',
    en_construccion: 'Раздел в разработке.',
    volver_dashboard: 'Панель',
  },
};

/** Texto de una clave; cae a español y, si tampoco existe, devuelve la clave. */
export function traducir(lang, clave) {
  return (LANGS[lang] || LANGS.es)[clave] ?? LANGS.es[clave] ?? clave;
}
