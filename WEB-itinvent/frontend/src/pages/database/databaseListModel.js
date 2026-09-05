import { getItemCapabilityFlags, toInvNo } from './equipmentModel';
import { normalizeText, readQty } from './databaseRecordModel';
import { toItemId } from './detailModel';

export const DEFAULT_ACTION_BATCH_SIZE = 10;

const textCollator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

const getEquipmentSortValue = (item, field) => {
  switch (field) {
    case 'id':
      return toItemId(item);
    case 'inv':
      return toInvNo(item);
    case 'serial':
      return String(item?.SERIAL_NO || item?.serial_no || item?.HW_SERIAL_NO || item?.hw_serial_no || '').trim();
    case 'partNo':
      return String(item?.PART_NO || item?.part_no || '').trim();
    case 'type':
      return String(item?.TYPE_NAME || item?.type_name || '').trim();
    case 'model':
      return String(item?.MODEL_NAME || item?.model_name || '').trim();
    case 'qty':
      return readQty(item, 1);
    case 'employee':
      return String(item?.OWNER_DISPLAY_NAME || item?.employee_name || '').trim();
    case 'status':
      return String(item?.DESCR || item?.status_name || item?.status || '').trim();
    default:
      return '';
  }
};

export const sortEquipmentItems = (items, tableSort = {}) => {
  const field = String(tableSort?.field || 'employee');
  const direction = tableSort?.direction === 'desc' ? 'desc' : 'asc';
  const applySortDirection = (comparison) => (direction === 'asc' ? comparison : -comparison);

  return [...(items || [])].sort((a, b) => {
    if (field === 'qty') {
      const qtyComparison = getEquipmentSortValue(a, 'qty') - getEquipmentSortValue(b, 'qty');
      if (qtyComparison !== 0) return applySortDirection(qtyComparison);
    }

    const primaryComparison = textCollator.compare(
      String(getEquipmentSortValue(a, field)),
      String(getEquipmentSortValue(b, field))
    );
    if (primaryComparison !== 0) return applySortDirection(primaryComparison);

    const inventoryComparison = textCollator.compare(toInvNo(a), toInvNo(b));
    if (inventoryComparison !== 0) return applySortDirection(inventoryComparison);

    return applySortDirection(textCollator.compare(toItemId(a), toItemId(b)));
  });
};

export const resolveSelectedEquipmentPrintOrder = (
  groupedData,
  selectedItems,
  tableSort = {}
) => {
  const requestedInvNos = Array.from(new Set(
    (selectedItems || []).map((value) => toInvNo(value)).filter(Boolean)
  ));
  const pendingInvNos = new Set(requestedInvNos);
  const items = [];

  Object.keys(groupedData || {}).forEach((branchName) => {
    const locations = groupedData?.[branchName] || {};
    Object.keys(locations)
      .sort((a, b) => textCollator.compare(String(a || ''), String(b || '')))
      .forEach((locationName) => {
        sortEquipmentItems(locations[locationName], tableSort).forEach((item) => {
          const invNo = toInvNo(item);
          if (!pendingInvNos.has(invNo)) return;
          pendingInvNos.delete(invNo);
          items.push(item);
        });
      });
  });

  return {
    items,
    skippedInvNos: requestedInvNos.filter((invNo) => pendingInvNos.has(invNo)),
  };
};

export const countGroupedItems = (groupedData) =>
  Object.values(groupedData || {}).reduce(
    (branchSum, locations) =>
      branchSum + Object.values(locations || {}).reduce((locSum, items) => locSum + (items?.length || 0), 0),
    0
  );

export const groupSearchResults = (entries) => {
  const grouped = {};
  entries.forEach(({ branchName, locationName, item }) => {
    if (!grouped[branchName]) grouped[branchName] = {};
    if (!grouped[branchName][locationName]) grouped[branchName][locationName] = [];
    grouped[branchName][locationName].push(item);
  });
  return grouped;
};

export const filterGroupedByBranch = (groupedData, selectedBranch) => {
  const normalizedSelectedBranch = normalizeText(selectedBranch);
  if (!normalizedSelectedBranch) return groupedData || {};

  const filtered = {};
  Object.entries(groupedData || {}).forEach(([branchName, locations]) => {
    if (normalizeText(branchName) === normalizedSelectedBranch) {
      filtered[branchName] = locations;
    }
  });
  return filtered;
};

export const buildEquipmentIndex = (groupedData) => {
  const index = new Map();
  Object.values(groupedData || {}).forEach((locations) => {
    Object.values(locations || {}).forEach((items) => {
      (items || []).forEach((item) => {
        const invNo = toInvNo(item);
        if (invNo) {
          index.set(invNo, item);
        }
      });
    });
  });
  return index;
};

export const getVisibleBranchNames = (displayData) => Object.keys(displayData || {});

export const buildLocationKey = (branchName, locationName) => `${branchName}::${locationName}`;

export const getVisibleLocationKeys = (displayData, branchNames = getVisibleBranchNames(displayData)) => {
  const keys = [];
  (branchNames || []).forEach((branchName) => {
    const locations = displayData?.[branchName] || {};
    Object.keys(locations).forEach((locationName) => {
      keys.push(buildLocationKey(branchName, locationName));
    });
  });
  return keys;
};

export const hasExpandedVisible = ({
  branchNames = [],
  locationKeys = [],
  expandedBranches = new Set(),
  expandedLocations = new Set(),
} = {}) => {
  const hasExpandedBranch = (branchNames || []).some((branchName) => expandedBranches.has(branchName));
  if (hasExpandedBranch) return true;
  return (locationKeys || []).some((locationKey) => expandedLocations.has(locationKey));
};

export const buildDatabaseSearchIndex = (groupedData) => {
  const entries = [];

  Object.entries(groupedData || {}).forEach(([branchName, locations]) => {
    Object.entries(locations || {}).forEach(([locationName, items]) => {
      (items || []).forEach((item) => {
        const ipAddress = String(item.IP_ADDRESS || item.ip_address || '').trim();
        const macAddress = String(item.MAC_ADDRESS || item.mac_address || item.MAC_ADDR || item.mac_addr || '').trim();
        const computerName = String(
          item.NETBIOS_NAME || item.netbios_name || item.NETWORK_NAME || item.network_name || ''
        ).trim();
        const domainName = String(item.DOMAIN_NAME || item.domain_name || '').trim();
        const macCompact = macAddress.replace(/[^A-Za-z0-9]/g, '');

        const searchable = [
          item.ID || item.id || '',
          item.INV_NO || item.inv_no || '',
          item.SERIAL_NO || item.serial_no || '',
          item.HW_SERIAL_NO || item.hw_serial_no || '',
          item.PART_NO || item.part_no || '',
          item.MODEL_NAME || item.model_name || '',
          item.TYPE_NAME || item.type_name || '',
          item.OWNER_DISPLAY_NAME || item.employee_name || '',
          ipAddress,
          macAddress,
          macCompact,
          computerName,
          domainName,
        ]
          .join(' ')
          .toLowerCase();

        entries.push({ branchName, locationName, item, searchable });
      });
    });
  });

  return entries;
};

export const buildSearchResultState = (searchIndex, query) => {
  const normalizedQuery = String(query || '').trim().toLowerCase();

  if (normalizedQuery.length < 2) {
    return { filteredData: null, expandedBranches: null, expandedLocations: null };
  }

  const matchedEntries = (searchIndex || []).filter((entry) =>
    String(entry?.searchable || '').includes(normalizedQuery)
  );

  if (matchedEntries.length === 0) {
    return { filteredData: {}, expandedBranches: new Set(), expandedLocations: new Set() };
  }

  const filteredData = groupSearchResults(matchedEntries);
  const expandedBranches = new Set();
  const expandedLocations = new Set();

  Object.keys(filteredData).forEach((branchName) => {
    expandedBranches.add(branchName);
    Object.keys(filteredData[branchName] || {}).forEach((locationName) => {
      expandedLocations.add(buildLocationKey(branchName, locationName));
    });
  });

  return { filteredData, expandedBranches, expandedLocations };
};

export const normalizeActionTargets = (selectedItems, fallbackInvNo) =>
  (selectedItems.length > 0 ? selectedItems : [fallbackInvNo])
    .map((invNo) => String(invNo || '').trim())
    .filter(Boolean);

export const buildVisibleInvNoSet = (displayData) => {
  const ids = new Set();
  Object.values(displayData || {}).forEach((locations) => {
    Object.values(locations || {}).forEach((items) => {
      (items || []).forEach((item) => {
        const invNo = toInvNo(item);
        if (invNo) ids.add(invNo);
      });
    });
  });
  return ids;
};

export const countSelectedVisible = (selectedItems, visibleInvNoSet) =>
  (selectedItems || []).reduce((acc, id) => (visibleInvNoSet?.has(toInvNo(id)) ? acc + 1 : acc), 0);

const getEmptySelectedItemsCapabilities = () => ({
  canCartridge: false,
  canBattery: false,
  canComponent: false,
  componentKind: null,
  canCleaning: false,
});

export const getSelectedItemsCapabilities = (selectedItems, findEquipmentByInvNo) => {
  if (!selectedItems?.length || typeof findEquipmentByInvNo !== 'function') {
    return getEmptySelectedItemsCapabilities();
  }

  const items = selectedItems
    .map((invNo) => findEquipmentByInvNo(invNo))
    .filter(Boolean);

  const hasFullResolvedSet = items.length === selectedItems.length;
  const allMatch = (predicate) => hasFullResolvedSet && items.every(predicate);

  const printerOnly = allMatch((item) => getItemCapabilityFlags(item).isPrinterOrMfu);
  const pcOnly = allMatch((item) => getItemCapabilityFlags(item).isPc);

  return {
    canCartridge: printerOnly,
    canBattery: allMatch((item) => getItemCapabilityFlags(item).isUps),
    canComponent: printerOnly || pcOnly,
    componentKind: printerOnly ? 'printer' : (pcOnly ? 'pc' : null),
    canCleaning: pcOnly,
  };
};

export const mergeGroupedEquipment = (baseGrouped, nextGrouped) => {
  const merged = {};
  const sourceGroups = [baseGrouped || {}, nextGrouped || {}];

  sourceGroups.forEach((grouped) => {
    Object.entries(grouped).forEach(([branchName, locations]) => {
      if (!merged[branchName]) {
        merged[branchName] = {};
      }
      Object.entries(locations || {}).forEach(([locationName, items]) => {
        const currentItems = merged[branchName][locationName] || [];
        const existingInvNos = new Set(currentItems.map((item) => toInvNo(item)).filter(Boolean));
        const appended = [];
        (items || []).forEach((item) => {
          const invNo = toInvNo(item);
          if (!invNo || !existingInvNos.has(invNo)) {
            appended.push(item);
            if (invNo) {
              existingInvNos.add(invNo);
            }
          }
        });
        merged[branchName][locationName] = [...currentItems, ...appended];
      });
    });
  });

  return merged;
};

export async function runInBatches(items, worker, batchSize = DEFAULT_ACTION_BATCH_SIZE) {
  const settled = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const chunkResults = await Promise.allSettled(chunk.map(worker));
    settled.push(...chunkResults);
  }
  return settled;
}
