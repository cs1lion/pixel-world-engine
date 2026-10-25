"""`oracle/env_file.py`：把 `.env` 装进环境变量。

这个加载器只有三十行，但它碰的是**密钥**。所以三条纪律各有一条测试：
不覆盖已有的、不把引号带进去、文件不存在也不炸。
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from oracle.env_file import load_env


@pytest.fixture
def env_file(tmp_path: Path):
    def write(text: str) -> Path:
        path = tmp_path / ".env"
        path.write_text(text, encoding="utf-8")
        return path

    return write


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    """每个用例开始前把可能踩到的键清掉，结束时 pytest 会还原。"""
    for key in ("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "SOME_OTHER"):
        monkeypatch.delenv(key, raising=False)


def test_读到文件里的键值(env_file) -> None:
    path = env_file("LLM_API_KEY=sk-test\nLLM_MODEL=glm-4\n")
    loaded = load_env(path)
    assert loaded == ["LLM_API_KEY", "LLM_MODEL"]
    assert os.environ["LLM_API_KEY"] == "sk-test"
    assert os.environ["LLM_MODEL"] == "glm-4"


def test_不覆盖已经存在的环境变量(env_file, monkeypatch) -> None:
    """显式设的比仓库目录里的文件更权威——CI 与容器靠这条。"""
    monkeypatch.setenv("LLM_API_KEY", "从环境来的")
    path = env_file("LLM_API_KEY=从文件来的\n")
    loaded = load_env(path)
    assert loaded == [], "已存在的不该出现在「这次新设」名单里"
    assert os.environ["LLM_API_KEY"] == "从环境来的"


def test_成对引号被剥掉(env_file) -> None:
    """`LLM_API_KEY="sk-..."` 是 shell 里很常见的写法。把引号原样带进
    请求头会得到一个没人看得懂的 401。"""
    path = env_file('LLM_API_KEY="sk-quoted"\nLLM_MODEL=\'glm\'\n')
    load_env(path)
    assert os.environ["LLM_API_KEY"] == "sk-quoted"
    assert os.environ["LLM_MODEL"] == "glm"


def test_只有一边的引号原样留着(env_file) -> None:
    """不配对的引号不是引号，是值的一部分。猜它是错的。"""
    path = env_file('LLM_API_KEY="sk-broken\n')
    load_env(path)
    assert os.environ["LLM_API_KEY"] == '"sk-broken'


def test_注释与空行被跳过(env_file) -> None:
    path = env_file("# 这是注释\n\nLLM_MODEL=glm\n   \n# 又一条注释\n")
    assert load_env(path) == ["LLM_MODEL"]


def test_没有等号的行被跳过而不是当空值(env_file) -> None:
    path = env_file("这行没有等号\nLLM_MODEL=glm\n")
    assert load_env(path) == ["LLM_MODEL"]


def test_值里可以有等号(env_file) -> None:
    """按**第一个**等号切，不是最后一个。base url 里带 `=` 不算罕见。"""
    path = env_file("LLM_BASE_URL=https://x/v1?key=abc\n")
    load_env(path)
    assert os.environ["LLM_BASE_URL"] == "https://x/v1?key=abc"


def test_空值也写进去(env_file) -> None:
    """`.env.example` 里的空行值是模板，不是错误。写进去之后
    `env_caller` 照常按"没配"处理——它自己会 strip 掉空白再判空。"""
    path = env_file("LLM_API_KEY=\n")
    assert load_env(path) == ["LLM_API_KEY"]
    assert os.environ["LLM_API_KEY"] == ""


def test_文件不存在就什么也不做(tmp_path: Path) -> None:
    """没配 Key 是常态（离线开发、CI），不该因此抛错。"""
    assert load_env(tmp_path / "没有这个文件") == []


def test_默认路径指向_server_点env() -> None:
    """`DEFAULT_ENV_PATH` 必须正好是 `server/.env`。

    这条不是凑数:默认路径写错一级,所有显式喂路径的测试全绿,只有真实
    使用的那一刻读不到文件,然后报一句令人困惑的"未配置 LLM_API_KEY"。
    """
    from oracle.env_file import DEFAULT_ENV_PATH

    server_dir = Path(__file__).resolve().parents[1]
    assert DEFAULT_ENV_PATH == server_dir / ".env"
