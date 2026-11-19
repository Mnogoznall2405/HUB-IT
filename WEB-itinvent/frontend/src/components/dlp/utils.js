// Shared DLP helpers (extracted from pages/FileEgress.jsx).

// Foreground telemetry stores raw process names (chrome.exe, winword.exe);
// the UI shows the product name. Keys are lowercase, without ".exe".
const APP_NAME_LABELS = {
  '1cv8': '1С:Предприятие',
  '1cv8c': '1С:Предприятие',
  '1cv8s': '1С:Предприятие',
  chrome: 'Google Chrome',
  msedge: 'Microsoft Edge',
  firefox: 'Mozilla Firefox',
  browser: 'Яндекс Браузер',
  opera: 'Opera',
  iexplore: 'Internet Explorer',
  winword: 'Microsoft Word',
  excel: 'Microsoft Excel',
  powerpnt: 'Microsoft PowerPoint',
  outlook: 'Microsoft Outlook',
  onenote: 'Microsoft OneNote',
  msaccess: 'Microsoft Access',
  visio: 'Microsoft Visio',
  winproj: 'Microsoft Project',
  mspub: 'Microsoft Publisher',
  teams: 'Microsoft Teams',
  'ms-teams': 'Microsoft Teams',
  lync: 'Skype for Business',
  notepad: 'Блокнот',
  'notepad++': 'Notepad++',
  wordpad: 'WordPad',
  mspaint: 'Paint',
  snippingtool: 'Ножницы',
  screenshotsketch: 'Ножницы',
  explorer: 'Проводник',
  taskmgr: 'Диспетчер задач',
  cmd: 'Командная строка',
  powershell: 'PowerShell',
  pwsh: 'PowerShell',
  windowsterminal: 'Терминал Windows',
  wt: 'Терминал Windows',
  systemsettings: 'Параметры Windows',
  applicationframehost: 'Приложение Windows',
  textinputhost: 'Панель ввода',
  searchhost: 'Поиск Windows',
  searchapp: 'Поиск Windows',
  startmenuexperiencehost: 'Меню «Пуск»',
  shellexperiencehost: 'Оболочка Windows',
  lockapp: 'Экран блокировки',
  dwm: 'Рабочий стол',
  mstsc: 'Подключение к удалённому рабочему столу',
  msrdcw: 'Удалённый рабочий стол',
  vmconnect: 'Hyper-V',
  anydesk: 'AnyDesk',
  teamviewer: 'TeamViewer',
  rustdesk: 'RustDesk',
  radmin: 'Radmin',
  rview: 'Radmin Viewer',
  ammyy: 'Ammyy Admin',
  aa_v3: 'Ammyy Admin',
  romview: 'LiteManager',
  romserver: 'LiteManager',
  mremoteng: 'mRemoteNG',
  putty: 'PuTTY',
  kitty: 'KiTTY',
  mobaxterm: 'MobaXterm',
  securecrt: 'SecureCRT',
  winscp: 'WinSCP',
  filezilla: 'FileZilla',
  totalcmd: 'Total Commander',
  totalcmd64: 'Total Commander',
  far: 'Far Manager',
  '7zfm': '7-Zip',
  '7zg': '7-Zip',
  winrar: 'WinRAR',
  acrobat: 'Adobe Acrobat',
  acrord32: 'Adobe Acrobat Reader',
  foxitreader: 'Foxit Reader',
  sumatrapdf: 'SumatraPDF',
  code: 'Visual Studio Code',
  devenv: 'Visual Studio',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  idea64: 'IntelliJ IDEA',
  pycharm64: 'PyCharm',
  webstorm64: 'WebStorm',
  rider64: 'Rider',
  datagrip64: 'DataGrip',
  phpstorm64: 'PhpStorm',
  goland64: 'GoLand',
  clion64: 'CLion',
  rubymine64: 'RubyMine',
  sublime_text: 'Sublime Text',
  atom: 'Atom',
  zed: 'Zed',
  studio3t: 'Studio 3T',
  robo3t: 'Robo 3T',
  mongodbcompass: 'MongoDB Compass',
  dbeaver: 'DBeaver',
  ssms: 'SQL Server Management Studio',
  sqldeveloper: 'Oracle SQL Developer',
  sqldeveloper64w: 'Oracle SQL Developer',
  heidisql: 'HeidiSQL',
  navicat: 'Navicat',
  pgadmin4: 'pgAdmin',
  plsqldev: 'PL/SQL Developer',
  toad: 'Toad',
  postman: 'Postman',
  insomnia: 'Insomnia',
  fiddler: 'Fiddler',
  wireshark: 'Wireshark',
  docker: 'Docker Desktop',
  obs64: 'OBS Studio',
  obs: 'OBS Studio',
  telegram: 'Telegram',
  max: 'MAX',
  whatsapp: 'WhatsApp',
  viber: 'Viber',
  discord: 'Discord',
  slack: 'Slack',
  signal: 'Signal',
  element: 'Element',
  rocketchat: 'Rocket.Chat',
  mattermost: 'Mattermost',
  icq: 'ICQ',
  skype: 'Skype',
  skypeapp: 'Skype',
  zoom: 'Zoom',
  webex: 'Webex',
  gotomeeting: 'GoToMeeting',
  trueconf: 'TrueConf',
  thunderbird: 'Mozilla Thunderbird',
  emclient: 'eM Client',
  thebat: 'The Bat!',
  notion: 'Notion',
  obsidian: 'Obsidian',
  evernote: 'Evernote',
  figma: 'Figma',
  canva: 'Canva',
  photoshop: 'Adobe Photoshop',
  illustrator: 'Adobe Illustrator',
  gimp: 'GIMP',
  inkscape: 'Inkscape',
  blender: 'Blender',
  acad: 'AutoCAD',
  autocad: 'AutoCAD',
  kompas: 'КОМПАС-3D',
  kompas3d: 'КОМПАС-3D',
  sldworks: 'SOLIDWORKS',
  inventor: 'Autodesk Inventor',
  revit: 'Autodesk Revit',
  sketchup: 'SketchUp',
  nanocad: 'nanoCAD',
  napp64: 'nanoCAD',
  cons: 'Консультант Плюс',
  consultant: 'Консультант Плюс',
  garant: 'Гарант',
  'garant-f1': 'Гарант',
  sbis: 'СБИС',
  sbis3: 'СБИС',
  saby: 'СБИС',
  directum: 'Directum',
  elma365: 'ELMA365',
  vlc: 'VLC',
  wmplayer: 'Windows Media Player',
  potplayer: 'PotPlayer',
  potplayermini64: 'PotPlayer',
  'mpc-hc64': 'MPC-HC',
  smplayer: 'SMPlayer',
  aimp: 'AIMP',
  aimp3: 'AIMP',
  foobar2000: 'foobar2000',
  spotify: 'Spotify',
  itunes: 'iTunes',
  audacity: 'Audacity',
  steam: 'Steam',
  epicgameslauncher: 'Epic Games',
  'battle.net': 'Battle.net',
  eadesktop: 'EA App',
  riotclientservices: 'Riot Client',
  keepass: 'KeePass',
  keepassxc: 'KeePassXC',
  bitwarden: 'Bitwarden',
  avp: 'Kaspersky',
  avpui: 'Kaspersky',
  msmpeng: 'Защитник Windows',
  sharex: 'ShareX',
  greenshot: 'Greenshot',
  lightshot: 'Lightshot',
  monosnap: 'Monosnap',
  everything: 'Everything',
  windirstat: 'WinDirStat',
  treesizefree: 'TreeSize',
  ccleaner64: 'CCleaner',
  ditto: 'Ditto',
  powerlauncher: 'PowerToys',
  onedrive: 'OneDrive',
  googledrivefs: 'Google Диск',
  dropbox: 'Dropbox',
  cloud: 'Облако Mail.ru',
  unknown: 'Неизвестное приложение',
};

/** Process name → product name: 'winword.exe' → 'Microsoft Word'. */
export function displayAppName(name) {
  const key = String(name || '').trim().replace(/\.exe$/i, '');
  if (!key) return '';
  const label = APP_NAME_LABELS[key.toLowerCase()];
  if (label) return label;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** 'Google Chrome (chrome)' — friendly name plus the raw process for forensics. */
export function displayAppDetail(name) {
  const raw = String(name || '').trim();
  const label = displayAppName(raw);
  if (!label) return '';
  const base = raw.replace(/\.exe$/i, '');
  return label.toLowerCase() === base.toLowerCase() ? label : `${label} (${base})`;
}

export const CHANNEL_LABELS = {
  usb: 'USB',
  network: 'Сеть',
  telegram: 'Telegram',
  max: 'MAX',
  browser: 'Браузер',
  deleted: 'Удаление',
};

// details.send_state set by agent probes: 'sent' = outgoing bubble seen in chat
// history, 'selected' = file picked/opened by the app (send not confirmed),
// 'observed' = file touched with unknown direction (browser handles).
const SEND_STATE_META = {
  sent: { label: 'Отправлено', color: 'info' },
  selected: { label: 'Выбран файл', color: 'default' },
  observed: { label: 'Наблюдено', color: 'default' },
};

export function sendStateMeta(row) {
  const state = String(row?.details?.send_state || '').toLowerCase();
  return SEND_STATE_META[state] || null;
}

export function formatTs(ts) {
  if (!ts) return '—';
  try {
    return new Date(Number(ts) * 1000).toLocaleString('ru-RU');
  } catch {
    return String(ts);
  }
}

export function shortLabel(value, limit = 36) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function chatKey(chat, index) {
  return `${chat.computer_name || ''}:${chat.chat_id || chat.chat_name || index}`;
}

export function unwrapPeerId(value) {
  const text = String(value || '').trim();
  const match = text.match(/^\[\s*\d+\s*,\s*'([^']+)'\s*\]$/);
  if (match?.[1]) return match[1];
  return text;
}

export function isHumanChatTitle(name, chatId = '') {
  const text = String(name || '').trim();
  const cid = unwrapPeerId(chatId);
  if (!text) return false;
  if (text === cid || text === String(chatId || '').trim()) return false;
  if (text.startsWith('[') || text.startsWith('{')) return false;
  if (/^https?:\/\//i.test(text)) return false;
  if (/^[0-9a-f]{8,16}$/i.test(text)) return false;
  return true;
}

export function displayChatTitle(chat, productLabel = 'Чат') {
  const cid = unwrapPeerId(chat?.chat_id);
  let name = unwrapPeerId(chat?.chat_name);
  if (!isHumanChatTitle(name, cid)) {
    const msgs = Array.isArray(chat?.messages) ? chat.messages : [];
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const msg = msgs[i];
      const sender = String(msg?.sender || '').trim();
      if (messageSide(msg?.direction) === 'in' && sender && sender !== 'me' && isHumanChatTitle(sender, cid)) {
        name = sender;
        break;
      }
    }
  }
  if (!isHumanChatTitle(name, cid)) {
    name = cid ? `Диалог ${cid.slice(0, 10)}` : `Диалог ${productLabel}`;
  }
  return name;
}

export function messageSide(direction) {
  const d = String(direction || '').toLowerCase();
  if (d.includes('out')) return 'out';
  if (d.includes('in')) return 'in';
  return 'other';
}

export function normalizeHost(value) {
  return String(value || '').trim();
}

export function mediaFileName(mediaPath) {
  const raw = String(mediaPath || '').replace(/\\/g, '/').trim();
  if (!raw) return '';
  return raw.split('/').pop() || '';
}

export function isImageMedia(msg) {
  const kind = String(msg?.media_kind || '').toLowerCase();
  const path = String(msg?.media_path || '').toLowerCase();
  if (['jpeg', 'jpg', 'png', 'webp', 'gif'].includes(kind)) return true;
  if (/\.(jpe?g|png|webp|gif)$/i.test(path)) return true;
  const label = String(msg?.media || '').toLowerCase();
  return Boolean(path) && /^(фотография|photo|gif|стикер|sticker)\b/.test(label);
}

export function isCacheHashName(name) {
  return /^[a-f0-9]{12,}\.(jpe?g|png|webp|gif|mp4)$/i.test(String(name || '').trim());
}

export function isRealTelegramSend(row) {
  if (String(row?.channel || '').toLowerCase() !== 'telegram') return true;
  const details = row?.details && typeof row.details === 'object' ? row.details : {};
  if (String(details.source || '') === 'uia_outgoing') return true;
  const media = String(details.media || row?.file_name || '').trim();
  if (/^(файл|file|документ|document|фотография|photo|видео|video|gif|стикер|sticker)\b/i.test(media)) {
    return !isCacheHashName(row?.file_name) || Boolean(details.media);
  }
  // Legacy cache-hash rows without UIA media label — hide.
  if (isCacheHashName(row?.file_name) && !details.media) return false;
  return Boolean(media);
}

export function displayMessageText(msg) {
  const raw = String(msg?.text || '').trim();
  const mediaLabel = String(msg?.media || '').trim();
  if (mediaLabel && raw.startsWith(mediaLabel)) {
    return raw.slice(mediaLabel.length).trim();
  }
  if (mediaLabel && raw === mediaLabel) return '';
  return raw;
}

export function parseIsoDay(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseDateFromTimeField(timeValue) {
  const raw = String(timeValue || '').trim().toLowerCase();
  if (!raw) return null;
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (raw.startsWith('сегодня')) return startToday;
  if (raw.startsWith('вчера')) {
    return new Date(startToday.getTime() - 86400000);
  }
  const m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+в\s+/);
  if (!m) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const d = new Date(year, Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function messageDayMeta(msg) {
  const labelFromMsg = String(msg?.day_label || '').trim();
  const fromChatDate = parseIsoDay(msg?.chat_date);
  if (fromChatDate) {
    return {
      key: String(msg.chat_date).trim(),
      date: fromChatDate,
      label: labelFromMsg || formatDayLabel(fromChatDate),
    };
  }
  const fromTime = parseDateFromTimeField(msg?.time);
  if (fromTime) {
    const key = `${fromTime.getFullYear()}-${fromTime.getMonth() + 1}-${fromTime.getDate()}`;
    return { key, date: fromTime, label: labelFromMsg || formatDayLabel(fromTime) };
  }
  if (labelFromMsg) {
    return { key: `label:${labelFromMsg}`, date: null, label: labelFromMsg };
  }
  // Do NOT use recorded_at — that is capture time, not dialogue day.
  return { key: 'unknown', date: null, label: 'Без даты' };
}

export function formatMsgClock(msg) {
  const raw = String(msg?.time || '').trim();
  if (raw) {
    const cleaned = raw
      .replace(/^(сегодня|вчера)\s+/i, '')
      .replace(/^\d{1,2}\.\d{1,2}\.\d{2,4}\s+/i, '')
      .replace(/^в\s+/i, '')
      .replace(/\s*\(изм\.?\)\s*$/i, '')
      .trim();
    if (cleaned) return cleaned;
  }
  return '—';
}

export function formatDayLabel(date) {
  if (!date) return 'Без даты';
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startMsg = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startToday - startMsg) / 86400000);
  if (diffDays === 0) return 'Сегодня';
  if (diffDays === 1) return 'Вчера';
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export function dedupeMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const seen = new Set();
  const out = [];
  list.forEach((msg) => {
    if (!msg || typeof msg !== 'object') return;
    const key = String(
      msg.msg_key
        || `${msg.direction || ''}|${msg.time || ''}|${msg.sender || ''}|${msg.text || msg.media || ''}`
    )
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(msg);
  });
  return out;
}

export function groupMessagesByDay(messages) {
  const groups = [];
  let current = null;
  messages.forEach((msg, index) => {
    const meta = messageDayMeta(msg);
    if (!current || current.key !== meta.key) {
      current = { key: meta.key, label: meta.label, items: [] };
      groups.push(current);
    }
    current.items.push({ msg, index });
  });
  return groups;
}

export function lastMessagePreview(chat) {
  const messages = dedupeMessages(chat?.messages);
  if (!messages.length) return 'Нет сообщений';
  const last = messages[messages.length - 1] || {};
  const text = displayMessageText(last) || last.media || last.text || 'Медиа';
  const who = messageSide(last.direction) === 'out' ? 'Вы' : (last.sender || 'Собеседник');
  return `${who}: ${shortLabel(text, 48)}`;
}

export function parseScreenshotStamp(fileName) {
  const m = String(fileName || '').match(/_(\d{8})_(\d{6})(?:_(\d+))?\.(png|jpe?g|webp)$/i);
  if (!m) return null;
  const y = Number(m[1].slice(0, 4));
  const mo = Number(m[1].slice(4, 6));
  const d = Number(m[1].slice(6, 8));
  const hh = Number(m[2].slice(0, 2));
  const mm = Number(m[2].slice(2, 4));
  const ss = Number(m[2].slice(4, 6));
  const date = new Date(y, mo - 1, d, hh, mm, ss);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatShotWhen(date) {
  if (!date) return { day: 'Без даты', clock: '—' };
  return {
    day: date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    clock: date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  };
}

/** Link a message to its capture screenshot (explicit path or nearest by time). */
export function resolveMessageScreenshot(msg, screenshots, maxSkewMs = 20 * 60 * 1000) {
  const list = Array.isArray(screenshots) ? screenshots : [];
  const names = list.map((shot) => mediaFileName(shot)).filter(Boolean);
  const direct = mediaFileName(msg?.screenshot_path);
  if (direct) return direct;
  const msgTs = Date.parse(String(msg?.recorded_at || ''));
  if (!Number.isFinite(msgTs) || !names.length) return '';
  let best = '';
  let bestDist = Infinity;
  names.forEach((name) => {
    const stamp = parseScreenshotStamp(name);
    if (!stamp) return;
    const dist = Math.abs(stamp.getTime() - msgTs);
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  });
  return bestDist <= maxSkewMs ? best : '';
}

export function formatDwell(sec) {
  const n = Number(sec) || 0;
  if (n <= 0) return '0с';
  if (n < 60) return `${Math.round(n)}с`;
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  if (m < 60) return s ? `${m}м ${s}с` : `${m}м`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}ч ${rm}м` : `${h}ч`;
}

export function formatAgo(ts) {
  const n = Number(ts) || 0;
  if (!n) return '—';
  const diff = Date.now() - n * 1000;
  if (diff < 60_000) return 'только что';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} дн назад`;
  return formatTs(n);
}

// Fixed-offset clocks for branch-local DLP data: the viewer's own timezone
// must never shift what a remote host's day looked like.

export function dayAtUtcOffset(epochMs, offsetMinutes) {
  return new Date(epochMs + offsetMinutes * 60000).toISOString().slice(0, 10);
}

export function clockAtUtcOffset(epochMs, offsetMinutes) {
  const date = new Date(epochMs + offsetMinutes * 60000);
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

export function utcOffsetLabel(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}
