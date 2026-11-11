import apiClient from './client';

const SCAN_HOSTS_404_KEY = 'itinvent_scan_hosts_404';
const SCAN_HOSTS_404_TTL_MS = 6 * 60 * 60 * 1000;

const readScanHosts404Flag = () => {
  try {
    const raw = String(window.localStorage.getItem(SCAN_HOSTS_404_KEY) || '').trim();
    const ts = Number(raw);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return (Date.now() - ts) < SCAN_HOSTS_404_TTL_MS;
  } catch {
    return false;
  }
};

let scanHostsEndpointUnavailable = readScanHosts404Flag();

const markScanHostsUnavailable = (value) => {
  scanHostsEndpointUnavailable = Boolean(value);
  try {
    if (scanHostsEndpointUnavailable) {
      window.localStorage.setItem(SCAN_HOSTS_404_KEY, String(Date.now()));
    } else {
      window.localStorage.removeItem(SCAN_HOSTS_404_KEY);
    }
  } catch {
    // no-op
  }
};

const normalizeScanHost = (value) => String(value || '').trim().toUpperCase();

const toUnixTs = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return 0;
  return Math.floor(parsed / 1000);
};

const severityRank = (value) => {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'high') return 3;
  if (normalized === 'medium') return 2;
  if (normalized === 'low') return 1;
  return 0;
};

const aggregateHostsFromIncidents = (items) => {
  const source = Array.isArray(items) ? items : [];
  const map = new Map();

  source.forEach((incident) => {
    const hostname = normalizeScanHost(incident?.hostname);
    if (!hostname) return;

    if (!map.has(hostname)) {
      map.set(hostname, {
        hostname,
        incidents_total: 0,
        incidents_new: 0,
        last_incident_at: 0,
        top_severity: 'none',
        extMap: new Map(),
        sourceKindMap: new Map(),
      });
    }

    const entry = map.get(hostname);
    entry.incidents_total += 1;

    const status = String(incident?.status || '').toLowerCase();
    if (status !== 'acknowledged') {
      entry.incidents_new += 1;
    }

    const ts = toUnixTs(incident?.created_at || incident?.detected_at || incident?.updated_at);
    if (ts > entry.last_incident_at) {
      entry.last_incident_at = ts;
    }

    const rank = severityRank(incident?.severity);
    if (rank > severityRank(entry.top_severity)) {
      entry.top_severity = rank === 3 ? 'high' : rank === 2 ? 'medium' : rank === 1 ? 'low' : 'none';
    }

    const ext = String(incident?.file_ext || incident?.extension || '').trim().toLowerCase();
    if (ext) {
      entry.extMap.set(ext, (entry.extMap.get(ext) || 0) + 1);
    }

    const sourceKind = String(incident?.source_kind || incident?.source || '').trim().toLowerCase();
    if (sourceKind) {
      entry.sourceKindMap.set(sourceKind, (entry.sourceKindMap.get(sourceKind) || 0) + 1);
    }
  });

  return Array.from(map.values()).map((entry) => {
    const topExts = Array.from(entry.extMap.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([ext]) => ext);

    const topSourceKinds = Array.from(entry.sourceKindMap.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([kind]) => kind);

    return {
      hostname: entry.hostname,
      incidents_total: entry.incidents_total,
      incidents_new: entry.incidents_new,
      last_incident_at: entry.last_incident_at,
      top_severity: entry.top_severity,
      top_exts: topExts,
      top_source_kinds: topSourceKinds,
    };
  });
};

const getHostsFallbackFromIncidents = async (params = {}) => {
  const limitValue = Number(params?.limit || 300);
  const incidentLimit = Number.isFinite(limitValue) ? Math.max(limitValue * 4, 500) : 500;
  const response = await apiClient.get('/scan/incidents', {
    params: { limit: incidentLimit, offset: 0 },
  });
  const items = response?.data?.items;
  return aggregateHostsFromIncidents(items);
};

export const scanHostsAPI = {
  getHosts: async (params = {}) => {
    if (scanHostsEndpointUnavailable) {
      return getHostsFallbackFromIncidents(params);
    }
    try {
      const response = await apiClient.get('/scan/hosts', { params });
      return response.data;
    } catch (error) {
      const statusCode = Number(error?.response?.status || 0);
      if (statusCode !== 404) {
        throw error;
      }
      markScanHostsUnavailable(true);
      return getHostsFallbackFromIncidents(params);
    }
  },
};

export default scanHostsAPI;
