import { memo } from 'react';
import {
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
} from '@mui/material';

import {
  PRINTER_COMPONENT_OPTIONS,
  getComponentLabel,
  normalizePrinterComponentType,
} from './equipmentModel';
import ActionConsumableSelect from './ActionConsumableSelect';
import ActionHistoryPanel from './ActionHistoryPanel';

export const getMaintenanceConsumableLabel = ({ actionType, componentKind } = {}) => {
  if (actionType === 'cartridge') return 'Картридж / расходник';
  return componentKind === 'printer' ? 'Запчасть / расходник' : 'Компонент / расходник';
};

export const getMaintenanceConsumableEmptyText = ({ actionType, componentKind } = {}) => {
  if (actionType !== 'cartridge') return 'Картриджи не найдены';
  return componentKind === 'printer'
    ? 'Нет запчастей (картриджи скрыты)'
    : 'Расходники не найдены';
};

const MaintenanceActionContent = memo(function MaintenanceActionContent({
  actionType,
  componentKind,
  isMobile = false,
  ui,
  actionLoading = false,
  consumableOptions = [],
  consumablesLoading = false,
  selectedConsumable = null,
  onSelectedConsumableChange,
  cartridgeModel = '',
  cartridgeHistory = null,
  batteryHistory = null,
  componentType = PRINTER_COMPONENT_OPTIONS[0].value,
  componentOptions = PRINTER_COMPONENT_OPTIONS,
  onComponentTypeChange,
  componentHistory = null,
  cleaningHistory = null,
  formatDate,
}) {
  if (actionType === 'cartridge') {
    return (
      <>
        <ActionConsumableSelect
          options={consumableOptions}
          loading={consumablesLoading}
          value={selectedConsumable}
          onChange={onSelectedConsumableChange}
          label={getMaintenanceConsumableLabel({ actionType, componentKind })}
          noOptionsText={getMaintenanceConsumableEmptyText({ actionType, componentKind })}
          isMobile={isMobile}
        />

        <ActionHistoryPanel
          ui={ui}
          title={`ИСТОРИЯ ЗАМЕНЫ КАРТРИДЖА${cartridgeModel ? `: ${cartridgeModel}` : ''}`}
          history={cartridgeHistory}
          formatDate={formatDate}
          emptyMessage="История замен картриджа пуста"
        />
      </>
    );
  }

  if (actionType === 'battery') {
    return (
      <ActionHistoryPanel
        ui={ui}
        mt={1}
        title="ИСТОРИЯ ЗАМЕНЫ БАТАРЕИ"
        history={batteryHistory}
        formatDate={formatDate}
        emptyMessage="История замен батареи пуста"
      />
    );
  }

  if (actionType === 'component') {
    const componentLabel = componentKind === 'pc' ? 'Компонент ПК' : 'Тип компонента';

    return (
      <>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth size={isMobile ? 'medium' : 'small'}>
              <InputLabel id="maintenance-component-type-label">{componentLabel}</InputLabel>
              <Select
                labelId="maintenance-component-type-label"
                id="maintenance-component-type"
                value={componentType}
                onChange={(event) => onComponentTypeChange?.(normalizePrinterComponentType(event.target.value))}
                label={componentLabel}
                disabled={actionLoading}
              >
                {componentOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <ActionConsumableSelect
              options={consumableOptions}
              loading={consumablesLoading}
              value={selectedConsumable}
              onChange={onSelectedConsumableChange}
              label={getMaintenanceConsumableLabel({ actionType, componentKind })}
              noOptionsText={getMaintenanceConsumableEmptyText({ actionType, componentKind })}
              isMobile={isMobile}
            />
          </Grid>
        </Grid>

        <ActionHistoryPanel
          ui={ui}
          title={`ИСТОРИЯ ЗАМЕНЫ: ${getComponentLabel(componentKind, componentType)}`}
          history={componentHistory}
          formatDate={formatDate}
          emptyMessage="История замен по этому компоненту пуста"
        />
      </>
    );
  }

  if (actionType === 'cleaning') {
    return (
      <ActionHistoryPanel
        ui={ui}
        title="ИСТОРИЯ ЧИСТОК"
        history={cleaningHistory}
        formatDate={formatDate}
        countLabel="Всего чисток"
        emptyMessage="История чисток пуста"
      />
    );
  }

  return null;
});

export default MaintenanceActionContent;
