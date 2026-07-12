import { expect, test } from '@playwright/test';

test('Dashboard uses production assets and real Gateway workflows', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/')) requests.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'super helper 首页' })).toBeVisible();
  await page.getByRole('button', { name: '新建诊断' }).click();
  await expect(page).toHaveURL(/\/sessions\/case_/);
  await page.reload();
  await expect(page.getByRole('heading', { name: '新对话' })).toBeVisible();
  await page.getByLabel('输入问题').fill('请检查当前项目状态');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('helper', { exact: true })).toBeVisible();
  expect(requests.filter((request) => request === 'GET /api/knowledge/health')).toHaveLength(0);
  await page.getByRole('tab', { name: '知识健康' }).click();
  await page.getByRole('button', { name: '测试检索' }).click();
  await expect.poll(() => requests.filter((request) => request === 'GET /api/knowledge/health').length).toBe(1);

  const logButton = page.getByRole('button', { name: '日志', exact: true });
  await logButton.click();
  await expect(page.getByRole('dialog', { name: '诊断日志' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '诊断日志' })).toBeHidden();
  await expect(logButton).toBeFocused();

  const settingsButton = page.getByRole('button', { name: '配置', exact: true });
  await settingsButton.click();
  await expect(page.getByRole('dialog', { name: '配置' })).toBeVisible();
  await expect(page.getByText('配置已加载')).toBeVisible();
  const baseUrl = page.getByLabel('Base URL', { exact: true });
  const model = page.getByLabel('模型', { exact: true });
  await baseUrl.fill('https://api.example.test/v1');
  await model.fill('e2e-model');
  await expect(baseUrl).toHaveValue('https://api.example.test/v1');
  await expect(model).toHaveValue('e2e-model');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText('模型配置已保存')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settingsButton).toBeFocused();

  expect(requests).toEqual(expect.arrayContaining([
    'POST /api/sessions', 'POST /api/chat', 'GET /api/session', 'GET /api/knowledge/health', 'GET /api/logs', 'GET /api/settings', 'POST /api/settings/model',
  ]));
});

test('Setup saves draft, validates, receives progress, reviews, and retries', async ({ page }) => {
  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: 'QuickStart：一键配置' })).toBeVisible();
  await page.getByLabel('项目目录').fill('/tmp/e2e-project');
  await page.getByLabel('知识库目录').fill('/tmp/e2e-knowledge');
  await page.getByLabel('知识源目录').fill('/tmp/e2e-sources');
  await page.getByRole('button', { name: '检查并执行' }).click();
  await expect(page.getByText('failed', { exact: true })).toBeVisible();
  await expect(page.getByText('内容摘要：登录失败时先核对账号状态。')).toBeVisible();
  await expect(page.getByText('原因：内容较短，需要人工确认是否足以回答问题。').first()).toBeVisible();
  await expect(page.getByText('处理完成后才能进入 Dashboard', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '全选本页' }).click();
  await expect(page.getByText('已选 2 / 本页 2 条')).toBeVisible();
  await page.getByRole('button', { name: '发布选中', exact: true }).click();
  await page.getByRole('button', { name: '从失败阶段重试' }).click();
  await expect(page.getByText('completed', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '进入 Dashboard' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'super helper 首页' })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'super helper 首页' })).toBeVisible();
});
