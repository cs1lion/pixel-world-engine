"""造物主：一句话进来，白名单命令出去。

三层，各自可单测：

    orchestrator.interpret()   调模型，拿回原始 JSON
    rules.schema.validate_*    白名单与取值域
    oracle.wire                白名单命令 → 客户端能执行的意图

**失败一律 `ok: false`，绝不猜。** 模型超时、返回非 JSON、命令越界——
这三种在用户眼里是同一件事：这句话没被听懂。退而求其次猜一个，
就是在替用户做决定，而世界不撒谎的底线正是「没做就是没做」。

模型调用通过 `ModelCaller` 注入。所以这个模块的全部逻辑都能离线测，
不需要 API Key，也不需要网络。
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Protocol

from oracle.prompt import build_messages
from rules.schema import Command, CommandRejected, validate_commands

#: P0 一次请求只表达一个世界动作。多命令必须由调用方拆成多次请求，
#: 不能由端点悄悄只执行第一条。
MAX_COMMANDS = 1

#: 一句话最多多长。再长的输入不是神谕，是一篇文章。
MAX_UTTERANCE_CHARS = 500


class ModelUnavailable(RuntimeError):
    """没有配置模型。端点把它转成 503。"""


class ModelFailed(RuntimeError):
    """模型调用失败（超时、网络、HTTP 错）。

    2026-10-28 补记：这句原来写「端点转成 502」。**没有 502。**
    `interpret()` 捕它之后 `return _failure("model-failed", str(exc))`，
    `ok=False`，于是 `api.py:_envelope` 落 **HTTP 200 + unknown**。
    同一个类里 `ModelUnavailable` 才是被重新抛出去的那个，转 503。
    真正回到调用方面前的失败面见 `oracle/api.py` 顶部那张三行表。
    """


class ModelCaller(Protocol):
    """调一次模型，返回它的原始文本。"""

    def __call__(self, messages: list[dict[str, str]]) -> str: ...


@dataclass(frozen=True)
class Interpretation:
    """一次解析的结果。成功与失败**同一种形状**，调用方不必分支处理异常。"""

    ok: bool
    commands: list[Command] = field(default_factory=list)
    narrative: str = ""
    error: str | None = None
    #: 错误码。`None` 表示成功。稳定的字符串，给实验统计用。
    code: str | None = None

    def to_json(self) -> dict[str, Any]:
        body: dict[str, Any] = {
            "ok": self.ok,
            "commands": [command.to_json() for command in self.commands],
            "narrative": self.narrative,
        }
        if self.error is not None:
            body["error"] = self.error
        if self.code is not None:
            body["code"] = self.code
        return body


def _failure(code: str, error: str) -> Interpretation:
    return Interpretation(ok=False, narrative="", error=error, code=code)


def interpret(
    utterance: str,
    templates: list[dict[str, Any]],
    context: dict[str, Any] | None,
    caller: ModelCaller,
    world: dict[str, Any] | None = None,
) -> Interpretation:
    """把一句话翻成命令。永不抛错——失败是 `ok: false` 的一个结果。"""
    text = utterance.strip()
    if text == "":
        return _failure("empty-utterance", "空句子")
    if len(text) > MAX_UTTERANCE_CHARS:
        return _failure(
            "utterance-too-long",
            f"这句话太长了（{len(text)} 字），最多 {MAX_UTTERANCE_CHARS} 字",
        )
    if not isinstance(templates, list) or not templates:
        return _failure("no-templates", "没有模板表，模型不知道该能建什么")

    try:
        reply = caller(build_messages(templates, text, context))
    except ModelUnavailable:
        raise
    except ModelFailed as exc:
        return _failure("model-failed", str(exc))
    except Exception as exc:  # pragma: no cover - 兜底，别让意外炸到端点
        return _failure("model-failed", f"模型调用失败：{exc}")

    return parse_reply(reply, world)


def parse_reply(reply: str, world: dict[str, Any] | None = None) -> Interpretation:
    """把模型的原话变成 `Interpretation`。**非 JSON 就是没听懂，不猜。**

    模型很爱在 JSON 外面裹一层 ```json 代码块。剥掉它是合理的宽容——
    那不是形状错误，是包裹；而包裹里的东西仍然要过白名单。
    """
    body = extract_json(reply)
    if body is None:
        return _failure("not-json", "模型返回的不是 JSON，没法当命令用")

    if not isinstance(body, dict):
        return _failure("not-an-object", "模型返回的 JSON 不是对象")

    narrative = body.get("narrative", "")
    if not isinstance(narrative, str):
        narrative = ""

    raw_commands = body.get("commands")
    if raw_commands is None:
        # 只有 narrative 也算「听懂了但不动」——模型在说这句话不是命令。
        return Interpretation(ok=True, commands=[], narrative=narrative)
    if not isinstance(raw_commands, list):
        return _failure("not-an-array", "commands 必须是数组")
    if len(raw_commands) > MAX_COMMANDS:
        return _failure(
            "too-many-commands",
            f"一次最多 {MAX_COMMANDS} 条命令，收到 {len(raw_commands)} 条",
        )
    if not raw_commands:
        return Interpretation(ok=True, commands=[], narrative=narrative)

    try:
        commands = validate_commands(raw_commands, world)
    except CommandRejected as exc:
        return _failure(exc.code, exc.message)

    return Interpretation(ok=True, commands=commands, narrative=narrative)


#: ```json ... ``` 或 ``` ... ```。模型最常见的包裹方式。
_FENCE = re.compile(r"^\s*```(?:json)?\s*\n?(.*?)\n?\s*```\s*$", re.DOTALL)


def extract_json(reply: str) -> Any | None:
    """从模型回复里挖出 JSON。挖不出返回 `None`。

    只做两件事：剥代码块围栏、去掉前后空白。**不去猜哪里有 JSON**——
    从一段散文里截出花括号是最坏的做法，它会把「我觉得可以这样」里的
    括号当成 JSON 的开始，然后世界执行了一段谁也没说过的命令。
    """
    text = reply.strip()
    match = _FENCE.match(text)
    if match is not None:
        text = match.group(1).strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None


# ---------------------------------------------------------------- 真实模型


def env_caller() -> ModelCaller:
    """按环境变量造一个真实调用者。**没配 Key 就抛 `ModelUnavailable`。**

    用 OpenAI 兼容的 chat/completions：StepFun、DeepSeek、自建网关都是这个形状。
    换成别的协议只需再写一个 `ModelCaller`，`interpret` 不用动。
    """
    api_key = os.environ.get("LLM_API_KEY", "").strip()
    if not api_key:
        raise ModelUnavailable("未配置 LLM_API_KEY，意图模型不可用")

    base_url = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = os.environ.get("LLM_MODEL", "gpt-4o-mini")
    timeout = float(os.environ.get("LLM_TIMEOUT_SECONDS", "8"))

    def call(messages: list[dict[str, str]]) -> str:
        import httpx

        try:
            response = httpx.post(
                f"{base_url}/chat/completions",
                headers={"authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    # 温度 0：意图解析要的是稳定，不是文采。同一句话两次问出
                    # 不同答案的系统没法测试，也没法解释。
                    "temperature": 0,
                    "messages": messages,
                },
                timeout=timeout,
            )
        except httpx.TimeoutException as exc:
            raise ModelFailed(f"模型超时 {timeout}s") from exc
        except httpx.HTTPError as exc:
            raise ModelFailed(f"模型不可达：{exc}") from exc

        if response.status_code >= 400:
            raise ModelFailed(f"模型返回 {response.status_code}：{response.text[:200]}")

        try:
            body = response.json()
            return body["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ModelFailed(f"模型返回的形状不认识：{exc}") from exc

    return call
