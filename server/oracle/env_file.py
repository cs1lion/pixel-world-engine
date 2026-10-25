"""从 `.env` 读环境变量。**只为本地跑模型那条路存在。**

不在 `requirements.txt` 里，也不碰服务端主流程：`python-dotenv` 之类的依赖
只为了省一次 `export` 不值得。这里三十行，够用，且行为一眼看得全。

三条刻意的克制：

1. **不覆盖已有的环境变量。** 谁在 CI / 容器里显式设了 `LLM_API_KEY`，
   那份比仓库目录里的文件更权威。
2. **不展开 `${...}`、不执行命令。** `.env` 是数据，不是脚本。
3. **找不到文件就什么也不做。** 没配 Key 是常态（离线开发、CI），
   不该因此抛错。

`server/.env` 已在仓库根 `.gitignore` 的 `.env` 规则里，不会被提交。
"""

from __future__ import annotations

import os
from pathlib import Path

#: 默认位置：`server/.env`。本文件在 `server/oracle/env_file.py`，
#: parents[0]=oracle、parents[1]=server。
#: （写成 `.parent` 会指到 `oracle/`——所有测试都显式喂路径，抓不到这个。）
DEFAULT_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"


def load_env(path: Path = DEFAULT_ENV_PATH) -> list[str]:
    """把 `.env` 装进 `os.environ`。返回**这次新设**的变量名，便于调用方打印
    「读到了哪几项」而不必打印值。

    值两边的成对引号会被剥掉——`LLM_API_KEY="sk-..."` 是 shell 里很常见的写法，
    把引号原样带进请求头会得到一个没人看得懂的 401。
    """
    if not path.is_file():
        return []

    loaded: list[str] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key == "" or key in os.environ:
            # 已存在的不覆盖：显式传入的环境变量优先级更高。
            continue
        os.environ[key] = _unquote(value.strip())
        loaded.append(key)
    return loaded


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value
