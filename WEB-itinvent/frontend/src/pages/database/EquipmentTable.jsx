import { memo, useCallback, useMemo, useState } from 'react';
import {
  Checkbox,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { ActionMenu, StatusChip } from '../../components/common';
import EmployeeNameLink from './EmployeeNameLink';
import {
  DATA_MODE_CONSUMABLES,
  DATA_MODE_EQUIPMENT,
  getEquipmentRowActions,
  toInvNo,
} from './equipmentModel';
import { readQty } from './databaseRecordModel';
import { toItemId } from './detailModel';

const textCollator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
const TABLE_VIRTUALIZE_THRESHOLD = 120;
const TABLE_MAX_HEIGHT = 520;
const TABLE_WIDTHS = {
  consumables: { inv: 140, type: 140, model: 200, qty: 120, actions: 96 },
  equipment: { select: 56, inv: 120, serial: 110, partNo: 130, type: 120, model: 170, employee: 220, status: 110, actions: 56 },
  equipmentMobile: { inv: 130, employee: 210, status: 110, actions: 56 },
};

const EquipmentRow = memo(function EquipmentRow({
  item,
  isSelected,
  isMobile,
  theme,
  onSelect,
  onAction,
  onOpenEmployee = null,
  onEditConsumableQty = null,
  onDeleteConsumable = null,
  allowSelection = true,
  dataMode = DATA_MODE_EQUIPMENT,
  canWrite = true,
  canDelete = false,
  isAdmin = false,
}) {
  const invNo = String(item.INV_NO || item.inv_no || '');
  const itemId = toItemId(item);
  const isConsumablesMode = dataMode === DATA_MODE_CONSUMABLES;
  const employeeName = String(item.OWNER_DISPLAY_NAME || item.employee_name || '-');
  const employeeOwnerNo = item.EMPL_NO ?? item.empl_no ?? item.OWNER_NO ?? item.owner_no ?? null;
  const employeeDept = String(item.OWNER_DEPT || item.employee_dept || '').trim();
  const modelName = String(item.MODEL_NAME || item.model_name || '-');
  const typeName = String(item.TYPE_NAME || item.type_name || '-');
  const qtyValue = readQty(item, 1);

  const actions = useMemo(
    () => getEquipmentRowActions({ item, dataMode, canWrite, isAdmin }),
    [item, dataMode, canWrite, isAdmin]
  );

  if (isConsumablesMode) {
    return (
      <TableRow
        hover
        sx={{
          '& .MuiTableCell-root': {
            borderBottom: '1px solid ' + theme.palette.divider,
            py: isMobile ? 0.7 : 0.9,
            px: isMobile ? 1 : 1.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        }}
      >
        <TableCell sx={{ width: TABLE_WIDTHS.consumables.inv }}>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }} noWrap>
            {invNo || '-'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.1 }} noWrap>
            ID: {itemId || '-'}
          </Typography>
        </TableCell>
        <TableCell sx={{ width: TABLE_WIDTHS.consumables.type }}>
          <Typography variant="body2" sx={{ lineHeight: 1.2 }} noWrap>
            {typeName || '-'}
          </Typography>
        </TableCell>
        <TableCell sx={{ width: TABLE_WIDTHS.consumables.model }}>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }} noWrap>
            {modelName || '-'}
          </Typography>
        </TableCell>
        <TableCell sx={{ width: TABLE_WIDTHS.consumables.qty }} align="right">
          <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
            {qtyValue.toLocaleString('ru-RU')}
          </Typography>
        </TableCell>
        <TableCell padding="checkbox" sx={{ width: TABLE_WIDTHS.consumables.actions, minWidth: TABLE_WIDTHS.consumables.actions }} align="right">
          {onEditConsumableQty ? (
            <IconButton
              size="small"
              aria-label="Изменить количество"
              onClick={() => onEditConsumableQty(item)}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          ) : null}
          {canDelete && onDeleteConsumable ? (
            <IconButton
              size="small"
              color="error"
              aria-label={`Удалить расходник ${invNo || ''}`.trim()}
              onClick={() => onDeleteConsumable(item)}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          ) : null}
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow
      hover
      sx={{
        '& .MuiTableCell-root': {
          borderBottom: '1px solid ' + theme.palette.divider,
          py: isMobile ? 0.6 : 0.8,
          px: isMobile ? 0.8 : 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
      }}
    >
      {!isMobile && allowSelection && (
        <TableCell padding="checkbox" sx={{ width: TABLE_WIDTHS.equipment.select }}>
          <Checkbox
            checked={isSelected}
            onChange={() => onSelect(invNo)}
            onClick={(e) => e.stopPropagation()}
            size="small"
          />
        </TableCell>
      )}
      <TableCell sx={{ width: isMobile ? TABLE_WIDTHS.equipmentMobile.inv : TABLE_WIDTHS.equipment.inv }}>
        <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }} noWrap>
          {invNo || '-'}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.1 }} noWrap>
          ID: {itemId || '-'}
        </Typography>
      </TableCell>
      {!isMobile && (
        <TableCell sx={{ width: TABLE_WIDTHS.equipment.serial }}>
          <Typography variant="body2" noWrap>
            {String(item.SERIAL_NO || item.serial_no || item.HW_SERIAL_NO || item.hw_serial_no || '-')}
          </Typography>
        </TableCell>
      )}
      {!isMobile && (
        <TableCell sx={{ width: TABLE_WIDTHS.equipment.partNo }}>
          <Typography variant="body2" noWrap>
            {String(item.PART_NO || item.part_no || '-')}
          </Typography>
        </TableCell>
      )}
      {!isMobile && (
        <TableCell sx={{ width: TABLE_WIDTHS.equipment.type }}>
          <Typography variant="body2" noWrap>
            {String(item.TYPE_NAME || item.type_name || '-')}
          </Typography>
        </TableCell>
      )}
      {!isMobile && (
        <TableCell sx={{ width: TABLE_WIDTHS.equipment.model }}>
          <Typography variant="body2" noWrap>
            {String(item.MODEL_NAME || item.model_name || '-')}
          </Typography>
        </TableCell>
      )}
      <TableCell sx={{ width: isMobile ? TABLE_WIDTHS.equipmentMobile.employee : TABLE_WIDTHS.equipment.employee }}>
        <EmployeeNameLink
          name={employeeName}
          ownerNo={employeeOwnerNo}
          onOpenEmployee={onOpenEmployee}
          variant="body2"
          noWrap
          sx={{ lineHeight: 1.2, display: 'block' }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.1 }} noWrap>
          {`Отдел: ${employeeDept || '-'}`}
        </Typography>
      </TableCell>
      <TableCell sx={{ width: isMobile ? TABLE_WIDTHS.equipmentMobile.status : TABLE_WIDTHS.equipment.status }}>
        <StatusChip
          status={item.DESCR || item.status_name || item.status}
          size="small"
        />
      </TableCell>
      <TableCell padding="checkbox" sx={{ width: isMobile ? TABLE_WIDTHS.equipmentMobile.actions : TABLE_WIDTHS.equipment.actions, minWidth: isMobile ? TABLE_WIDTHS.equipmentMobile.actions : TABLE_WIDTHS.equipment.actions }} align="right">
        <ActionMenu
          onAction={onAction}
          actions={actions}
          item={item}
          label={'Actions for ' + invNo}
        />
      </TableCell>
    </TableRow>
  );
});

const EquipmentTable = memo(function EquipmentTable({
  items,
  isMobile,
  theme,
  selectedItemsSet,
  tableSort,
  onTableSort,
  onSelectAll,
  isAllSelected,
  isSomeSelected,
  onSelect,
  onAction,
  onOpenEmployee = null,
  onEditConsumableQty = null,
  onDeleteConsumable = null,
  allowSelection = true,
  dataMode = DATA_MODE_EQUIPMENT,
  canWrite = true,
  canDelete = false,
  isAdmin = false,
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const isConsumablesMode = dataMode === DATA_MODE_CONSUMABLES;

  const getSortValue = useCallback((item, field) => {
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
  }, []);

  const sortedItems = useMemo(() => {
    const applySortDirection = (cmp) => (tableSort.direction === 'asc' ? cmp : -cmp);
    return [...(items || [])].sort((a, b) => {
      if (tableSort.field === 'qty') {
        const qtyCmp = getSortValue(a, 'qty') - getSortValue(b, 'qty');
        if (qtyCmp !== 0) {
          return applySortDirection(qtyCmp);
        }
      }

      const primaryCmp = textCollator.compare(
        String(getSortValue(a, tableSort.field)),
        String(getSortValue(b, tableSort.field))
      );
      if (primaryCmp !== 0) {
        return applySortDirection(primaryCmp);
      }

      const invCmp = textCollator.compare(toInvNo(a), toInvNo(b));
      if (invCmp !== 0) {
        return applySortDirection(invCmp);
      }

      return applySortDirection(textCollator.compare(toItemId(a), toItemId(b)));
    });
  }, [items, tableSort, getSortValue]);

  const useVirtualization = sortedItems.length >= TABLE_VIRTUALIZE_THRESHOLD;
  const rowHeight = isMobile ? 44 : 52;
  const viewportHeight = useVirtualization
    ? Math.min(TABLE_MAX_HEIGHT, Math.max(rowHeight * 6, rowHeight * Math.min(14, sortedItems.length)))
    : undefined;
  const overscanRows = 8;

  const startIndex = useVirtualization
    ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows)
    : 0;
  const endIndex = useVirtualization
    ? Math.min(
      sortedItems.length,
      Math.ceil((scrollTop + Number(viewportHeight || 0)) / rowHeight) + overscanRows
    )
    : sortedItems.length;

  const visibleItems = useVirtualization ? sortedItems.slice(startIndex, endIndex) : sortedItems;
  const topSpacerHeight = useVirtualization ? startIndex * rowHeight : 0;
  const bottomSpacerHeight = useVirtualization ? Math.max(0, (sortedItems.length - endIndex) * rowHeight) : 0;
  const colSpan = isConsumablesMode ? 5 : (isMobile ? 4 : (allowSelection ? 8 : 7));
  const tableMinWidth = isConsumablesMode
    ? (TABLE_WIDTHS.consumables.inv
      + TABLE_WIDTHS.consumables.type
      + TABLE_WIDTHS.consumables.model
      + TABLE_WIDTHS.consumables.qty
      + TABLE_WIDTHS.consumables.actions)
    : isMobile
      ? (TABLE_WIDTHS.equipmentMobile.inv
        + TABLE_WIDTHS.equipmentMobile.employee
        + TABLE_WIDTHS.equipmentMobile.status
        + TABLE_WIDTHS.equipmentMobile.actions)
      : ((allowSelection ? TABLE_WIDTHS.equipment.select : 0)
        + TABLE_WIDTHS.equipment.inv
        + TABLE_WIDTHS.equipment.serial
        + TABLE_WIDTHS.equipment.partNo
        + TABLE_WIDTHS.equipment.type
        + TABLE_WIDTHS.equipment.model
        + TABLE_WIDTHS.equipment.employee
        + TABLE_WIDTHS.equipment.status
        + TABLE_WIDTHS.equipment.actions);

  const handleContainerScroll = useCallback((event) => {
    if (!useVirtualization) return;
    setScrollTop(event.currentTarget.scrollTop);
  }, [useVirtualization]);

  return (
    <TableContainer
      component={Paper}
      variant="outlined"
      onScroll={handleContainerScroll}
      sx={{
        borderRadius: 2,
        boxShadow: 'none',
        maxHeight: viewportHeight,
        overflowY: viewportHeight ? 'auto' : 'visible',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollbarGutter: 'stable',
      }}
    >
      <Table
        size={isMobile ? 'small' : 'medium'}
        sx={{ minWidth: tableMinWidth, width: '100%', tableLayout: 'fixed' }}
      >
        <TableHead>
          <TableRow>
            {isConsumablesMode ? (
              <>
                <TableCell sx={{ width: TABLE_WIDTHS.consumables.inv }}>
                  <TableSortLabel
                    active={tableSort.field === 'inv'}
                    direction={tableSort.field === 'inv' ? tableSort.direction : 'asc'}
                    onClick={() => onTableSort('inv')}
                  >
                    Инв. №
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ width: TABLE_WIDTHS.consumables.type }}>
                  <TableSortLabel
                    active={tableSort.field === 'type'}
                    direction={tableSort.field === 'type' ? tableSort.direction : 'asc'}
                    onClick={() => onTableSort('type')}
                  >
                    Тип
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ width: TABLE_WIDTHS.consumables.model }}>
                  <TableSortLabel
                    active={tableSort.field === 'model'}
                    direction={tableSort.field === 'model' ? tableSort.direction : 'asc'}
                    onClick={() => onTableSort('model')}
                  >
                    Модель
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ width: TABLE_WIDTHS.consumables.qty }} align="right">
                  <TableSortLabel
                    active={tableSort.field === 'qty'}
                    direction={tableSort.field === 'qty' ? tableSort.direction : 'asc'}
                    onClick={() => onTableSort('qty')}
                  >
                    Количество
                  </TableSortLabel>
                </TableCell>
                <TableCell padding="checkbox" sx={{ width: TABLE_WIDTHS.consumables.actions, minWidth: TABLE_WIDTHS.consumables.actions }} />
              </>
            ) : (
              <>
                {!isMobile && allowSelection && (
                  <TableCell padding="checkbox" sx={{ width: TABLE_WIDTHS.equipment.select }}>
                    <Checkbox
                      size="small"
                      checked={isAllSelected(sortedItems)}
                      indeterminate={isSomeSelected(sortedItems) && !isAllSelected(sortedItems)}
                      onChange={(event) => onSelectAll(sortedItems, event)}
                    />
                  </TableCell>
                )}
                <TableCell sx={{ width: isMobile ? TABLE_WIDTHS.equipmentMobile.inv : TABLE_WIDTHS.equipment.inv }}>
                  <TableSortLabel
                    active={tableSort.field === 'inv'}
                    direction={tableSort.field === 'inv' ? tableSort.direction : 'asc'}
                    onClick={() => onTableSort('inv')}
                  >
                    Инв. №
                  </TableSortLabel>
                </TableCell>
                {!isMobile && (
                  <TableCell sx={{ width: TABLE_WIDTHS.equipment.serial }}>
                    <TableSortLabel
                      active={tableSort.field === 'serial'}
                      direction={tableSort.field === 'serial' ? tableSort.direction : 'asc'}
                      onClick={() => onTableSort('serial')}
                    >
                      Серийный
                    </TableSortLabel>
                  </TableCell>
                )}
                {!isMobile && (
                  <TableCell sx={{ width: TABLE_WIDTHS.equipment.partNo }}>
                    <TableSortLabel
                      active={tableSort.field === 'partNo'}
                      direction={tableSort.field === 'partNo' ? tableSort.direction : 'asc'}
                      onClick={() => onTableSort('partNo')}
                    >
                      Part Number
                    </TableSortLabel>
                  </TableCell>
                )}
                {!isMobile && (
                  <TableCell sx={{ width: TABLE_WIDTHS.equipment.type }}>
                    <TableSortLabel
                      active={tableSort.field === 'type'}
                      direction={tableSort.field === 'type' ? tableSort.direction : 'asc'}
                      onClick={() => onTableSort('type')}
                    >
                      Тип
                    </TableSortLabel>
                  </TableCell>
                )}
                {!isMobile && (
                  <TableCell sx={{ width: TABLE_WIDTHS.equipment.model }}>
                    <TableSortLabel
                      active={tableSort.field === 'model'}
                      direction={tableSort.field === 'model' ? tableSort.direction : 'asc'}
                      onClick={() => onTableSort('model')}
                    >
                      Модель
                    </TableSortLabel>
                  </TableCell>
                )}
                <TableCell sx={{ width: isMobile ? TABLE_WIDTHS.equipmentMobile.employee : TABLE_WIDTHS.equipment.employee }}>
                  <TableSortLabel
                    active={tableSort.field === 'employee'}
                    direction={tableSort.field === 'employee' ? tableSort.direction : 'asc'}
                    onClick={() => onTableSort('employee')}
                  >
                    Сотрудник
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ width: isMobile ? TABLE_WIDTHS.equipmentMobile.status : TABLE_WIDTHS.equipment.status }}>
                  <TableSortLabel
                    active={tableSort.field === 'status'}
                    direction={tableSort.field === 'status' ? tableSort.direction : 'asc'}
                    onClick={() => onTableSort('status')}
                  >
                    Статус
                  </TableSortLabel>
                </TableCell>
                <TableCell padding="checkbox" sx={{ width: isMobile ? TABLE_WIDTHS.equipmentMobile.actions : TABLE_WIDTHS.equipment.actions, minWidth: isMobile ? TABLE_WIDTHS.equipmentMobile.actions : TABLE_WIDTHS.equipment.actions }} />
              </>
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {topSpacerHeight > 0 && (
            <TableRow>
              <TableCell colSpan={colSpan} sx={{ p: 0, borderBottom: 'none', height: topSpacerHeight }} />
            </TableRow>
          )}

          {visibleItems.map((item, idx) => {
            const invNo = toInvNo(item);
            const isSelected = selectedItemsSet.has(invNo);
            return (
              <EquipmentRow
                key={invNo + '-' + idx}
                item={item}
                isSelected={isSelected}
                isMobile={isMobile}
                theme={theme}
                onSelect={onSelect}
                onAction={onAction}
                onOpenEmployee={onOpenEmployee}
                onEditConsumableQty={onEditConsumableQty}
                onDeleteConsumable={onDeleteConsumable}
                allowSelection={allowSelection}
                dataMode={dataMode}
                canWrite={canWrite}
                canDelete={canDelete}
                isAdmin={isAdmin}
              />
            );
          })}

          {bottomSpacerHeight > 0 && (
            <TableRow>
              <TableCell colSpan={colSpan} sx={{ p: 0, borderBottom: 'none', height: bottomSpacerHeight }} />
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
});

export default EquipmentTable;
