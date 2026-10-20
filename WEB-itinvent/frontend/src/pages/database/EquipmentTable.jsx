import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
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
  Tooltip,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import { StatusChip } from '../../components/common';
import { useRowActionMenu } from '../../components/common/RowActionMenu';
import EmployeeNameLink from './EmployeeNameLink';
import {
  DATA_MODE_CONSUMABLES,
  DATA_MODE_EQUIPMENT,
  getEquipmentRowActions,
  toInvNo,
} from './equipmentModel';
import { readQty } from './databaseRecordModel';
import { toItemId } from './detailModel';
import { sortEquipmentItems } from './databaseListModel';
import EquipmentCurrentActIndicator from './EquipmentCurrentActIndicator';
import EquipmentPhotoIndicator from './EquipmentPhotoIndicator';
import { EmployeeCompareBadge, useEmployeeCompare } from './employeeCompareContext';
import { getOneCMark, useOneCMarks } from './oneCMarksContext';

const TABLE_VIRTUALIZE_THRESHOLD = 40;
// Single-line rows: the virtualizer's spacer math relies on this exact height,
// so every row (equipment and consumables) is pinned to it.
const ROW_HEIGHT = 44;
const TABLE_MAX_HEIGHT = ROW_HEIGHT * 12 + 48;
const TABLE_WIDTHS = {
  consumables: { inv: 130, type: 140, model: 220, qty: 110, actions: 120 },
  // Двухстрочные ячейки: «серийный/парт-номер», «тип/модель», «сотрудник/отдел».
  equipment: { select: 40, inv: 84, serial: 120, typeModel: 170, employee: 210, compare: 52, act: 36, photo: 36, status: 90 },
  equipmentMobile: { inv: 110, employee: 200, compare: 56, act: 40, photo: 40, status: 100 },
};

const compactRowSx = (theme, isMobile) => ({
  height: ROW_HEIGHT,
  '& .MuiTableCell-root': {
    borderBottom: '1px solid ' + theme.palette.divider,
    py: 0,
    px: isMobile ? 0.8 : 1,
    height: ROW_HEIGHT,
    boxSizing: 'border-box',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // Ячейки с чекбоксом/кнопкой действий: контент шире её 40 px при px:1 —
  // overflow:hidden + ellipsis рисовал «…» рядом с чекбоксом.
  '& .MuiTableCell-paddingCheckbox': {
    px: 0,
    overflow: 'visible',
    textOverflow: 'clip',
    textAlign: 'center',
  },
});

const EquipmentRow = memo(function EquipmentRow({
  item,
  isSelected,
  isMobile,
  theme,
  onSelect,
  onAction,
  onRowClick = null,
  onRowKeyDown = null,
  onOpenEmployee = null,
  onOpenCurrentAct = null,
  openingCurrentActDocNo = '',
  onEditConsumableQty = null,
  onDeleteConsumable = null,
  onShowConsumableQr = null,
  allowSelection = true,
  dataMode = DATA_MODE_EQUIPMENT,
  canWrite = true,
  canDelete = false,
  canDeleteEquipment = false,
}) {
  const invNo = String(item.INV_NO || item.inv_no || '');
  const itemId = toItemId(item);
  const isConsumablesMode = dataMode === DATA_MODE_CONSUMABLES;
  const employeeName = String(item.OWNER_DISPLAY_NAME || item.employee_name || '-');
  const employeeOwnerNo = item.EMPL_NO ?? item.empl_no ?? item.OWNER_NO ?? item.owner_no ?? null;
  const compareSummary = useEmployeeCompare(employeeOwnerNo);
  const oneCMarks = useOneCMarks();
  const oneCMarked = Boolean(getOneCMark(oneCMarks, invNo));
  const canMarkOneC = Boolean(oneCMarks?.canMark);
  const employeeDept = String(item.OWNER_DEPT || item.employee_dept || '').trim();
  const modelName = String(item.MODEL_NAME || item.model_name || '-');
  const typeName = String(item.TYPE_NAME || item.type_name || '-');
  const qtyValue = readQty(item, 1);

  const actions = useMemo(
    () => getEquipmentRowActions({ item, dataMode, canWrite, canDeleteEquipment, canMarkOneC, oneCMarked }),
    [item, dataMode, canWrite, canDeleteEquipment, canMarkOneC, oneCMarked]
  );

  if (isConsumablesMode) {
    return (
      <TableRow hover sx={compactRowSx(theme, isMobile)}>
        <TableCell sx={{ width: TABLE_WIDTHS.consumables.inv }}>
          <Tooltip title={`ID: ${itemId || '-'}`} placement="top-start">
            <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }} noWrap>
              {invNo || '-'}
            </Typography>
          </Tooltip>
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
          {onShowConsumableQr ? (
            <IconButton
              size="small"
              aria-label={`QR-код расходника ${invNo || ''}`.trim()}
              onClick={() => onShowConsumableQr(item)}
            >
              <QrCode2Icon fontSize="small" />
            </IconButton>
          ) : null}
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
      tabIndex={0}
      aria-haspopup="menu"
      onClick={onRowClick ? (event) => onRowClick(event, item, actions) : undefined}
      onKeyDown={onRowKeyDown ? (event) => onRowKeyDown(event, item, actions) : undefined}
      sx={{
        ...compactRowSx(theme, isMobile),
        cursor: 'pointer',
        '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
      }}
    >
      {!isMobile && allowSelection && (
        <TableCell padding="checkbox" sx={{ width: TABLE_WIDTHS.equipment.select }}>
          <Checkbox
            checked={isSelected}
            onChange={() => onSelect(invNo)}
            onClick={(e) => e.stopPropagation()}
            size="small"
            sx={{ p: 0.5 }}
          />
        </TableCell>
      )}
      <TableCell sx={{ width: isMobile ? TABLE_WIDTHS.equipmentMobile.inv : TABLE_WIDTHS.equipment.inv }}>
        <Tooltip title={`ID: ${itemId || '-'}`} placement="top-start">
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }} noWrap>
            {invNo || '-'}
          </Typography>
        </Tooltip>
      </TableCell>
      {!isMobile && (
        <TableCell sx={{ width: TABLE_WIDTHS.equipment.serial }}>
          <Typography variant="body2" noWrap sx={{ lineHeight: 1.25 }}>
            {String(item.SERIAL_NO || item.serial_no || item.HW_SERIAL_NO || item.hw_serial_no || '-')}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', lineHeight: 1.25 }}>
            {String(item.PART_NO || item.part_no || '-')}
          </Typography>
        </TableCell>
      )}
      {!isMobile && (
        <TableCell sx={{ width: TABLE_WIDTHS.equipment.typeModel }}>
          <Typography variant="body2" noWrap title={modelName} sx={{ fontWeight: 600, lineHeight: 1.25 }}>
            {modelName}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', lineHeight: 1.25 }}>
            {typeName}
          </Typography>
        </TableCell>
      )}
      <TableCell sx={{ width: isMobile ? TABLE_WIDTHS.equipmentMobile.employee : TABLE_WIDTHS.equipment.employee }}>
        <Box title={employeeDept ? `Отдел: ${employeeDept}` : undefined} sx={{ minWidth: 0 }}>
          <EmployeeNameLink
            name={employeeName}
            ownerNo={employeeOwnerNo}
            onOpenEmployee={onOpenEmployee}
            variant="body2"
            noWrap
            sx={{ lineHeight: 1.25, display: 'block', maxWidth: '100%' }}
          />
          {employeeDept ? (
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              sx={{ display: 'block', lineHeight: 1.25 }}
            >
              {employeeDept}
            </Typography>
          ) : null}
        </Box>
      </TableCell>
      <TableCell
        align="center"
        sx={{ width: isMobile ? TABLE_WIDTHS.equipmentMobile.compare : TABLE_WIDTHS.equipment.compare }}
      >
        <EmployeeCompareBadge
          summary={compareSummary}
          partNo={item.PART_NO || item.part_no || ''}
          invNo={invNo}
        />
      </TableCell>
      <TableCell
        align="center"
        sx={{ width: isMobile ? TABLE_WIDTHS.equipmentMobile.act : TABLE_WIDTHS.equipment.act }}
      >
        <EquipmentCurrentActIndicator
          item={item}
          onOpenAct={onOpenCurrentAct}
          openingDocNo={openingCurrentActDocNo}
        />
      </TableCell>
      <TableCell
        align="center"
        sx={{ width: isMobile ? TABLE_WIDTHS.equipmentMobile.photo : TABLE_WIDTHS.equipment.photo }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <EquipmentPhotoIndicator
            item={item}
            onOpen={onAction ? () => onAction('photos', item) : null}
          />
        </Box>
      </TableCell>
      <TableCell sx={{ width: isMobile ? TABLE_WIDTHS.equipmentMobile.status : TABLE_WIDTHS.equipment.status }}>
        <StatusChip
          status={item.DESCR || item.status_name || item.status}
          size="small"
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
  onOpenCurrentAct = null,
  openingCurrentActDocNo = '',
  onEditConsumableQty = null,
  onDeleteConsumable = null,
  onShowConsumableQr = null,
  allowSelection = true,
  dataMode = DATA_MODE_EQUIPMENT,
  canWrite = true,
  canDelete = false,
  canDeleteEquipment = false,
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const pendingScrollTopRef = useRef(0);
  const scrollRafRef = useRef(0);
  const isConsumablesMode = dataMode === DATA_MODE_CONSUMABLES;
  const { openRowMenu, openRowMenuFromKeyboard, rowMenu } = useRowActionMenu(onAction);

  const sortedItems = useMemo(
    () => sortEquipmentItems(items, tableSort),
    [items, tableSort]
  );

  const useVirtualization = sortedItems.length >= TABLE_VIRTUALIZE_THRESHOLD;
  const rowHeight = ROW_HEIGHT;
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
  const colSpan = isConsumablesMode ? 5 : (isMobile ? 6 : (allowSelection ? 9 : 8));
  const tableMinWidth = isConsumablesMode
    ? (TABLE_WIDTHS.consumables.inv
      + TABLE_WIDTHS.consumables.type
      + TABLE_WIDTHS.consumables.model
      + TABLE_WIDTHS.consumables.qty
      + TABLE_WIDTHS.consumables.actions)
    : isMobile
      ? (TABLE_WIDTHS.equipmentMobile.inv
        + TABLE_WIDTHS.equipmentMobile.employee
        + TABLE_WIDTHS.equipmentMobile.compare
        + TABLE_WIDTHS.equipmentMobile.act
        + TABLE_WIDTHS.equipmentMobile.photo
        + TABLE_WIDTHS.equipmentMobile.status)
      : ((allowSelection ? TABLE_WIDTHS.equipment.select : 0)
        + TABLE_WIDTHS.equipment.inv
        + TABLE_WIDTHS.equipment.serial
        + TABLE_WIDTHS.equipment.typeModel
        + TABLE_WIDTHS.equipment.employee
        + TABLE_WIDTHS.equipment.compare
        + TABLE_WIDTHS.equipment.act
        + TABLE_WIDTHS.equipment.photo
        + TABLE_WIDTHS.equipment.status);

  // rAF-throttle: scroll events fire per tick, but the table only needs one
  // state update per frame — keeps virtualization from re-rendering per event.
  const handleContainerScroll = useCallback((event) => {
    if (!useVirtualization) return;
    pendingScrollTopRef.current = event.currentTarget.scrollTop;
    if (scrollRafRef.current) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      setScrollTop(pendingScrollTopRef.current);
    });
  }, [useVirtualization]);

  useEffect(() => () => {
    if (scrollRafRef.current) window.cancelAnimationFrame(scrollRafRef.current);
  }, []);

  return (
    <>
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
        size="small"
        // Шапка остаётся видимой при прокрутке виртуализированного списка (≥40 строк).
        stickyHeader
        sx={{
          minWidth: tableMinWidth,
          width: '100%',
          tableLayout: 'fixed',
          '& .MuiTableCell-head': { py: 0.5, whiteSpace: 'nowrap', fontWeight: 600 },
        }}
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
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                      <TableSortLabel
                        active={tableSort.field === 'serial'}
                        direction={tableSort.field === 'serial' ? tableSort.direction : 'asc'}
                        onClick={() => onTableSort('serial')}
                      >
                        Серийный
                      </TableSortLabel>
                      <TableSortLabel
                        active={tableSort.field === 'partNo'}
                        direction={tableSort.field === 'partNo' ? tableSort.direction : 'asc'}
                        onClick={() => onTableSort('partNo')}
                        sx={{ fontWeight: 400, fontSize: '0.75rem' }}
                      >
                        Part Number
                      </TableSortLabel>
                    </Box>
                  </TableCell>
                )}
                {!isMobile && (
                  <TableCell sx={{ width: TABLE_WIDTHS.equipment.typeModel }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                      <TableSortLabel
                        active={tableSort.field === 'model'}
                        direction={tableSort.field === 'model' ? tableSort.direction : 'asc'}
                        onClick={() => onTableSort('model')}
                      >
                        Модель
                      </TableSortLabel>
                      <TableSortLabel
                        active={tableSort.field === 'type'}
                        direction={tableSort.field === 'type' ? tableSort.direction : 'asc'}
                        onClick={() => onTableSort('type')}
                        sx={{ fontWeight: 400, fontSize: '0.75rem' }}
                      >
                        Тип
                      </TableSortLabel>
                    </Box>
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
                <TableCell
                  align="center"
                  sx={{ width: isMobile ? TABLE_WIDTHS.equipmentMobile.compare : TABLE_WIDTHS.equipment.compare }}
                >
                  1С
                </TableCell>
                <TableCell
                  align="center"
                  sx={{ width: isMobile ? TABLE_WIDTHS.equipmentMobile.act : TABLE_WIDTHS.equipment.act }}
                >
                  Акт
                </TableCell>
                <TableCell
                  align="center"
                  sx={{ width: isMobile ? TABLE_WIDTHS.equipmentMobile.photo : TABLE_WIDTHS.equipment.photo }}
                >
                  <Tooltip title="Есть фото" arrow>
                    <PhotoCameraOutlinedIcon sx={{ fontSize: 18, verticalAlign: 'middle' }} aria-label="Фото" />
                  </Tooltip>
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
                key={invNo || `row-${idx}`}
                item={item}
                isSelected={isSelected}
                isMobile={isMobile}
                theme={theme}
                onSelect={onSelect}
                onAction={onAction}
                onRowClick={openRowMenu}
                onRowKeyDown={openRowMenuFromKeyboard}
                onOpenEmployee={onOpenEmployee}
                onOpenCurrentAct={onOpenCurrentAct}
                openingCurrentActDocNo={openingCurrentActDocNo}
                onEditConsumableQty={onEditConsumableQty}
                onDeleteConsumable={onDeleteConsumable}
                onShowConsumableQr={onShowConsumableQr}
                allowSelection={allowSelection}
                dataMode={dataMode}
                canWrite={canWrite}
                canDelete={canDelete}
                canDeleteEquipment={canDeleteEquipment}
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
    {isConsumablesMode ? null : rowMenu}
    </>
  );
});

export default EquipmentTable;
