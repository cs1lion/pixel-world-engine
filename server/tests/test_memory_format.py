

def test_frontmatter_读得回来():
    from memory.format import frontmatter, read_frontmatter

    text = frontmatter({"kind": "event", "at": 1500, "evidence": [1, 2], "subject": "莞尔"})
    fields = read_frontmatter(text + "\n# 标题\n\n正文\n")
    assert fields["kind"] == "event"
    assert fields["at"] == 1500
    assert fields["evidence"] == [1, 2]
    # allow_unicode 得在两头都对：写的时候不转义，读的时候也不该变成天书。
    assert fields["subject"] == "莞尔"


def test_没有_frontmatter_返回空():
    from memory.format import read_frontmatter

    assert read_frontmatter("# 只是一个标题\n") == {}
    assert read_frontmatter("") == {}


def test_坏掉的_frontmatter_返回空而不是抛():
    from memory.format import read_frontmatter

    assert read_frontmatter("---\nat: [没闭上\n---\n正文\n") == {}


def test_正文里的分隔线不被当成_frontmatter():
    from memory.format import read_frontmatter

    # 开头不是 `---`，所以后面那条分隔线只是正文。
    assert read_frontmatter("# 标题\n\n---\n\n正文\n") == {}
