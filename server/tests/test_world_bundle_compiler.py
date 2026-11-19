"""`server/compiler/` 的单元测试：零外网依赖。

Mock Provider 覆盖四件事：
1. 一次编译通过；
2. 首轮非法 JSON / 越界字段 / 人数不符 → 结构化违规回灌 → 二轮通过；
3. 连续失败 → 清晰报错（WorldCompileError 带完整报告，绝不输出半成品）；
4. Ollama / OpenAI 两种 Provider 的请求载荷格式正确。

另有一组「同构抽测」：坏例与期望的 violation code 直接对照
`world-client/src/world/bundle/validator.ts` 的口径写死，两边必须判出一样的 code。
"""

from __future__ import annotations

import json

import pytest

from compiler import cli
from compiler.providers import OllamaProvider, OpenAIProvider, clean_json_text
from compiler.schema import validate_world_bundle
from compiler.world_compiler import LORE_MAX_CHARS, LORE_MIN_CHARS, WorldCompiler, WorldCompileError

LORE = (
    "渡口镇坐落在海湾北岸，镇民靠潮汐过日子。涨潮时渔船回港，退潮时滩涂露出来，"
    "人们去拾灯芯与贝壳。镇心有一块镇心石，旁边是集市与账房；东面灯街挂满纸灯，"
    "西面积尘滩堆着废船与煤。叠浪楼是镇上最高的楼，炉匠住在炉底入口旁，洗衣妇每天"
    "把洗好的衣裳送到集市。镇长是个不爱说话的人，但每逢满潮都会去渡口站台点灯。"
    "镇上流传着一句话：灯灭了，人就散了。新来的外乡人带着一只没点的灯走进灯街，"
    "没有人记得她从哪儿来，也没有人问她要去哪儿。"
)


class ScriptedProvider:
    """按顺序吐预设回答，并记下每一轮 prompt 供断言。"""

    def __init__(self, replies: list[str]) -> None:
        self._replies = list(replies)
        self.prompts: list[str] = []

    def complete(self, prompt: str) -> str:
        self.prompts.append(prompt)
        if not self._replies:
            raise AssertionError("没有更多预设回答了")
        return self._replies.pop(0)


def valid_bundle(cast_size: int = 3) -> dict:
    cast = [
        {
            "id": f"v{i}",
            "name": f"居民{i}",
            "persona": f"第{i}位居民，原创人设",
            "initialRelations": [],
            "voiceProfile": {"pitch": 0.5, "tempo": 1.0, "warmth": 0.5},
        }
        for i in range(cast_size)
    ]
    return {
        "schemaVersion": 1,
        "meta": {
            "id": "dengchao",
            "title": "灯潮界",
            "loreSummary": "末班渡船走后，灯街上的居民靠潮汐过日子。",
            "seed": 20261025,
        },
        "climate": {"kind": "temperate", "weatherWeights": {"clear": 0.5, "rain": 0.3, "storm": 0.1, "fog": 0.1}},
        "grid": {"width": 64, "height": 48},
        "regions": [{"id": "ferry", "label": "渡口站台", "x": 5, "y": 8, "w": 20, "h": 10, "tags": ["渡口"]}],
        "prefabs": [
            {
                "id": "wave_house",
                "footprint": {"w": 7, "h": 6},
                "clearMargin": 1,
                "door": {"x": 3, "y": 6},
                "workSpots": [{"x": 3, "y": 3}],
            },
        ],
        "cast": cast,
        "phases": [{"id": "first-low-tide", "label": "首次退潮", "kind": "countdown", "afterTicks": 240}],
    }


def test_背景资料字数口径() -> None:
    assert LORE_MIN_CHARS == 200 and LORE_MAX_CHARS == 2000
    assert LORE_MIN_CHARS <= len(LORE) <= LORE_MAX_CHARS
    compiler = WorldCompiler(ScriptedProvider([json.dumps(valid_bundle(3))]))
    with pytest.raises(ValueError):
        compiler.compile(LORE[:199], 3)
    with pytest.raises(ValueError):
        compiler.compile("x" * 2001, 3)


def test_一次编译通过() -> None:
    bundle = valid_bundle(3)
    provider = ScriptedProvider([json.dumps(bundle, ensure_ascii=False)])
    result = WorldCompiler(provider).compile(LORE, 3)
    assert result == bundle
    assert len(provider.prompts) == 1
    assert "WorldBundle v1" in provider.prompts[0]
    assert LORE in provider.prompts[0]
    assert "N=3" in provider.prompts[0]


def test_首轮非法_JSON_触发自动修复二轮通过() -> None:
    bundle = valid_bundle(3)
    provider = ScriptedProvider(["```json\n{这不是合法 JSON", json.dumps(bundle, ensure_ascii=False)])
    result = WorldCompiler(provider).compile(LORE, 3)
    assert result == bundle
    assert len(provider.prompts) == 2
    # 修复轮必须带上结构化违规与上一轮原文，模型才知道改哪儿。
    assert "json.parse" in provider.prompts[1]
    assert "{这不是合法 JSON" in provider.prompts[1]


def test_越界字段触发自动修复二轮通过() -> None:
    bad = valid_bundle(3)
    bad["regions"][0]["x"] = 60
    bad["regions"][0]["w"] = 10
    provider = ScriptedProvider([json.dumps(bad), json.dumps(valid_bundle(3))])
    result = WorldCompiler(provider).compile(LORE, 3)
    assert result == valid_bundle(3)
    assert "region.outOfBounds" in provider.prompts[1]


def test_人数不符也触发修复() -> None:
    short = valid_bundle(2)
    provider = ScriptedProvider([json.dumps(short), json.dumps(valid_bundle(3))])
    result = WorldCompiler(provider).compile(LORE, 3)
    assert len(result["cast"]) == 3
    assert "cast.sizeMismatch" in provider.prompts[1]


def test_连续失败_清晰报错_绝不输出半成品() -> None:
    provider = ScriptedProvider(["{\"schemaVersion\": 2}"] * 8)
    compiler = WorldCompiler(provider)
    with pytest.raises(WorldCompileError) as excinfo:
        compiler.compile(LORE, 3)
    report = excinfo.value.report
    assert report["ok"] is False
    assert report["rounds"] == 3
    assert len(provider.prompts) == 3
    assert len(report["violations"]) > 0
    assert report["violations"][0]["code"] == "schemaVersion.unsupported"
    assert "最后一轮模型原文" in report or report["lastReply"]
    assert excinfo.value.report["violations"][0]["path"] == "schemaVersion"


def test_清洗_markdown_围栏与前后散文() -> None:
    assert clean_json_text("好的：\n```json\n{\"a\": 1}\n```\n还有别的吗？") == '{"a": 1}'
    assert clean_json_text("{\"a\": 1}") == '{"a": 1}'
    assert clean_json_text("```\n{\"a\": 1}\n```") == '{"a": 1}'
    assert clean_json_text("前面话 {\"a\": 1} 后面话") == '{"a": 1}'


def test_ollama_请求载荷格式正确(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: dict[str, object] = {}

    class FakeResponse:
        status_code = 200

        def json(self) -> dict:
            return {"response": "{}"}

    def fake_post(url: str, headers=None, json=None, timeout=None):  # noqa: A002 - 镜像 httpx.post 签名
        calls.update(url=url, json=json, headers=headers, timeout=timeout)
        return FakeResponse()

    monkeypatch.setattr("compiler.providers.httpx.post", fake_post)
    provider = OllamaProvider(model="qwen2.5:7b", base_url="http://localhost:11434", timeout=5)
    text = provider.complete("把灯潮界编译成 WorldBundle")
    assert calls["url"] == "http://localhost:11434/api/generate"
    assert calls["json"] == {
        "model": "qwen2.5:7b",
        "prompt": "把灯潮界编译成 WorldBundle",
        "format": "json",
        "stream": False,
    }
    assert calls["timeout"] == 5
    assert text == "{}"


def test_openai_请求载荷格式正确(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: dict[str, object] = {}

    class FakeResponse:
        status_code = 200

        def json(self) -> dict:
            return {"choices": [{"message": {"content": "{\"ok\": true}"}}]}

    def fake_post(url: str, headers=None, json=None, timeout=None):  # noqa: A002
        calls.update(url=url, json=json, headers=headers, timeout=timeout)
        return FakeResponse()

    monkeypatch.setattr("compiler.providers.httpx.post", fake_post)
    provider = OpenAIProvider(api_key="sk-test", model="gpt-4o-mini", base_url="https://example.test/v1/", timeout=5)
    text = provider.complete("编译这份资料")
    assert calls["url"] == "https://example.test/v1/chat/completions"
    payload = calls["json"]
    assert isinstance(payload, dict)
    assert payload["model"] == "gpt-4o-mini"
    assert payload["temperature"] == 0
    assert payload["messages"] == [{"role": "user", "content": "编译这份资料"}]
    assert calls["headers"]["authorization"] == "Bearer sk-test"
    assert text == "{\"ok\": true}"


@pytest.mark.parametrize(
    ("mutate", "expected_code"),
    [
        (lambda b: b.update(schemaVersion=2), "schemaVersion.unsupported"),
        (lambda b: b["meta"].update(seed=-1), "meta.seed.range"),
        (lambda b: b["climate"].update(kind="desert"), "climate.kind.unsupported"),
        (
            lambda b: b["climate"]["weatherWeights"].update(clear=0, rain=0, storm=0, fog=0),
            "climate.weatherWeights.allZero",
        ),
        (lambda b: b["climate"]["weatherWeights"].update(clear=-0.1), "climate.weatherWeights.range"),
        (lambda b: b["climate"]["weatherWeights"].update(snow=1), "climate.weatherWeights.unknown"),
        (lambda b: b["regions"][0].update(x=60, w=10), "region.outOfBounds"),
        (lambda b: b["regions"][0].update(w=0), "region.bounds.range"),
        (lambda b: b["cast"].clear(), "cast.empty"),
        (lambda b: b["cast"][1].update(name=b["cast"][0]["name"]), "cast.duplicateName"),
        (lambda b: b["cast"][0]["voiceProfile"].update(tempo=2.5), "cast.voiceProfile.range"),
        (
            lambda b: b["cast"][0]["initialRelations"].append(
                {"to": "ghost", "trust": 0.5, "warmth": 0.5, "debt": 0, "familiarity": 0.5},
            ),
            "cast.relation.to.unknown",
        ),
        (
            lambda b: b["cast"][0]["initialRelations"].append(
                {"to": "v0", "trust": 0.5, "warmth": 0.5, "debt": 0, "familiarity": 0.5},
            ),
            "cast.relation.to.self",
        ),
        (lambda b: b["prefabs"][0].update(door={"x": 3, "y": 3}), "prefab.door.insideFootprint"),
        (lambda b: b["prefabs"][0].update(workSpots=[{"x": 99, "y": 99}]), "prefab.workSpots.outsideFootprint"),
        (lambda b: b["phases"][0].update(kind="raid"), "phase.kind.unsupported"),
        (lambda b: b["phases"][0].update(afterTicks=0), "phase.afterTicks.range"),
    ],
)
def test_同构校验口径(mutate, expected_code: str) -> None:
    """坏例 → code 的映射必须与前端 validator.ts 判出一致。"""
    bundle = valid_bundle(3)
    mutate(bundle)
    result = validate_world_bundle(bundle)
    assert result["ok"] is False
    codes = [v["code"] for v in result["violations"]]
    assert expected_code in codes, f"期望 {expected_code}，实际 {codes}"


def test_合法_bundle_与确定性校验() -> None:
    bundle = valid_bundle(3)
    assert validate_world_bundle(bundle)["ok"] is True
    first = validate_world_bundle(bundle)
    second = validate_world_bundle(json.loads(json.dumps(bundle)))
    assert first == second
    for garbage in (None, 42, "world", [], [1, 2], {"meta": "nope"}):
        result = validate_world_bundle(garbage)
        assert result["ok"] is False
        assert len(result["violations"]) > 0


def test_cli_编译并写出(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    lore = tmp_path / "lore.txt"
    lore.write_text(LORE, encoding="utf-8")
    out = tmp_path / "bundle.json"
    monkeypatch.setattr(cli, "build_provider", lambda args: ScriptedProvider([json.dumps(valid_bundle(5))]))
    code = cli.main([str(lore), "--cast", "5", "--out", str(out)])
    assert code == 0
    written = json.loads(out.read_text(encoding="utf-8"))
    assert len(written["cast"]) == 5


def test_cli_只校验模式离线可用(tmp_path) -> None:
    good = tmp_path / "good.json"
    good.write_text(json.dumps(valid_bundle(3), ensure_ascii=False), encoding="utf-8")
    assert cli.main(["--validate", str(good)]) == 0

    bad = tmp_path / "bad.json"
    bad_bundle = valid_bundle(3)
    bad_bundle["climate"]["kind"] = "desert"
    bad.write_text(json.dumps(bad_bundle, ensure_ascii=False), encoding="utf-8")
    assert cli.main(["--validate", str(bad)]) == 3


def test_cli_字数不够直接报错(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    lore = tmp_path / "short.txt"
    lore.write_text("太短了。", encoding="utf-8")
    monkeypatch.setattr(cli, "build_provider", lambda args: ScriptedProvider([]))
    assert cli.main([str(lore)]) == 2
