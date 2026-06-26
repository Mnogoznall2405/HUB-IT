import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const detailDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/hub/tasks/detail');
const files = fs.readdirSync(detailDir).filter((name) => name.endsWith('.jsx'));

for (const file of files) {
  const filePath = path.join(detailDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  content = content
    .replaceAll("from './MarkdownRenderer'", "from '../../MarkdownRenderer'")
    .replaceAll("from '../common/OverflowMenu'", "from '../../../common/OverflowMenu'")
    .replaceAll("from '../../lib/taskNavigation'", "from '../../../../lib/taskNavigation'");
  fs.writeFileSync(filePath, content);
}

const sharedPath = path.join(detailDir, 'taskDetailShared.jsx');
let shared = fs.readFileSync(sharedPath, 'utf8');
shared = shared
  .replaceAll("from './MarkdownRenderer'", "from '../../MarkdownRenderer'")
  .replaceAll("from '../common/OverflowMenu'", "from '../../../common/OverflowMenu'")
  .replaceAll("from '../../lib/taskNavigation'", "from '../../../../lib/taskNavigation'");

if (!shared.includes('export {')) {
  shared += `\nexport {\n  clampTextSx,\n  renderKvRows,\n  renderObserverBlock,\n  getTaskUserLabel,\n  getChecklistStats,\n  getTaskViewCount,\n  getTaskLikeCount,\n  formatMobileDueText,\n  TaskMobilePersonRow,\n  TaskMobileRailButton,\n};\n`;
}

fs.writeFileSync(sharedPath, shared);
console.log('fixed detail imports');
