import type { KnowledgeQualityIssue } from '../knowledge/index.js';
import type { OnboardingReviewIssue } from './types.js';

export function explainReviewIssue(issue: KnowledgeQualityIssue): OnboardingReviewIssue['explanation'] {
  switch (issue.code) {
    case 'not_answer_bearing':
      return {
        reason: '原因：这段内容没有可直接回答用户问题的完整句子。',
        impact: '影响：发布后也不能作为高置信知识直答依据，容易只命中标题或背景词。',
        suggestion: '建议：补充一两句明确的规则、条件、操作步骤或结论后再发布。',
        missingInfo: ['可回答问题的完整句子', '明确的规则或操作结论'],
      };
    case 'missing_source_block_ids':
      return {
        reason: '原因：切片缺少 source_block_ids，无法定位到原始文档中的具体块。',
        impact: '影响：后续答案无法回溯原文证据，Evidence Review 会降低或阻断直答。',
        suggestion: '建议：重新 normalize/slice，或人工补齐原文块来源后再发布。',
        missingInfo: ['source_block_ids', '原文块级 provenance'],
      };
    case 'missing_source_blocks':
      return {
        reason: '原因：切片引用的部分 source_block_ids 在当前原文块记录中不存在。',
        impact: '影响：证据链断裂，无法证明切片内容确实来自对应源文档。',
        suggestion: '建议：重新抽取来源文档，或移除/修正失效的 source_block_ids。',
        missingInfo: ['有效的 source_block_ids', '可匹配的原文块记录'],
      };
    case 'missing_source_document':
      return {
        reason: '原因：切片缺少 source_document 来源路径。',
        impact: '影响：用户追问来源时无法定位文件，发布后证据可审计性不足。',
        suggestion: '建议：重新导入来源文档，或人工补齐 source_document。',
        missingInfo: ['source_document'],
      };
    case 'missing_source_document_id':
      return {
        reason: '原因：切片缺少 source_document_id。',
        impact: '影响：审核记录、发布记录和来源块无法稳定关联。',
        suggestion: '建议：重新走 intake/slice 流程，或人工补齐对应 source id。',
        missingInfo: ['source_document_id'],
      };
    case 'missing_section_path':
      return {
        reason: '原因：切片缺少 section_path，无法知道内容属于原文哪一节。',
        impact: '影响：召回时章节上下文不足，相关问题可能命中但解释不完整。',
        suggestion: '建议：从标题层级继承 section_path，或人工补齐章节路径。',
        missingInfo: ['section_path'],
      };
    case 'too_short':
      return {
        reason: '原因：切片正文长度低于质量阈值，信息量偏少。',
        impact: '影响：可能只有片段词或短说明，无法支撑稳定答案。',
        suggestion: '建议：合并相邻短切片，或补充完整上下文后再发布。',
        missingInfo: ['更完整的上下文', '相邻段落或完整规则描述'],
      };
    case 'too_long':
      return {
        reason: '原因：切片正文超过父切片长度阈值。',
        impact: '影响：一个切片可能覆盖过多上下文，召回后答案范围不清。',
        suggestion: '建议：按标题、列表或表格边界拆分为更聚焦的切片。',
        missingInfo: ['更细的主题边界', '拆分后的章节结构'],
      };
    case 'multi_topic_slice':
      return {
        reason: '原因：一个切片里混入多个主题或多个不相干标题。',
        impact: '影响：用户问其中一个主题时，系统可能带出无关内容。',
        suggestion: '建议：按主题拆分，确保每个切片只回答一类问题。',
        missingInfo: ['单一主题范围', '拆分后的标题或章节'],
      };
    case 'broken_coreference':
      return {
        reason: '原因：切片中存在“上述/该功能/这里”等无法独立理解的指代。',
        impact: '影响：离开原文上下文后，读者无法判断指代对象。',
        suggestion: '建议：把指代对象补全成具体名词或保留必要前文。',
        missingInfo: ['指代对象', '必要前文上下文'],
      };
    case 'toc_like':
      return {
        reason: '原因：切片内容像目录、导航或条目列表，而不是可回答内容。',
        impact: '影响：目录类内容通常只能说明结构，不能回答业务问题。',
        suggestion: '建议：不发布该切片，或改用目录下的实质段落重新切片。',
        missingInfo: ['目录条目对应的正文内容'],
      };
    case 'heading_only':
      return {
        reason: '原因：切片主要是标题，缺少实质正文。',
        impact: '影响：只能命中标题，无法解释具体规则或操作。',
        suggestion: '建议：补充标题下正文，或和下一段内容合并。',
        missingInfo: ['标题下的正文说明'],
      };
    case 'empty_body':
      return {
        reason: '原因：切片没有有效正文。',
        impact: '影响：发布后不会提供可用知识，只会制造噪音。',
        suggestion: '建议：不发布该切片，或重新从源文档抽取有效段落。',
        missingInfo: ['有效正文'],
      };
    case 'duplicate_content':
      return {
        reason: '原因：切片内容和另一个切片重复。',
        impact: '影响：重复知识会稀释召回结果，增加互相竞争的证据。',
        suggestion: '建议：只保留来源更完整、标题更准确的一条。',
        missingInfo: ['需要保留的权威版本'],
      };
    case 'low_signal_terms':
      return {
        reason: '原因：related_terms 数量不足，检索提示词偏少。',
        impact: '影响：用户用别名或业务词搜索时可能召回不到。',
        suggestion: '建议：补充产品名、功能名、常见问法和同义词。',
        missingInfo: ['related_terms', '常见业务别名'],
      };
    case 'source_provenance_missing':
      return {
        reason: '原因：源文档元数据缺少 sha256 或存储路径。',
        impact: '影响：无法证明内容来自哪个版本的源文件。',
        suggestion: '建议：重新 intake 源文件，生成完整 source metadata。',
        missingInfo: ['源文件 sha256', '源文件存储路径'],
      };
    case 'parser_empty':
    case 'too_many_unknown_blocks':
    case 'table_lost':
    case 'list_structure_lost':
    case 'heading_structure_broken':
    case 'toc_not_removed':
    case 'header_footer_noise':
    case 'duplicate_paragraphs':
    case 'missing_parent':
    case 'orphan_chunk':
      return {
        reason: `原因：质量审计发现 ${issue.code}，说明抽取、结构或索引链路存在异常。`,
        impact: '影响：该内容直接发布后可能缺上下文、结构错误或无法回溯。',
        suggestion: '建议：先检查源文档抽取/标准化报告，必要时重新处理或人工修正。',
        missingInfo: ['完整抽取结构', '可审计的来源和章节信息'],
      };
    default:
      return {
        reason: `原因：质量审计标记了 ${issue.code}。`,
        impact: '影响：该切片暂不满足自动发布质量门禁。',
        suggestion: '建议：按审计消息检查内容和来源后，再选择发布、退回或不发布。',
        missingInfo: ['人工审核结论'],
      };
  }
}
