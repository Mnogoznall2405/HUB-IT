const { execSync } = require('child_process');
const path = require('path');

const pm2Cmd = path.join(process.env.APPDATA || '', 'npm', 'pm2.cmd');
const raw = execSync(`"${pm2Cmd}" jlist`, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
const procs = JSON.parse(raw);

const skip = new Set([
  'Path', 'PATH', 'PWD', 'windir', 'unique_id', 'NODE_APP_INSTANCE',
  'PM2_HOME', 'PM2_USAGE', 'PM2_JSON_PROCESSING', 'PM2_INTERACTOR_PROCESSING',
  'RUST_LOG', 'DEBUG', 'ANTHROPIC_BASE_URL', '_ZO_DOCTOR', 'NO_COLOR', 'FORCE_COLOR', 'TERM',
  'USERPROFILE', 'USERNAME', 'USERDOMAIN', 'USERDOMAIN_ROAMINGPROFILE', 'TMP', 'TEMP',
  'SystemRoot', 'SystemDrive', 'SESSIONNAME', 'PUBLIC', 'PSModulePath', 'PSExecutionPolicyPreference',
  'PROMPT', 'ProgramW6432', 'ProgramFiles(x86)', 'ProgramFiles', 'ProgramData',
  'PROCESSOR_REVISION', 'PROCESSOR_LEVEL', 'PROCESSOR_IDENTIFIER', 'PROCESSOR_ARCHITECTURE',
  'PATHEXT', 'OS', 'NUMBER_OF_PROCESSORS', 'LOGONSERVER', 'LOCALAPPDATA', 'HOMEPATH', 'HOMEDRIVE',
  'FPS_BROWSER_USER_PROFILE_STRING', 'FPS_BROWSER_APP_PROFILE_STRING', 'DriverData', 'ComSpec',
  'COMPUTERNAME', 'CommonProgramW6432', 'CommonProgramFiles(x86)', 'CommonProgramFiles',
  'CLIENTNAME', 'APPDATA', 'ALLUSERSPROFILE', 'ORIGINAL_XDG_CURRENT_DESKTOP', 'ELECTRON_RUN_AS_NODE',
]);

const noise = /^(PM2_|VSCODE_|CURSOR_|CODEX_|CHROME_|ELECTRON_|itinvent-)/;
const skipProps = new Set(['env', 'env_production', 'axm_actions', 'axm_monitor', 'axm_options', 'axm_dynamic']);
const out = {};

for (const proc of procs) {
  const pm2Env = proc.pm2_env || {};
  const merged = { ...(pm2Env.env || {}), ...pm2Env };
  const empty = [];

  for (const [key, value] of Object.entries(merged)) {
    if (skipProps.has(key)) continue;
    if (noise.test(key) || skip.has(key)) continue;
    if (typeof value !== 'string') continue;
    if (value.trim() === '') empty.push(key);
  }

  if (empty.length) {
    out[proc.name] = empty.sort();
  }
}

console.log(JSON.stringify(out, null, 2));
