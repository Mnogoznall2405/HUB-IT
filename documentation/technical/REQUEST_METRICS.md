# Backend Request Metrics

## Зачем

Backend собирает in-memory статистику HTTP-запросов по routes, чтобы быстро видеть, какие endpoints первыми требуют оптимизации.

Метрики не требуют Redis/Prometheus и сбрасываются при рестарте backend.

## Endpoint

Только для admin:

```text
GET /api/v1/system/request-metrics?limit=50&sort_by=p95_ms
POST /api/v1/system/request-metrics/reset
```

`sort_by`:

- `p95_ms` — главный режим для поиска медленных endpoints
- `count` — самые частые endpoints
- `server_error_count` — endpoints с 5xx
- `mean_ms`, `p99_ms`, `max_ms` — дополнительные режимы

## Как читать

1. Сначала смотрите `hotspots`.
2. Если `reason=slow_p95`, оптимизируйте сам endpoint: SQL, Exchange/EWS, JSON-файлы, внешние вызовы, кэш.
3. Если `reason=hot_path`, endpoint вызывается часто и даже умеренная задержка даёт большую нагрузку.
4. Если `reason=server_error_rate`, сначала чините стабильность, потом скорость.

## Настройки

```env
REQUEST_METRICS_ENABLED=1
REQUEST_METRICS_SLOW_MS=1000
REQUEST_METRICS_MAX_ROUTES=300
REQUEST_METRICS_SAMPLE_SIZE=512
```

`REQUEST_METRICS_SLOW_MS` также включает warning-лог `http.slow` для запросов выше порога.
