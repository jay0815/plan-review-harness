# Roadmap

## 当前阶段：评审系统稳定性

目标：确保 workspace review 流程可靠、可验证、可调试。

### 进度

- [x] manifest 机制：记录 inputs hash、declared runtime、resolved execution
- [x] 验证机制：verify-run 检查产物完整性、越界读取、fact check 严格度
- [x] 诊断机制：doctor-run 给出修复建议和优先级
- [x] backfill 机制：为旧版 run 补写 manifest
- [ ] 部分重试：按 reviewer 角粒度重试，而非整个阶段

## 下一阶段：评审质量提升

目标：提高 reviewer 输出的准确性和实用性。

### 待规划

- reviewer prompt 优化
- fact check 覆盖率提升
- synthesis 报告结构化改进
