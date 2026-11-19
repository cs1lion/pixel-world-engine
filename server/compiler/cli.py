"""轻量 CLI：`python -m server.compiler.cli`。

两种用法：

1. 编译：读本地背景资料文本文件，调 Provider 生成 WorldBundle v1 JSON，
   校验通过才写出（默认打到 stdout）：

       python -m server.compiler.cli 资料.txt --cast 7 --out bundle.json
       python -m server.compiler.cli 资料.txt --provider ollama --model qwen2.5:7b

   默认走本地 Ollama（离线/本机即可跑）；`--provider openai` 走在线
   OpenAI-compatible 接口（API Key 走 --api-key 或 LLM_API_KEY）。

2. 只校验：不带模型、纯离线地校验一份已有的 WorldBundle JSON：

       python -m server.compiler.cli --validate bundle.json

退出码：0 = 成功；1 = 编译失败（报告里有全部违规）；2 = 输入/用法错误；
3 = 被校验的 bundle 不合法。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .providers import OllamaProvider, OpenAIProvider, Provider, ProviderError
from .schema import validate_world_bundle
from .world_compiler import WorldCompiler, WorldCompileError

OLLAMA_DEFAULT_URL = "http://localhost:11434"
OLLAMA_DEFAULT_MODEL = "qwen2.5:7b"
OPENAI_DEFAULT_URL = "https://api.openai.com/v1"


def build_provider(args: argparse.Namespace) -> Provider:
    if args.provider == "ollama":
        return OllamaProvider(
            model=args.model or OLLAMA_DEFAULT_MODEL,
            base_url=args.base_url or OLLAMA_DEFAULT_URL,
            timeout=args.timeout,
        )
    api_key = args.api_key or os.environ.get("LLM_API_KEY", "")
    if not api_key:
        raise ValueError("openai provider 需要 --api-key 或 LLM_API_KEY 环境变量")
    return OpenAIProvider(
        api_key=api_key,
        model=args.model or os.environ.get("LLM_MODEL") or "gpt-4o-mini",
        base_url=args.base_url or os.environ.get("LLM_BASE_URL") or OPENAI_DEFAULT_URL,
        timeout=args.timeout,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="server.compiler.cli", description="Lore-to-World 资料编译器")
    parser.add_argument("input", nargs="?", help="背景资料文本文件（200–2000 字）")
    parser.add_argument("--cast", type=int, default=5, help="目标居民人数 N（默认 5）")
    parser.add_argument("--out", help="输出 WorldBundle v1 JSON 的路径；省略则打印到 stdout")
    parser.add_argument("--provider", choices=["ollama", "openai"], default="ollama", help="模型 Provider（默认 ollama，本地离线可用）")
    parser.add_argument("--base-url", help="Provider 地址；默认按 provider 取本地 Ollama / OpenAI")
    parser.add_argument("--model", help="模型名；默认按 provider 取 qwen2.5:7b / gpt-4o-mini")
    parser.add_argument("--api-key", help="OpenAI-compatible 的 API Key（也可走 LLM_API_KEY）")
    parser.add_argument("--timeout", type=float, default=120.0, help="模型调用超时秒数（默认 120）")
    parser.add_argument("--validate", metavar="BUNDLE_JSON", help="只校验一份已有的 WorldBundle JSON，不调模型")
    return parser


def _reconfigure_stdio() -> None:
    """Windows 控制台默认 GBK，而这份 CLI 的输出全是中文。

    不切成 UTF-8，报的会是一个跟编译毫无关系的编码错误（与 `main.py` 同一条纪律）。
    """
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def main(argv: list[str] | None = None) -> int:
    _reconfigure_stdio()
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.validate is not None:
        return _validate_file(args.validate)

    if args.input is None:
        parser.error("需要 input 文本文件，或改用 --validate 校验已有 JSON")

    try:
        text = Path(args.input).read_text(encoding="utf-8")
    except OSError as exc:
        print(f"读不了 {args.input}：{exc}", file=sys.stderr)
        return 2

    try:
        provider = build_provider(args)
    except ValueError as exc:
        print(f"输入不合法：{exc}", file=sys.stderr)
        return 2
    compiler = WorldCompiler(provider)
    try:
        bundle = compiler.compile(text, args.cast)
    except ProviderError as exc:
        print(f"模型不可用：{exc}", file=sys.stderr)
        return 1
    except WorldCompileError as exc:
        print(exc.report["message"], file=sys.stderr)
        for violation in exc.report["violations"]:
            print(f"  - [{violation['code']}] {violation['path']}: {violation['message']}", file=sys.stderr)
        print("最后一轮模型原文（截断）：", file=sys.stderr)
        print(exc.report["lastReply"], file=sys.stderr)
        return 1
    except ValueError as exc:
        print(f"输入不合法：{exc}", file=sys.stderr)
        return 2

    rendered = json.dumps(bundle, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(rendered + "\n", encoding="utf-8")
        print(f"已写出 {args.out}", file=sys.stderr)
    else:
        print(rendered)
    return 0


def _validate_file(path: str) -> int:
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"读不了 {path}：{exc}", file=sys.stderr)
        return 3
    result = validate_world_bundle(raw)
    if result["ok"]:
        print("OK：这份 WorldBundle v1 通过校验")
        return 0
    for violation in result["violations"]:
        print(f"  - [{violation['code']}] {violation['path']}: {violation['message']}")
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
