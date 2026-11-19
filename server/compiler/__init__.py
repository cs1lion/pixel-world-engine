"""Lore-to-World 资料编译器：把背景资料编译成 WorldBundle v1。

包含四块：
- providers.py：可插拔 LLM Provider（在线 OpenAI-compatible / 本地 Ollama）；
- schema.py：与前端 `world-client/src/world/bundle/validator.ts` 同构的校验器；
- world_compiler.py：编译主流程（生成 → 校验 → 违规回灌 → 最多 2 轮自修复）；
- cli.py：`python -m server.compiler.cli` 的轻量入口。

这一层不许碰世界内核的运行时行为：它只产出**校验过的** WorldBundle v1 JSON，
校验不过宁可报错，绝不输出半成品。
"""
