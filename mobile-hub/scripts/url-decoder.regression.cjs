const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const queryString = require('query-string');

test('Expo Router query parser retains Unicode, repeated keys and URL round trips', () => {
  assert.deepEqual({ ...queryString.parse('text=%D0%A2%D0%B5%D1%81%D1%82+%F0%9F%98%80&id=1&id=2&empty') }, {
    empty: null, id: ['1', '2'], text: 'Тест 😀',
  });
  const value = { conversation: 'chat/1', message: 'a+b&c', text: 'Ответ' };
  assert.deepEqual({ ...queryString.parse(queryString.stringify(value)) }, value);
});

test('malformed percent-encoded query input completes within a bounded subprocess', () => {
  execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const queryString = require('query-string');
    const malformed = '%FE'.repeat(10000);
    assert.equal(queryString.parse('value=' + malformed).value, malformed);
    assert.equal(queryString.parse('value=%E0%A4%A').value, '%E0%A4%A');
  `], { cwd: require('node:path').resolve(__dirname, '..'), timeout: 5000, stdio: 'pipe' });
});
