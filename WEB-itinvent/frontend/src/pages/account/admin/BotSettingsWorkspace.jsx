import { useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Grid, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import AgentAccessPanel from './AgentAccessPanel';
import { createAiBotDraft, getAiBotEnabledTools } from './aiBotModel';

const describeType = (bot) => bot.surface === 'sandbox' ? 'OpenCode · файлы и код'
  : bot.surface === 'general' ? 'Обычный ИИ-чат · доступен всем' : 'Агент HUB · персональный доступ';
const pack = (draft) => ({ ...draft, allowed_kb_scope: String(draft.allowed_kb_scope || '').split(',').map((v) => v.trim()).filter(Boolean) });

function OpenCodeCapabilities() {
  return <Stack spacing={2}>
    <Typography variant="body2">OpenCode работает с выбранными файлами в отдельной рабочей папке на Linux. Его инструменты уже подключены.</Typography>
    {[
      ['Без подтверждения', 'Чтение файлов, поиск по именам и содержимому внутри рабочей папки.', 'success'],
      ['С подтверждением', 'Создание и изменение файлов, выполнение разрешённых команд. Подтверждение можно дать один раз или на сессию.', 'warning'],
      ['Запрещено', 'Внешние каталоги, произвольный интернет, установка пакетов и внешние Git-операции.', 'default'],
    ].map(([title, body, color]) => <Box key={title}>
      <Chip size="small" label={title} color={color} sx={{ mb: 0.75 }} />
      <Typography variant="body2">{body}</Typography>
    </Box>)}
    <Alert severity="info">Инструменты HUB — ITinvent, AD, почта, задачи, МФУ и сеть — к OpenCode пока не подключены. Для их подключения нужна отдельная интеграция.</Alert>
    <Typography variant="body2" color="text.secondary">Вложения передаются в рабочую папку, готовые файлы возвращаются в чат. Назначение доступа к OpenCode не открывает чужие файлы или весь сервер.</Typography>
  </Stack>;
}

export default function BotSettingsWorkspace({ bots = [], loading, savingBotId, runsByBotId = {}, onRefresh, onCreate, onSave,
  openrouterConfigured, draftsById, newDraft, setNewDraft, updateDraft, renderFields }) {
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('tools');
  const list = Array.isArray(bots) ? bots : [];
  const creating = selected === 'new';
  const bot = list.find((item) => item.id === selected) || list[0];
  const draft = creating ? newDraft : (bot && (draftsById[bot.id] || createAiBotDraft(bot)));
  const sandbox = !creating && bot?.surface === 'sandbox';
  const general = !creating && bot?.surface === 'general';
  const activeTab = (creating || general) && tab === 'access' ? 'tools' : tab;
  const busy = savingBotId === (creating ? 'new' : bot?.id);
  const change = (key, value) => creating ? setNewDraft((old) => ({ ...old, [key]: value })) : updateDraft(bot.id, key, value);
  const save = () => creating ? onCreate(pack(draft)) : onSave(bot.id, sandbox
    ? { title: draft.title, description: draft.description } : pack(draft));
  return <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2.5 }, borderRadius: 3, minWidth: 0 }}>
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, justifyContent: 'space-between', mb: 2 }}>
      <Box><Typography variant="h6" fontWeight={700}>Настройки агентов</Typography>
        <Typography variant="body2" color="text.secondary">Выберите агента: кому он доступен, что умеет и как отвечает.</Typography></Box>
      <Stack direction="row" spacing={1}>
        <Button startIcon={<RefreshOutlinedIcon />} onClick={onRefresh} disabled={loading || Boolean(savingBotId)}>Обновить</Button>
        <Button startIcon={<AddOutlinedIcon />} onClick={() => { setSelected('new'); setTab('settings'); }}>Создать бота</Button>
      </Stack>
    </Stack>
    <Grid container spacing={3}>
      <Grid item xs={12} md={3}>
        <Stack spacing={1}>
          {loading && <CircularProgress size={22} aria-label="Загрузка агентов" />}
          {!loading && !list.length && <Typography color="text.secondary">AI-боты ещё не созданы.</Typography>}
          {list.map((item) => <Button key={item.id} variant={!creating && item.id === bot?.id ? 'contained' : 'outlined'}
            onClick={() => { setSelected(item.id); setTab('tools'); }} sx={{ textAlign: 'left', justifyContent: 'flex-start', textTransform: 'none', p: 1.25 }}>
            <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}><Typography fontWeight={600}>{item.title}</Typography>
              <Typography variant="caption">{describeType(item)}{!item.is_enabled ? ' · выключен' : ''}</Typography></Box>
          </Button>)}
        </Stack>
      </Grid>
      <Grid item xs={12} md={9} sx={{ minWidth: 0 }}>
        {!draft ? <Alert severity="info">Нажмите «Создать бота», чтобы настроить нового агента.</Alert> : <Stack spacing={2}>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>{creating ? 'Новый агент' : describeType(bot)}</Typography>
              <Typography variant="caption" color="text.secondary">{activeTab === 'access' ? 'Назначения сохраняются сразу.' : activeTab === 'diagnostics' || (sandbox && activeTab === 'tools') ? 'Информация о работе агента.' : 'Настройки применяются кнопкой «Сохранить».'}</Typography>
            </Box>
            {activeTab !== 'access' && activeTab !== 'diagnostics' && (!sandbox || activeTab === 'settings') && <Button variant="contained" onClick={save} disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</Button>}
          </Stack>
          <Tabs value={activeTab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto" aria-label="Разделы настроек агента">
            <Tab value="tools" label="Возможности" id="bot-tab-tools" aria-controls="bot-panel" />
            {!creating && !general && <Tab value="access" label="Доступ сотрудников" id="bot-tab-access" aria-controls="bot-panel" />}
            <Tab value="settings" label={sandbox ? 'Оформление' : 'Настройки ответа'} id="bot-tab-settings" aria-controls="bot-panel" />
            {!creating && <Tab value="diagnostics" label="Диагностика" id="bot-tab-diagnostics" aria-controls="bot-panel" />}
          </Tabs>
          <Box role="tabpanel" id="bot-panel" aria-labelledby={`bot-tab-${activeTab}`} sx={{ minWidth: 0 }}>
            {activeTab === 'access' && <Stack spacing={2}>
              <Alert severity="info">Администраторы используют всех агентов автоматически. Другим сотрудникам нужен персональный доступ. Управлять назначениями могут администраторы и управляющие ботами; это право само по себе не открывает агента.</Alert>
              <AgentAccessPanel key={bot.id} botId={bot.id} embedded />
            </Stack>}
            {activeTab === 'tools' && (sandbox ? <OpenCodeCapabilities /> : <Stack spacing={2}>
              {general && <Alert severity="info">Обычный ИИ-чат доступен всем активным пользователям.</Alert>}
              <Typography variant="body2" color="text.secondary">Включите нужные группы и выберите инструменты. Каждый вызов сохраняет ограничения сотрудника на данные и действия.</Typography>
              {!getAiBotEnabledTools(draft).length && <Alert severity="info">Инструменты не выбраны. Агент сможет отвечать текстом без обращения к данным HUB.</Alert>}
              {renderFields(draft, change, 'tools', creating)}
            </Stack>)}
            {activeTab === 'settings' && (sandbox ? <Stack spacing={2}>
              <TextField label="Название" value={draft.title} onChange={(e) => change('title', e.target.value)} fullWidth />
              <TextField label="Описание" value={draft.description} onChange={(e) => change('description', e.target.value)} multiline minRows={2} fullWidth />
              <Alert severity="info">Модель, ограничения команд и запуск OpenCode управляются серверной конфигурацией. Эта форма меняет только название и описание.</Alert>
            </Stack> : renderFields(draft, change, 'settings', creating))}
            {activeTab === 'diagnostics' && (sandbox ? <Alert severity="info">Задания OpenCode отображаются в его диалоге в чате. Статус Linux-сервиса и модель здесь пока не проверяются.</Alert> : <Stack spacing={1.5}>
              <Alert severity={openrouterConfigured ? 'success' : 'warning'}>{openrouterConfigured ? 'Провайдер ИИ настроен.' : 'Провайдер ИИ не настроен. Требуется проверка серверной конфигурации.'}</Alert>
              <Typography variant="body2">Сохранено инструментов: {getAiBotEnabledTools(bot).length}</Typography>
              {!(runsByBotId[bot.id]?.length) && <Typography color="text.secondary">Заданий пока нет.</Typography>}
              {(runsByBotId[bot.id] || []).slice(0, 5).map((run) => <Box key={run.id}>
                <Typography>{run.status_text || run.status}</Typography>
                {run.error_text && <Typography color="error.main">{run.error_text}</Typography>}
              </Box>)}
            </Stack>)}
          </Box>
        </Stack>}
      </Grid>
    </Grid>
  </Paper>;
}
