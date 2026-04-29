const EMPTY_TEXT = '-';

export const normalizeScanHost = (value) => String(value || '').trim().toUpperCase();

export const normalizeIncidentStatus = (value) => String(value || '').trim().toLowerCase();

export function inferIncidentFileExt(value) {
  const text = String(value || '').trim().replace(/\\/g, '/');
  if (!text) return '';
  const name = text.split('/').pop() || '';
  const idx = name.lastIndexOf('.');
  if (idx < 0 || idx === name.length - 1) return '';
  return name.slice(idx + 1).toLowerCase();
}

export function getIncidentFileExt(incident) {
  return String(
    incident?.file_ext
    || inferIncidentFileExt(incident?.file_name)
    || inferIncidentFileExt(incident?.file_path)
    || ''
  ).trim().toLowerCase();
}

export function getIncidentSourceKind(incident) {
  const source = String(incident?.source_kind || '').trim().toLowerCase();
  if (source) return source;
  const ext = getIncidentFileExt(incident);
  if (ext === 'pdf') return 'pdf';
  if (['txt', 'rtf', 'csv', 'json', 'xml', 'ini', 'conf', 'md', 'log'].includes(ext)) return 'text';
  return ext ? 'metadata' : '';
}

export function getIncidentFileKey(incident, fallback = '') {
  const path = String(incident?.file_path || '').trim();
  if (path) return path.toLowerCase();
  const fileName = String(incident?.file_name || '').trim();
  if (fileName) return fileName.toLowerCase();
  return String(incident?.id || fallback || 'unknown').trim();
}

function severityRank(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'high') return 3;
  if (normalized === 'medium') return 2;
  if (normalized === 'low') return 1;
  return 0;
}

function severityLabel(rank) {
  if (rank >= 3) return 'high';
  if (rank === 2) return 'medium';
  if (rank === 1) return 'low';
  return 'none';
}

function topFragments(incidents) {
  const fragments = [];
  incidents.forEach((incident) => {
    (Array.isArray(incident?.matched_patterns) ? incident.matched_patterns : []).forEach((match) => {
      const snippet = String(match?.snippet || match?.value || match?.pattern_name || match?.pattern || '').trim();
      if (snippet) fragments.push({ ...match, snippet });
    });
  });
  return fragments.slice(0, 5);
}

export function groupIncidentsByHostFile(incidents) {
  const hostMap = new Map();
  (Array.isArray(incidents) ? incidents : []).forEach((incident, index) => {
    const host = normalizeScanHost(incident?.hostname) || 'UNKNOWN';
    if (!hostMap.has(host)) {
      hostMap.set(host, {
        id: `host:${host}`,
        hostname: host,
        branch: String(incident?.branch || '').trim(),
        user: String(incident?.user_full_name || incident?.user_login || '').trim(),
        ip_address: String(incident?.ip_address || '').trim(),
        incidents_total: 0,
        incidents_new: 0,
        top_severity_rank: 0,
        last_incident_at: 0,
        files: [],
        fileMap: new Map(),
      });
    }
    const hostEntry = hostMap.get(host);
    hostEntry.incidents_total += 1;
    if (normalizeIncidentStatus(incident?.status) === 'new') hostEntry.incidents_new += 1;
    if (!hostEntry.branch && incident?.branch) hostEntry.branch = String(incident.branch).trim();
    if (!hostEntry.user && (incident?.user_full_name || incident?.user_login)) {
      hostEntry.user = String(incident.user_full_name || incident.user_login).trim();
    }
    const createdAt = Number(incident?.created_at || 0);
    if (createdAt > hostEntry.last_incident_at) hostEntry.last_incident_at = createdAt;
    hostEntry.top_severity_rank = Math.max(hostEntry.top_severity_rank, severityRank(incident?.severity));

    const fileKey = getIncidentFileKey(incident, `incident-${index}`);
    if (!hostEntry.fileMap.has(fileKey)) {
      const filePath = String(incident?.file_path || incident?.file_name || EMPTY_TEXT).trim() || EMPTY_TEXT;
      const fileEntry = {
        id: `file:${host}:${fileKey}`,
        host,
        file_key: fileKey,
        file_path: filePath,
        file_name: String(incident?.file_name || '').trim(),
        file_ext: getIncidentFileExt(incident),
        source_kind: getIncidentSourceKind(incident),
        incidents_total: 0,
        incidents_new: 0,
        top_severity_rank: 0,
        last_incident_at: 0,
        incidents: [],
        fragments: [],
      };
      hostEntry.fileMap.set(fileKey, fileEntry);
      hostEntry.files.push(fileEntry);
    }
    const fileEntry = hostEntry.fileMap.get(fileKey);
    fileEntry.incidents_total += 1;
    if (normalizeIncidentStatus(incident?.status) === 'new') fileEntry.incidents_new += 1;
    fileEntry.top_severity_rank = Math.max(fileEntry.top_severity_rank, severityRank(incident?.severity));
    if (createdAt > fileEntry.last_incident_at) fileEntry.last_incident_at = createdAt;
    fileEntry.incidents.push(incident);
  });

  return Array.from(hostMap.values())
    .map((host) => {
      const files = host.files
        .map((file) => ({
          ...file,
          top_severity: severityLabel(file.top_severity_rank),
          fragments: topFragments(file.incidents),
          incidents: file.incidents.slice().sort((a, b) => Number(b?.created_at || 0) - Number(a?.created_at || 0)),
        }))
        .sort((a, b) => (
          Number(b.incidents_new || 0) - Number(a.incidents_new || 0)
          || Number(b.top_severity_rank || 0) - Number(a.top_severity_rank || 0)
          || Number(b.last_incident_at || 0) - Number(a.last_incident_at || 0)
          || String(a.file_path || '').localeCompare(String(b.file_path || ''), 'ru')
        ));
      return {
        ...host,
        top_severity: severityLabel(host.top_severity_rank),
        files,
        fileMap: undefined,
      };
    })
    .sort((a, b) => (
      Number(b.incidents_new || 0) - Number(a.incidents_new || 0)
      || Number(b.top_severity_rank || 0) - Number(a.top_severity_rank || 0)
      || Number(b.last_incident_at || 0) - Number(a.last_incident_at || 0)
      || String(a.hostname || '').localeCompare(String(b.hostname || ''), 'ru')
    ));
}

export function flattenIncidentGroups(groups, expandedState = {}) {
  const rows = [];
  (Array.isArray(groups) ? groups : []).forEach((host) => {
    const hostExpanded = expandedState[host.id] === true;
    rows.push({ id: host.id, type: 'host', host, depth: 0 });
    if (!hostExpanded) return;
    (Array.isArray(host.files) ? host.files : []).forEach((file) => {
      const fileExpanded = expandedState[file.id] === true;
      rows.push({ id: file.id, type: 'file', host, file, depth: 1 });
      if (!fileExpanded) return;
      (Array.isArray(file.incidents) ? file.incidents : []).forEach((incident) => {
        rows.push({ id: `incident:${incident?.id}`, type: 'incident', host, file, incident, depth: 2 });
      });
    });
  });
  return rows;
}
