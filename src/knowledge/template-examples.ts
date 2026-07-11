export const sourceMetadataExample = `{
  "id": "src_whitepaper_example",
  "source_type": "whitepaper_pdf",
  "path": "knowledge/_sources/whitepapers/example.pdf",
  "sha256": "<file-hash>",
  "title": "Example Whitepaper",
  "downloaded_at": "2026-06-13T00:00:00.000Z",
  "source_url": "",
  "product_versions": [],
  "page_count": 0,
  "owner": "knowledge-admin",
  "ingest_tool_version": "manual-v1"
}
`;

export const evidenceChunkSchemaExample = `{"chunk_id":"chk_example_001","parent_id":"kb_whitepaper_general_example","source":"knowledge/whitepapers/README.md","source_document":"knowledge/_sources/whitepapers/example.pdf","source_document_id":"src_whitepaper_example","source_pages":[],"module":"general","intent":"product_rule","source_type":"whitepaper","status":"draft","confidence":"medium","headings":["示例白皮书切片","核心规则"],"keywords":["示例白皮书切片"],"text":"这里是派生检索 chunk 的文本。"}
`;
