import {
  formatSocketPort,
  pointSortComparator,
  socketKey,
} from '../../lib/networksHelpers';

export const makePortDraft = (port) => ({
  port_name: String(port?.port_name || ''),
  patch_panel_port: String(port?.patch_panel_port || ''),
  location_code: String(port?.location_code || ''),
  vlan_raw: String(port?.vlan_raw || ''),
  endpoint_name_raw: String(port?.endpoint_name_raw || ''),
  endpoint_ip_raw: String(port?.endpoint_ip_raw || ''),
  endpoint_mac_raw: String(port?.endpoint_mac_raw || ''),
});

export const isBranchWidePortSearch = (portSearch) => String(portSearch || '').trim().length > 0;

export const sortPortsByName = (portList) => [...(portList || [])].sort((a, b) => {
  const nameA = String(a?.port_name || '');
  const nameB = String(b?.port_name || '');
  // Extract numeric part for comparison
  const numA = parseInt(nameA.replace(/\D/g, '')) || 0;
  const numB = parseInt(nameB.replace(/\D/g, '')) || 0;
  if (numA !== numB) {
    return numA - numB;
  }
  // If numbers are equal, sort lexicographically
  return nameA.localeCompare(nameB, undefined, { numeric: true });
});

// When searching across the whole branch, use branchPortResults.
// When a specific device is selected, use its ports.
// When "All devices" is selected (selectedDeviceId === null), use allBranchPorts.
export const resolveDisplayedPorts = ({
  branchWideSearch,
  branchPortResults,
  selectedDeviceId,
  ports,
  allBranchPorts,
}) => sortPortsByName(
  branchWideSearch
    ? branchPortResults
    : selectedDeviceId
      ? ports
      : allBranchPorts
);

export const findEditingPort = (displayedPorts, editingPortId) => (
  (displayedPorts || []).find((item) => Number(item.id) === Number(editingPortId)) || null
);

export const collectMatchedDeviceIds = (displayedPorts, branchWideSearch) => {
  const ids = new Set();
  if (!branchWideSearch) return ids;
  for (const port of displayedPorts || []) {
    const deviceId = Number(port?.device_id || 0);
    if (deviceId) ids.add(deviceId);
  }
  return ids;
};

export const countMatchedDevicePorts = (displayedPorts, branchWideSearch) => {
  const counter = new Map();
  if (!branchWideSearch) return counter;
  for (const port of displayedPorts || []) {
    const deviceId = Number(port?.device_id || 0);
    if (!deviceId) continue;
    counter.set(deviceId, (counter.get(deviceId) || 0) + 1);
  }
  return counter;
};

export const selectPointsForMap = (mapPoints, selectedMapId) => {
  if (!selectedMapId) return [];
  return (mapPoints || [])
    .filter((item) => Number(item.map_id) === Number(selectedMapId))
    .sort(pointSortComparator);
};

export const collectAvailableSites = (branches, branchIdNum, devices) => {
  const siteMap = new Map();
  // 1. Дефолтный сайт филиала (ищем в загруженных branches)
  if (branchIdNum && branches && branches.length > 0) {
    const currentBranch = branches.find((b) => Number(b.id) === Number(branchIdNum));
    if (currentBranch && currentBranch.default_site_code) {
      siteMap.set(currentBranch.default_site_code, currentBranch.name || currentBranch.default_site_code);
    }
  }
  // 2. Сайты устройств
  (devices || []).forEach((d) => {
    const code = String(d?.site_code || '').trim();
    if (code && !siteMap.has(code)) {
      siteMap.set(code, code);
    }
  });

  if (siteMap.size === 0) {
    siteMap.set('p19', 'Первомайская 19'); // fallback
  }
  return Array.from(siteMap.entries()).map(([code, name]) => ({ site_code: code, name }));
};

export const filterPointsForMap = (pointsForMap, mapPointSearch) => {
  const query = String(mapPointSearch || '').trim().toLowerCase();
  if (!query) return pointsForMap;
  return (pointsForMap || []).filter((point) => (
    [
      point.label,
      point.note,
      point.device_code,
      point.device_model,
      point.port_name,
      point.patch_panel_port,
      point.endpoint_name_raw,
      point.endpoint_ip_raw,
      point.endpoint_mac_raw,
      point.port_location_code,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query))
  ));
};

// All ports with patch_panel_port filled (for backward compatibility)
export const selectPortsWithSocket = (allBranchPorts) => (
  (allBranchPorts || [])
    .filter((port) => String(port.patch_panel_port || '').trim())
    .sort(pointSortComparator)
);

// Free sockets - sockets without port_id (not assigned to any port)
export const selectFreeSockets = (sockets) => (
  (sockets || [])
    .filter((socketItem) => !socketItem.port_id && String(socketItem.socket_code || '').trim())
    .sort((a, b) => {
      const aSocket = String(a?.socket_code || '');
      const bSocket = String(b?.socket_code || '');
      return aSocket.localeCompare(bSocket, 'ru', { numeric: true, sensitivity: 'base' });
    })
);

export const countDevicePorts = (allBranchPorts) => {
  const counter = new Map();
  for (const port of allBranchPorts || []) {
    const deviceId = Number(port?.device_id || 0);
    if (!deviceId) continue;
    counter.set(deviceId, (counter.get(deviceId) || 0) + 1);
  }
  return counter;
};

export const filterSockets = (sockets, socketSearch) => {
  const query = String(socketSearch || '').trim().toLowerCase();
  if (!query) return sockets;
  return (sockets || []).filter((socketItem) => (
    [
      socketItem.socket_code,
      socketItem.device_code,
      socketItem.port_name,
      socketItem.location_code,
      socketItem.vlan_raw,
      socketItem.endpoint_ip_raw,
      socketItem.endpoint_mac_raw,
      socketItem.mac_address,
      socketItem.fio,
      socketItem.fio_source_db,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query))
  ));
};

export const findPortOptionsBySocketInput = (allPortsWithSocket, socketInput) => {
  const normalized = socketKey(socketInput);
  if (!normalized) return [];
  return allPortsWithSocket.filter((port) => socketKey(port.patch_panel_port).includes(normalized));
};

export const findSocketOptionsByInput = (sockets, socketInput) => {
  const normalized = socketKey(socketInput);
  const source = Array.isArray(sockets) ? sockets : [];
  if (!normalized) return source.slice(0, 500);
  return source
    .filter((socketItem) => socketKey(socketItem.socket_code).includes(normalized))
    .slice(0, 500);
};

export const resolveOptionValue = (selectedId, options) => {
  const value = String(selectedId || '');
  if (!value) return '';
  return (options || []).some((entry) => String(entry.id) === value) ? value : '';
};

export const findExactSocketMatches = (allPortsWithSocket, socketInput) => {
  const normalized = socketKey(socketInput);
  if (!normalized) return [];
  return allPortsWithSocket.filter((port) => socketKey(port.patch_panel_port) === normalized);
};

export const resolvePortById = (portId, preferredOptions, fallbackOptions) => {
  const id = Number(portId || 0);
  if (!id) return null;
  return (preferredOptions || []).find((port) => Number(port.id) === id)
    || (fallbackOptions || []).find((port) => Number(port.id) === id)
    || null;
};

export const resolveSocketForPort = ({ effectiveSocketId, socketOptions, sockets, resolvedPort }) => {
  const findById = (id) => (
    (socketOptions || []).find((socketItem) => Number(socketItem.id) === Number(id))
    || (sockets || []).find((socketItem) => Number(socketItem.id) === Number(id))
    || null
  );
  if (effectiveSocketId) return findById(effectiveSocketId);
  const portSocketId = Number(resolvedPort?.socket_id || 0) || null;
  return portSocketId ? findById(portSocketId) : null;
};

export const resolvePendingLookupStatus = ({
  socketInput,
  resolvedPort,
  resolvedSocket,
  exactMatchesCount,
  portOptionsCount,
  socketOptionsCount,
}) => {
  const normalized = socketKey(socketInput);
  const resolvedBinding = resolvedPort || resolvedSocket || null;

  if (resolvedBinding) {
    if (normalized && exactMatchesCount === 1) {
      return {
        tone: 'success',
        text: `Порт выбран автоматически: ${formatSocketPort(resolvedBinding)}`,
      };
    }
    return {
      tone: 'info',
      text: `Привязка: ${formatSocketPort(resolvedBinding)}`,
    };
  }

  if (!normalized) {
    return {
      tone: 'default',
      text: 'Введите PORT P/P или откройте ручной выбор.',
    };
  }

  if (exactMatchesCount > 1) {
    return {
      tone: 'warning',
      text: `Найдено ${exactMatchesCount} портов, нужно уточнение.`,
    };
  }

  if (portOptionsCount > 0 || socketOptionsCount > 0) {
    return {
      tone: 'warning',
      text: 'Точного совпадения нет, нужно уточнение.',
    };
  }

  return {
    tone: 'error',
    text: 'Совпадений нет.',
  };
};

export const buildPendingManualMeta = ({
  socketInput,
  portOptionsCount,
  socketOptionsCount,
  socketsCount,
}) => {
  const shownSockets = socketInput ? socketOptionsCount : Math.min(socketsCount || 0, 500);
  if (portOptionsCount > 0) {
    return `${shownSockets} розеток · ${portOptionsCount} портов`;
  }
  if (shownSockets > 0) {
    return `${shownSockets} розеток`;
  }
  return 'Нет вариантов';
};

export const buildSelectedPointPortOptions = ({ allPortsWithSocket, selectedPoint, socketInput }) => {
  if (!selectedPoint) return [];
  const normalized = socketKey(socketInput);
  const currentId = Number(selectedPoint.port_id || 0);
  let options = normalized
    ? allPortsWithSocket.filter((port) => socketKey(port.patch_panel_port).includes(normalized))
    : [];

  const currentFallback = () => [{
    id: currentId,
    port_name: selectedPoint.port_name || '',
    patch_panel_port: selectedPoint.patch_panel_port || '',
    location_code: selectedPoint.port_location_code || '',
    endpoint_ip_raw: selectedPoint.endpoint_ip_raw || '',
    endpoint_mac_raw: selectedPoint.endpoint_mac_raw || '',
  }];

  if (!normalized && currentId) {
    const currentPort = allPortsWithSocket.find((port) => Number(port.id) === currentId);
    return currentPort ? [currentPort] : currentFallback();
  }

  if (currentId && !options.some((port) => Number(port.id) === currentId)) {
    options = [...currentFallback(), ...options];
  }
  return options;
};

export const resolveFocusPointId = ({
  selectedPointId,
  pointsForMap,
  filteredPointsForMap,
  mapPointSearch,
  selectedDeviceId,
  selectedMapId,
}) => {
  if (selectedPointId && (pointsForMap || []).some((item) => Number(item.id) === Number(selectedPointId))) {
    return selectedPointId;
  }
  if ((filteredPointsForMap || []).length > 0 && String(mapPointSearch || '').trim()) {
    return filteredPointsForMap[0].id;
  }
  if (!selectedDeviceId || !selectedMapId) return null;
  return (pointsForMap || []).find((item) => Number(item.device_id) === Number(selectedDeviceId))?.id || null;
};
