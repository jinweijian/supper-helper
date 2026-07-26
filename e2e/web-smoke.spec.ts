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
  await expect(page.getByRole('status')).toContainText('已耗时');
  await expect(page.getByRole('status')).toContainText('估计');
  await expect(page.getByText('helper', { exact: true })).toBeVisible();
  await expect(page.getByText('项目状态可以继续检查。').first()).toBeVisible();
  await expect(page.getByText('worker-secret-output')).toHaveCount(0);
  expect(requests.filter((request) => request === 'GET /api/knowledge/health')).toHaveLength(1);
  await page.getByRole('tab', { name: '知识健康' }).click();
  await page.getByRole('button', { name: '测试检索' }).click();
  await expect.poll(() => requests.filter((request) => request === 'GET /api/knowledge/health').length).toBe(2);

  const logButton = page.getByRole('button', { name: '日志', exact: true });
  await logButton.click();
  await expect(page.getByRole('dialog', { name: '诊断日志' })).toBeVisible();
  await expect(page.locator('details.log-card').first()).toBeVisible();
  await page.getByRole('button', { name: '全部收起' }).click();
  await expect(page.locator('details.log-card[open]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '诊断日志' })).toBeHidden();
  await expect(logButton).toBeFocused();

  const settingsButton = page.getByRole('button', { name: '配置', exact: true });
  await settingsButton.click();
  await expect(page.getByRole('dialog', { name: '配置' })).toBeVisible();
  await expect(page.getByText('配置已加载')).toBeVisible();
  const modelGroup = page.getByRole('group', { name: 'Agent 模型' });
  const baseUrl = modelGroup.getByLabel('Base URL', { exact: true });
  const model = modelGroup.getByLabel('模型', { exact: true });
  await baseUrl.fill('http://127.0.0.1:1/v1');
  await model.fill('e2e-model');
  await expect(baseUrl).toHaveValue('http://127.0.0.1:1/v1');
  await expect(model).toHaveValue('e2e-model');
  await page.getByRole('button', { name: '测试模型', exact: true }).click();
  await expect(modelGroup.locator('.status-banner')).not.toHaveText('');
  await page.getByRole('button', { name: '保存模型' }).click();
  await expect(page.getByText('模型配置已保存')).toBeVisible();
  await page.getByRole('button', { name: '保存 Embedding' }).click();
  await expect(page.getByText('Embedding 配置已保存')).toBeVisible();
  await page.getByRole('button', { name: '保存 Rerank' }).click();
  await expect(page.getByText('Rerank 配置已保存')).toBeVisible();
  await page.getByRole('button', { name: '保存 Claude' }).click();
  await expect(page.getByText('Claude 配置已保存')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settingsButton).toBeFocused();

  expect(requests).toEqual(expect.arrayContaining([
    'POST /api/sessions', 'POST /api/chat', 'GET /api/session', 'GET /api/knowledge/health', 'GET /api/logs', 'GET /api/settings', 'GET /api/agents', 'POST /api/settings/model/test', 'POST /api/settings/model', 'POST /api/settings/embedding', 'POST /api/settings/rerank', 'POST /api/settings/claude',
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

test('Greeting does not trigger false interruption', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建诊断' }).click();
  await expect(page).toHaveURL(/\/sessions\/case_/);
  await page.getByLabel('输入问题').fill('你好');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('helper', { exact: true })).toBeVisible();
  await expect(page.getByText(/具体问题|报错|功能异常/).first()).toBeVisible();
  await expect(page.getByText('回答已中断')).toBeHidden();
});

test('transient terminal snapshot waits for the matching helper reply', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建诊断' }).click();
  await expect(page).toHaveURL(/\/sessions\/case_/);

  let transientSnapshotServed = false;
  await page.route((url) => url.pathname === '/api/session', async (route) => {
    if (transientSnapshotServed) {
      await route.continue();
      return;
    }

    const response = await route.fetch();
    const body = await response.json();
    const currentUserMessage = [...(body.session?.messages ?? [])]
      .reverse()
      .find((message: { role: string }) => message.role === 'user');
    if (!body.session || !currentUserMessage) {
      await route.fulfill({ response, body: JSON.stringify(body) });
      return;
    }

    transientSnapshotServed = true;
    body.session.status = 'partial';
    body.session.messages = body.session.messages.filter(
      (message: { role: string; replyToMessageId?: string }) =>
        !(message.role === 'helper' && message.replyToMessageId === currentUserMessage.id),
    );
    await route.fulfill({ response, body: JSON.stringify(body) });
  });

  await page.getByLabel('输入问题').fill('请检查当前项目状态');
  await page.getByRole('button', { name: '发送' }).click();

  const conversation = page.getByRole('main');
  await expect(conversation.getByText('回答已中断')).toBeHidden();
  await expect(conversation.getByText('项目状态可以继续检查。').first()).toBeVisible();
  expect(transientSnapshotServed).toBe(true);
});

test('Retryable interruption shows retry button and retries original turn', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建诊断' }).click();
  await expect(page).toHaveURL(/\/sessions\/case_/);
  await page.getByLabel('输入问题').fill('请检查当前项目状态');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('main').getByText('项目状态可以继续检查。').first()).toBeVisible();

  let retryBody: { caseId?: string; userMessageId?: string } | undefined;
  let originalUserMessageId = '';
  const isSessionRequest = (url: URL) => url.pathname === '/api/session';
  await page.route(isSessionRequest, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.session) {
      const userMsg = [...body.session.messages].reverse().find((m: { role: string }) => m.role === 'user');
      originalUserMessageId = userMsg?.id ?? 'msg_retry_test';
      body.session.retryableTurn = {
        userMessageId: originalUserMessageId,
        interruptedAt: new Date().toISOString(),
        reason: 'service_restarted',
      };
      body.session.status = 'partial';
      body.session.messages = body.session.messages.filter((m: { role: string; replyToMessageId?: string }) => !(m.role === 'helper' && m.replyToMessageId === userMsg?.id));
      body.session.messages.push({
        id: 'msg_interruption_placeholder',
        role: 'helper',
        body: '这个回合因服务重启被中断。',
        replyToMessageId: originalUserMessageId,
        createdAt: new Date().toISOString(),
      });
    }
    await route.fulfill({ response, body: JSON.stringify(body) });
  });

  await page.route('**/api/chat/retry', async (route) => {
    retryBody = route.request().postDataJSON();
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        accepted: true,
        caseId: retryBody?.caseId,
        userMessageId: retryBody?.userMessageId,
      }),
    });
  });

  await page.reload();
  await expect(page.getByRole('button', { name: '一键重试' })).toBeVisible({ timeout: 15_000 });

  await page.unroute(isSessionRequest);
  await page.getByRole('button', { name: '一键重试' }).click();
  expect(retryBody).toEqual({
    caseId: expect.stringMatching(/^case_/),
    userMessageId: originalUserMessageId,
  });
  await expect(page.getByRole('main').getByText('项目状态可以继续检查。').first()).toBeVisible({ timeout: 10_000 });
});
