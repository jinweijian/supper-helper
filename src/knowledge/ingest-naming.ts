import { createHash } from 'node:crypto';

export function inferModuleFromTitle(title: string, _kind: string): string {
  const text = title;
  if (/AI伴学|伴学助手|学习计划|督学提醒|题目答疑/.test(text)) {
    return 'ai-companion';
  }
  if (/EduSoho|教培|课程|班级|学员|教师|网校/.test(text)) {
    return 'edusoho-training';
  }
  return 'general';
}

export function safeSlug(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || 'doc';
}
