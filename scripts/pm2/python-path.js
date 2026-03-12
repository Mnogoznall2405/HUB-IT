const fs = require('fs');
const path = require('path');

function resolvePython(projectRoot) {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const candidates = [
    process.env.PM2_PYTHON,
    path.join(projectRoot, '.venv', 'Scripts', 'python.exe'),
    path.join(projectRoot, 'WEB-itinvent', '.venv', 'Scripts', 'python.exe'),
    localAppData ? path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe') : null,
    localAppData ? path.join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe') : null,
    path.join(programFiles, 'Python312', 'python.exe'),
    path.join(programFiles, 'Python311', 'python.exe'),
    path.join(programFilesX86, 'Python312', 'python.exe'),
    path.join(programFilesX86, 'Python311', 'python.exe'),
  ].filter(Boolean);

  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) {
    throw new Error(`Python executable not found. Checked: ${candidates.join(', ')}`);
  }
  return resolved;
}

module.exports = {
  resolvePython,
};
