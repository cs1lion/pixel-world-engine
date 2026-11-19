"""题面去噪的验收：脏输入洗出的用户提示词里没有程序噪声，业务信息一条不少。

为什么这一文件单独测 `_user_prompt` / `build_messages`：
`test_villager_decision.py` 与 `test_work_note.py` 钉的是「模型回的话怎么
收成结构化结果」；这一份钉的是另一面——**发出去的那段话**干不干净。
两段都要守住：发出去的不能带噪声（白送 token、给模型瞎猜的机会），
该带的业务信息（角色、物品、地点、任务约束）一条都不能少。

测两层：`prompt_hygiene` 的纯函数本身，和两条外环路（villager-decision /
work-note）拿脏输入拼出的最终用户提示词。后者即「最终 prompt」——
`build_messages` 的第二段就是发给模型的用户内容。
"""

from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient

from events.api import create_app
from oracle import prompt_hygiene as hygiene
from oracle import villager_decision, work_note

#: 长精度浮点 / 坐标 / 概率长小数：清洗后一个数字都不许剩。
_LONG_DECIMAL = re.compile(r"\d\.\d+")


# ---------------------------------------------------------------- 纯函数层


def test_is_blank_认空不认值() -> None:
    assert hygiene.is_blank(None)
    assert hygiene.is_blank("")
    assert hygiene.is_blank("   ")
    assert hygiene.is_blank([])
    assert hygiene.is_blank({})
    assert not hygiene.is_blank(0)
    assert not hygiene.is_blank(False)
    assert not hygiene.is_blank("x")


def test_text_只收非空字符串() -> None:
    assert hygiene.text(" 炉底入口 ") == "炉底入口"
    assert hygiene.text("") is None
    assert hygiene.text("   ") is None
    assert hygiene.text(None) is None
    # 数字 / 字典 / 列表不许 str() 强转——那是程序噪声进提示词的正路。
    assert hygiene.text(3.1415926535) is None
    assert hygiene.text({"x": 1}) is None
    assert hygiene.text(["a"]) is None


def test_whole_int_整除浮点进位长小数丢弃() -> None:
    assert hygiene.whole_int(3) == 3
    assert hygiene.whole_int(3.0) == 3
    assert hygiene.whole_int("3") == 3
    assert hygiene.whole_int(3.141592653589793) is None
    assert hygiene.whole_int(True) is None
    assert hygiene.whole_int(float("nan")) is None
    assert hygiene.whole_int(float("inf")) is None
    assert hygiene.whole_int("3.5") is None
    assert hygiene.whole_int(None) is None
    assert hygiene.whole_int([3]) is None


def test_str_items_只留非空字符串并去重() -> None:
    assert hygiene.str_items(["a", "", " a ", None, "a", 7, {"k": 1}]) == ["a"]
    assert hygiene.str_items(None) == []
    assert hygiene.str_items("not-a-list") == []


def test_unique_去重保序() -> None:
    assert hygiene.unique(["a", "b", "a"]) == ["a", "b"]


# ------------------------------------------------- villager-decision 拼装


def test_villager_decision_空输入只有兜底句() -> None:
    assert villager_decision._user_prompt({}) == "\n".join([
        "人物：她",
        "作息说：（无）",
        "她记得：（今天没什么特别的）",
        "请做决定。",
    ])


def test_villager_decision_脏输入洗后无程序噪声() -> None:
    prompt = villager_decision._user_prompt({
        "villagerName": "炉匠",
        "day": 3.141592653589793,
        "routineLabel": "",
        "memories": [
            {
                "text": "昨天集市缺货",
                "day": 2,
                "memoryId": "mem_0001",
                "_debug": "trace-xyz",
                "internalId": 9527,
                "ts": 1763510400.123456,
            },
            {"text": "", "day": 2},
            {"text": "   ", "day": None},
            "not-a-dict",
            None,
            {"text": "对老窑匠欠过人情", "day": 1, "uuid": "c9bf-2f"},
        ],
        "availableSites": [
            {
                "siteId": "market",
                "siteName": "集市",
                "activities": ["trade", "trade", {"id": "craft", "x": 12.345678901234, "p": 0.1000000000001}],
                "x": 41.1234567890123,
                "y": 7.9876543210987,
                "probability": 0.3333333333333333,
                "_meta": {"hidden": True},
            },
            {"siteId": "", "siteName": "无名场"},
            {"siteId": "workshop", "siteName": "工坊", "activities": []},
        ],
        "instanceId": "bld_77",
    })
    # 逐行钉死洗后的样子：空字段、长小数、内部程序字段一个都不进。
    assert prompt == "\n".join([
        "人物：炉匠",
        "作息说：（无）",
        "她记得：",
        "  第 2 天 昨天集市缺货",
        "  第 1 天 对老窑匠欠过人情",
        "可选场所：",
        "  market（集市）：trade",
        "  workshop（工坊）",
        "请做决定。",
    ])
    assert "None" not in prompt
    assert "3.141592653589793" not in prompt
    assert "12.345678901234" not in prompt
    assert "0.1000000000001" not in prompt
    assert _LONG_DECIMAL.search(prompt) is None
    for noise in ("memoryId", "internalId", "_debug", "uuid", "ts", "_meta", "instanceId", "probability", "mem_0001", "trace-xyz", "bld_77", "9527"):
        assert noise not in prompt
    # 分数形式的「第 3 天」是噪声不是业务：长小数天被整个丢掉，不四舍五入冒充整数。
    assert "第 3" not in prompt


def test_villager_decision_有效业务信息无损() -> None:
    prompt = villager_decision._user_prompt({
        "villagerName": "炉匠",
        "day": 3,
        "routineLabel": "锅炉房搬炭",
        "memories": [
            {"text": "昨天集市缺货", "day": 2},
            {"text": "对老窑匠欠过人情", "day": 1},
        ],
        "availableSites": [
            {"siteId": "market", "siteName": "集市", "activities": ["trade", "craft"]},
            {"siteId": "workshop", "siteName": "工坊", "activities": ["forge"]},
        ],
    })
    for fact in (
        "炉匠", "第 3 天", "锅炉房搬炭",
        "昨天集市缺货", "第 2 天", "对老窑匠欠过人情", "第 1 天",
        "market", "集市", "trade", "craft",
        "workshop", "工坊", "forge",
        "请做决定。",
    ):
        assert fact in prompt, f"业务信息 {fact!r} 被洗掉了"


def test_villager_decision_重复条目去重() -> None:
    prompt = villager_decision._user_prompt({
        "villagerName": "炉匠",
        "memories": [
            {"text": "昨天集市缺货", "day": 2},
            {"text": "昨天集市缺货", "day": 2},
        ],
        "availableSites": [
            {"siteId": "market", "siteName": "集市", "activities": ["trade", "trade", "trade"]},
            {"siteId": "market", "siteName": "集市", "activities": ["trade"]},
        ],
    })
    assert prompt.count("trade") == 1
    assert prompt.count("昨天集市缺货") == 1
    assert prompt.count("market（集市）") == 1


def test_villager_decision_记忆超过十条只带前十条() -> None:
    prompt = villager_decision._user_prompt({
        "villagerName": "炉匠",
        "memories": [{"text": f"记忆{i}", "day": i} for i in range(12)],
    })
    assert "记忆9" in prompt
    assert "记忆10" not in prompt
    assert "记忆11" not in prompt


# -------------------------------------------------------- work-note 拼装


def test_work_note_空输入只有兜底句() -> None:
    assert work_note._user_prompt({}) == "\n".join([
        "场所：这处",
        "活动：work",
        "请写这一句状态牌。",
    ])


def test_work_note_脏输入洗后无程序噪声() -> None:
    prompt = work_note._user_prompt({
        "siteName": "炉底入口",
        "site": "site_raw",
        "activity": "",
        "stock": 2.999999999999,
        "day": 2.0,
        "people": ["炉匠", "炉匠", "", None, {"name": "汐", "id": 88}],
        "canonical": "  在炉边添炭  ",
        "villagerId": "v_000123",
        "requestId": "req-77f3",
        "_trace": "trace-abc",
        "coords": {"x": 1.234567890123, "y": 9.8765432109},
    })
    # 逐行钉死：空 activity 回退 work；整除浮点 day 进位成 2；长小数 stock 丢；
    # 重复人名去重；dict 形式的人与所有内部字段一律不进。
    assert prompt == "\n".join([
        "场所：炉底入口",
        "活动：work",
        "现在牌子上写的是：在炉边添炭（请换一种说法，事实一个都不许变）",
        "第 2 天",
        "此刻在场：炉匠",
        "请写这一句状态牌。",
    ])
    assert "None" not in prompt
    assert "存货" not in prompt
    assert _LONG_DECIMAL.search(prompt) is None
    for noise in ("2.999999999999", "1.234567890123", "v_000123", "req-77f3", "trace-abc", "coords", "site_raw", "9.8765432109"):
        assert noise not in prompt


def test_work_note_有效业务信息无损() -> None:
    prompt = work_note._user_prompt({
        "siteName": "炉底入口",
        "activity": "work",
        "stock": 3,
        "day": 2,
        "people": ["炉匠", "汐"],
        "canonical": "在炉边添炭",
    })
    for fact in ("炉底入口", "work", "3 份", "第 2 天", "炉匠、汐", "在炉边添炭", "请写这一句状态牌。"):
        assert fact in prompt, f"业务信息 {fact!r} 被洗掉了"


# ------------------------------------------------------- 端点级最终 prompt


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("PWE_LLM_PROVIDER", "fake")
    monkeypatch.setenv("PWE_LLM_MODEL", "fake-model")
    return TestClient(create_app())


def test_villager_decision_端点发给模型的用户内容已去噪(client: TestClient) -> None:
    seen: dict = {}

    def fake_caller(messages):
        seen["messages"] = messages
        return '{"action": "follow"}'

    client.app.state.model_caller = fake_caller  # type: ignore[attr-defined]
    r = client.post("/api/world/villager-decision", json={
        "villagerName": "炉匠",
        "day": 3.141592653589793,
        "routineLabel": "",
        "memories": [{"text": "昨天集市缺货", "day": 2, "_debug": "trace-xyz", "memoryId": "mem_0001"}],
        "availableSites": [{
            "siteId": "market", "siteName": "集市",
            "activities": ["trade", {"id": "craft", "x": 12.345678901234}],
            "probability": 0.1000000000001,
        }],
    })
    assert r.status_code == 200
    user_content = seen["messages"][-1]["content"]
    assert _LONG_DECIMAL.search(user_content) is None
    assert "None" not in user_content
    assert "_debug" not in user_content
    assert "memoryId" not in user_content
    assert "12.345678901234" not in user_content
    # 业务面照样全：人物、记忆、场所、活动一个不少。
    assert "炉匠" in user_content
    assert "昨天集市缺货" in user_content
    assert "market（集市）：trade" in user_content
