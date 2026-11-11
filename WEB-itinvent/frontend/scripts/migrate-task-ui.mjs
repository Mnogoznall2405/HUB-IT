import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../src/components/hub');
const srcPath = path.join(root, 'TaskUi.jsx');
const detailDir = path.join(root, 'tasks/detail');
fs.mkdirSync(detailDir, { recursive: true });
const lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/);

const sharedHeader = lines.slice(0, 55).join('\n');
const sharedBody = [
  ...lines.slice(55, 108),
  '',
  ...lines.slice(551, 684),
].join('\n');

fs.writeFileSync(path.join(detailDir, 'taskDetailShared.jsx'), `${sharedHeader}\n\n${sharedBody}\n`);

const sharedImports = `import {
  clampTextSx,
  renderKvRows,
  renderObserverBlock,
  getTaskUserLabel,
  getChecklistStats,
  getTaskViewCount,
  getTaskLikeCount,
  formatMobileDueText,
  TaskMobilePersonRow,
  TaskMobileRailButton,
} from './taskDetailShared';\n\n`;

const components = [
  ['TaskDetailHeader', 110, 376],
  ['TaskMobileDetailScreen', 686, 1012],
  ['TaskMobileChecklistScreen', 1014, 1148],
  ['TaskPrimaryActions', 1150, 1334],
  ['TaskContextSidebar', 1336, 1544],
  ['TaskActivityTabs', 1546, 1789],
  ['TaskPreviewDrawer', 1791, 2043],
];

for (const [name, start, end] of components) {
  const body = lines.slice(start - 1, end).join('\n');
  fs.writeFileSync(
    path.join(detailDir, `${name}.jsx`),
    `${sharedHeader}\n${sharedImports}${body}\n`,
  );
}

const index = components.map(([name]) => `export { ${name} } from './${name}.jsx';`).join('\n');
fs.writeFileSync(path.join(detailDir, 'index.js'), `${index}\n`);

const taskUiReexports = `export {
  TASK_DETAIL_TABS,
  getDefaultTaskDetailTab,
  normalizeTaskDetailTab,
} from '../../lib/taskNavigation';

export { TaskDetailHeader } from './tasks/detail/TaskDetailHeader.jsx';
export { TaskMobileDetailScreen } from './tasks/detail/TaskMobileDetailScreen.jsx';
export { TaskMobileChecklistScreen } from './tasks/detail/TaskMobileChecklistScreen.jsx';
export { TaskPrimaryActions } from './tasks/detail/TaskPrimaryActions.jsx';
export { TaskContextSidebar } from './tasks/detail/TaskContextSidebar.jsx';
export { TaskActivityTabs } from './tasks/detail/TaskActivityTabs.jsx';
export { TaskPreviewDrawer } from './tasks/detail/TaskPreviewDrawer.jsx';

${lines.slice(377, 550).join('\n')}
`;
fs.writeFileSync(srcPath, taskUiReexports);
console.log('TaskUi migration complete');
