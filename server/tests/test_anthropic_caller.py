"""env_caller 的 Anthropic Messages 协议分支。

背景（2026-11-10 实测）：`LLM_BASE_URL=…/anthropic` 的网关只有 `/v1/messages`，
`/chat/completions` 回 404；且模型是带思考的，`content[0]` 是 `thinking` 块，
真正的答案在后面的 `text` 块里。只会 OpenAI 形状的旧调用者在这里要么 404，
要么把 thinking 当答案。
"""

from __future__ import annotations

import httpx
import pytest

from oracle import orchestrator


class _Resp:
    def __init__(self, status: int, body: dict):
        self.status_code = status
        self._body = body
        self.text = str(body)

    def json(self):
        return self._body


def _capture(monkeypatch, response: _Resp):
    seen: dict = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        seen.update(url=url, headers=headers, json=json, timeout=timeout)
        return response

    monkeypatch.setattr(httpx, "post", fake_post)
    return seen


def _env(monkeypatch, base: str, protocol: str | None = None):
    monkeypatch.setenv("LLM_API_KEY", "sk-test")
    monkeypatch.setenv("LLM_BASE_URL", base)
    monkeypatch.setenv("LLM_MODEL", "m")
    if protocol is None:
        monkeypatch.delenv("LLM_PROTOCOL", raising=False)
    else:
        monkeypatch.setenv("LLM_PROTOCOL", protocol)


MESSAGES = [{"role": "system", "content": "规则"}, {"role": "user", "content": "涨潮"}]
OK = {"content": [{"type": "thinking", "thinking": "想一想"}, {"type": "text", "text": "{\"ok\":1}"}]}


def test_anthropic结尾的地址走_messages_且取_text_块不取_thinking(monkeypatch):
    _env(monkeypatch, "https://gw.example/anthropic")
    seen = _capture(monkeypatch, _Resp(200, OK))
    assert orchestrator.env_caller()(MESSAGES) == '{"ok":1}'
    assert seen["url"] == "https://gw.example/anthropic/v1/messages"
    assert seen["headers"]["x-api-key"] == "sk-test"
    assert seen["json"]["system"] == "规则"
    assert seen["json"]["messages"] == [{"role": "user", "content": "涨潮"}]
    assert seen["json"]["max_tokens"] >= 2048  # 思考模型：太小会在思考里耗光、没有 text 块


def test_显式_protocol_覆盖按地址的推断(monkeypatch):
    _env(monkeypatch, "https://gw.example/anthropic", protocol="openai")
    seen = _capture(monkeypatch, _Resp(200, {"choices": [{"message": {"content": "x"}}]}))
    assert orchestrator.env_caller()(MESSAGES) == "x"
    assert seen["url"].endswith("/chat/completions")


def test_默认仍是_openai_形状(monkeypatch):
    _env(monkeypatch, "https://api.openai.com/v1")
    seen = _capture(monkeypatch, _Resp(200, {"choices": [{"message": {"content": "x"}}]}))
    orchestrator.env_caller()(MESSAGES)
    assert seen["url"].endswith("/chat/completions")


def test_只有_thinking_没有_text_是模型失败不是空答案(monkeypatch):
    _env(monkeypatch, "https://gw.example/anthropic")
    _capture(monkeypatch, _Resp(200, {"content": [{"type": "thinking", "thinking": "…"}]}))
    with pytest.raises(orchestrator.ModelFailed):
        orchestrator.env_caller()(MESSAGES)


def test_4xx_是模型失败(monkeypatch):
    _env(monkeypatch, "https://gw.example/anthropic")
    _capture(monkeypatch, _Resp(401, {"error": "bad key"}))
    with pytest.raises(orchestrator.ModelFailed):
        orchestrator.env_caller()(MESSAGES)
