#!/usr/bin/env node
/**
 * Валидатор реестра аудита frontend (ISSUES.json).
 *
 * Запуск из корня репозитория:
 *   node audit/frontend/validate-issues-json.mjs
 *
 * Без зависимостей (только встроенные модули Node). Код выхода: 0 — валидно,
 * 1 — есть ошибки. Проверяет:
 *   1. Парсинг JSON и структуру корня (issues[], issueCounters).
 *   2. Уникальность и формат ID (FE-NNNN).
 *   3. Обязательные поля: id, title, category, severity, status, evidence, verification.
 *   4. Enum-значения: severity, status; префиксы verification (static/live-production/tooling).
 *   5. file: путь от корня репозитория + существование на диске;
 *      если file отсутствует — обязателен fileNote (явное указание, почему пути нет).
 *   6. lines: непустая строка (мягкая проверка формата).
 *   7. issueCounters совпадают с фактическими количеством по severity/status.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const issuesPath = resolve(scriptDir, 'ISSUES.json');

const SEVERITIES = new Set(['Critical', 'High', 'Medium', 'Low', 'Info']);
const STATUSES = new Set(['Confirmed', 'Suspected', 'Fixed-externally', 'Rejected']);
const VERIFICATION_PREFIXES = ['static', 'live-production', 'tooling'];
const VERIFICATION_EXACT = new Set(['перепроверено (цикл 12)']);
const ID_PATTERN = /^FE-\d{4}$/;
const REQUIRED_FIELDS = ['id', 'title', 'category', 'severity', 'status', 'evidence', 'verification'];

const errors = [];
const warnings = [];
const pushError = (id, message) => errors.push(`  ${id || 'ROOT'}: ${message}`);
const pushWarning = (id, message) => warnings.push(`  ${id || 'ROOT'}: ${message}`);

let raw;
try {
  raw = readFileSync(issuesPath, 'utf8');
} catch (readError) {
  console.error(`ISSUES.json не читается: ${readError.message}`);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch (parseError) {
  console.error(`ISSUES.json не парсится: ${parseError.message}`);
  process.exit(1);
}

if (!Array.isArray(parsed.issues)) {
  console.error('Корень ISSUES.json: поле issues должно быть массивом.');
  process.exit(1);
}

const seenIds = new Set();
const severityCounts = { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 };
const statusCounts = { Confirmed: 0, Suspected: 0, 'Fixed-externally': 0, Rejected: 0 };

for (const issue of parsed.issues) {
  const id = issue?.id ?? '(без id)';
  if (!ID_PATTERN.test(String(issue?.id || ''))) pushError(id, `ID не соответствует формату FE-NNNN: ${issue?.id}`);
  if (seenIds.has(issue?.id)) pushError(id, 'дубликат ID');
  seenIds.add(issue?.id);

  for (const field of REQUIRED_FIELDS) {
    if (issue?.[field] === undefined || issue?.[field] === null || issue?.[field] === '') {
      pushError(id, `отсутствует обязательное поле "${field}"`);
    }
  }
  if (!SEVERITIES.has(issue?.severity)) pushError(id, `severity вне enum: ${issue?.severity}`);
  else severityCounts[issue.severity] += 1;
  if (!STATUSES.has(String(issue?.status || '').split(' ')[0])) pushError(id, `status вне enum: ${issue?.status}`);
  else statusCounts[String(issue.status).split(' ')[0]] += 1;

  const verification = issue?.verification;
  if (Array.isArray(verification)) {
    if (verification.length === 0) pushError(id, 'verification пуст');
    for (const value of verification) {
      if (!VERIFICATION_EXACT.has(String(value)) && !VERIFICATION_PREFIXES.some((prefix) => String(value).startsWith(prefix))) {
        pushError(id, `verification вне допустимых префиксов (${VERIFICATION_PREFIXES.join('/')}): ${value}`);
      }
    }
  }
  if (!Array.isArray(issue?.evidence) || issue.evidence.length === 0) {
    pushError(id, 'evidence должен быть непустым массивом');
  }

  if (issue?.file !== undefined && issue.file !== null) {
    const filePath = String(issue.file);
    if (!filePath) {
      pushError(id, 'file пуст');
    } else {
      if (filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('src/') || filePath.startsWith('../')) {
        pushError(id, `file должен быть путём от корня репозитория: ${filePath}`);
      } else if (!existsSync(resolve(repoRoot, filePath))) {
        pushWarning(id, `file не найден в рабочей копии: ${filePath}`);
      }
    }
  } else if (!String(issue?.fileNote || '').trim()) {
    pushError(id, 'file отсутствует без объяснения: добавьте fileNote с причиной (запрещено выдумывать путь)');
  }

  if (issue?.lines !== undefined && issue?.lines !== null && !String(issue.lines).trim()) {
    pushError(id, 'lines пуст');
  }
}

const declared = parsed.issueCounters || {};
const counterChecks = [
  ['critical', severityCounts.Critical],
  ['high', severityCounts.High],
  ['medium', severityCounts.Medium],
  ['low', severityCounts.Low],
  ['info', severityCounts.Info],
  ['suspected', statusCounts.Suspected],
];
for (const [key, actual] of counterChecks) {
  const declaredValue = Number(declared[key]);
  if (!Number.isFinite(declaredValue)) pushWarning('ROOT', `issueCounters.${key} не задан`);
  else if (declaredValue !== actual) pushError('ROOT', `issueCounters.${key}=${declaredValue} не совпадает с фактическим ${actual}`);
}
const totalDeclared = Object.entries(declared)
  .filter(([key]) => ['critical', 'high', 'medium', 'low', 'info'].includes(key))
  .reduce((sum, [, value]) => sum + Number(value || 0), 0);
if (Number.isFinite(totalDeclared) && totalDeclared !== parsed.issues.length) {
  pushError('ROOT', `сумма счётчиков severity (${totalDeclared}) != числу записей (${parsed.issues.length})`);
}

console.log(`ISSUES.json: ${parsed.issues.length} записей`);
console.log(`  severity: ${JSON.stringify(severityCounts)}`);
console.log(`  status:   ${JSON.stringify(statusCounts)}`);
if (warnings.length) {
  console.log(`Предупреждения (${warnings.length}):`);
  for (const warning of warnings) console.log(warning);
}
if (errors.length) {
  console.error(`ОШИБКИ (${errors.length}):`);
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log('Валидация пройдена: ошибок нет.');
