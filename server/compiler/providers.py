"""可插拔 LLM Provider：在线 OpenAI-compatible 与本地 Ollama 两种实现。

两种 Provider 对编译器呈现同一个形状——`complete(prompt) -> str`，编译器
不关心答案从哪来。区别只在请求载荷：

- OpenAI-compatible：POST {base_url}/chat/completions，messages 数组，温度 0；
- Ollama：POST {base_url}/api/generate，`format: "json"` 让模型直接吐 JSON、
  `stream: false` 拿整段回答，答案在 `response` 字段里。

响应清洗（去 markdown 围栏、去前后散文）由 `clean_json_text` 统一做：
模型经常把 JSON 包在 ```json 围栏里或前后加一句闲话，两边都兼容。
"""

from __future__ import annotations

import re
from typing import Any, Protocol

import httpx


class ProviderError(RuntimeError):
    """模型调用失败：超时、不可达、回答形状不认识。"""


class Provider(Protocol):
    def complete(self, prompt: str) -> str: ...


def clean_json_text(text: str) -> str:
    """从模型回答里抽出 JSON 本体。

    顺序：去首尾空白 → 剥 ``` 围栏（带不带 json 标记都认）→ 截第一个 { 到
    最后一个 }。都凑不齐就把剩下的原文交还给 json.loads，让它报真实的错。
    """
    value = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)\s*```", value, re.DOTALL)
    if fence is not None:
        value = fence.group(1).strip()
    start = value.find("{")
    end = value.rfind("}")
    if start != -1 and end > start:
        value = value[start : end + 1]
    return value


def ollama_payload(model: str, prompt: str, format_json: bool = True) -> dict[str, Any]:
    """Ollama /api/generate 的载荷。format: "json" 是 Ollama 的结构化输出开关。"""
    return {
        "model": model,
        "prompt": prompt,
        "format": "json" if format_json else "",
        "stream": False,
    }


def _post(url: str, headers: dict[str, str], payload: dict[str, Any], timeout: float) -> Any:
    try:
        response = httpx.post(url, headers=headers, json=payload, timeout=timeout)
    except httpx.TimeoutException as exc:
        raise ProviderError(f"模型超时 {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise ProviderError(f"模型不可达：{exc}") from exc
    if response.status_code >= 400:
        raise ProviderError(f"模型返回 {response.status_code}：{response.text[:200]}")
    return response


class OpenAIProvider:
    """在线 OpenAI-compatible 接口：StepFun / DeepSeek / 自建网关都是这个形状。"""

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4o-mini",
        base_url: str = "https://api.openai.com/v1",
        timeout: float = 30.0,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def complete(self, prompt: str) -> str:
        response = _post(
            f"{self.base_url}/chat/completions",
            {"authorization": f"Bearer {self.api_key}", "content-type": "application/json"},
            {
                "model": self.model,
                # 温度 0：编译要的是稳定，不是文采。同一份资料两次编译应同形。
                "temperature": 0,
                "messages": [{"role": "user", "content": prompt}],
            },
            self.timeout,
        )
        try:
            return response.json()["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ProviderError(f"模型返回的形状不认识：{exc}") from exc


class OllamaProvider:
    """本地 Ollama：Qwen 等模型，format: "json" 直接要结构化 JSON 输出。"""

    def __init__(
        self,
        model: str = "qwen2.5:7b",
        base_url: str = "http://localhost:11434",
        timeout: float = 120.0,
    ) -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def complete(self, prompt: str) -> str:
        response = _post(
            f"{self.base_url}/api/generate",
            {"content-type": "application/json"},
            ollama_payload(self.model, prompt),
            self.timeout,
        )
        data = response.json()
        try:
            return data["response"] or ""
        except (KeyError, TypeError) as exc:
            raise ProviderError(f"Ollama 返回的形状不认识：{exc}") from exc
