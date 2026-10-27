"""Run the golden admissions set through the agent-chat proxy and score each turn.

    python3 prototypes/agent-chat/eval/run_eval.py --label flash-lite            # all scenarios
    python3 prototypes/agent-chat/eval/run_eval.py --label x --only cntt-ptit    # a subset

Needs start.sh (or an equivalent runtime + proxy) running. Each scenario gets a fresh conversation. Turns are paced
(--delay) because the Gemini free tier allows ~15 requests/minute and a knowledge answer takes 2+ model calls; a turn
that still falls back to the busy template is retried once after a minute. Writes <out>/<label>.json and .md.
Automatic checks cover facts, refs and fallbacks only; tone and completeness are for the human reading the report.
"""
import argparse
import json
import re
import time
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
BLOCKS = [("text", [1]), ("assessment_question", [2]), ("assessment_clarification", [2]), ("personality_card", [1]),
          ("markdown", [1]), ("suggestions", [1]), ("knowledge_card", [1])]
FALLBACKS = ("mình chưa hiểu ý bạn", "hệ thống đang hơi bận")
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # local proxy: never via http_proxy


def call(base: str, method: str, path: str, owner: str, body=None, stream=False):
    headers = {"X-Dev-Owner": owner, "Content-Type": "application/json"}
    if stream:
        headers["Accept"] = "text/event-stream"
    request = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                                     method=method, headers=headers)
    with OPENER.open(request, timeout=120) as response:
        raw = response.read().decode()
    if not stream:
        return json.loads(raw)
    tools, final = [], None
    for frame in raw.split("\n\n"):
        fields = dict(line.split(": ", 1) for line in frame.splitlines() if ": " in line and not line.startswith(":"))
        if "event" not in fields:
            continue
        payload = json.loads(fields["data"])
        if fields["event"] == "response.tool_call":
            tools.append(payload["name"])
        elif "response" in payload:
            final = payload["response"]
    return tools, final


def normalise(text: str) -> str:
    text = text.lower().replace("**", "").replace("*", "")
    text = re.sub(r"\s*[–—-]\s*", "-", text)
    return re.sub(r"\s+", " ", text)


def answer_text(blocks) -> str:
    return "\n".join(block.get("content") or block.get("title") or "" for block in blocks
                     if block.get("type") != "suggestions")


def score(turn: dict, kind: str, tools: list[str], blocks: list[dict]) -> dict:
    text = answer_text(blocks)
    flat = normalise(text)
    missing = [group for group in turn.get("expect", []) if not any(normalise(item) in flat for item in group)]
    present = [item for item in turn.get("forbid", []) if normalise(item) in flat]
    checks = {
        "facts": not missing,
        "no_forbidden": not present,
        "no_fallback": not any(flat.startswith(prefix) for prefix in FALLBACKS),
        "no_ref_codes": not re.search(r"\[k\d+\]|\bk\d+\b", text),
        "searched": ("knowledge.search" in tools if kind == "fact" and turn.get("expect") and turn.get("search", True)
                     else True),
    }
    return {"checks": checks, "missing": missing, "forbidden": present, "words": len(text.split()),
            "suggestions": sum(len(b.get("items", [])) for b in blocks if b.get("type") == "suggestions")}


def run_turn(args, conversation_id: str, owner: str, revision: int, text: str):
    for attempt in range(2):
        time.sleep(args.delay)
        started = time.monotonic()
        tools, final = call(args.url, "POST", f"/conversations/{conversation_id}/messages", owner, {
            "expected_revision": revision, "idempotency_key": uuid.uuid4().hex,
            "content": [{"type": "text", "text": text}]}, stream=True)
        blocks = (final.get("output") or {}).get("blocks", [])
        busy = normalise(answer_text(blocks)).startswith(FALLBACKS[1])
        if not busy or attempt:
            return tools, final, blocks, round(time.monotonic() - started, 1)
        print("  busy fallback, retrying after 60s", flush=True)
        time.sleep(60)
        revision = final.get("revision", revision)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--label", required=True, help="run name, e.g. the model or prompt variant")
    parser.add_argument("--url", default="http://127.0.0.1:8787/rt")
    parser.add_argument("--delay", type=float, default=9.0, help="seconds before each turn")
    parser.add_argument("--only", nargs="*", help="scenario ids")
    parser.add_argument("--out", default=str(HERE / "runs"))
    args = parser.parse_args()
    golden = json.loads((HERE / "golden.json").read_text(encoding="utf-8"))
    scenarios = [s for s in golden["scenarios"] if not args.only or s["id"] in args.only]
    results = []
    for scenario in scenarios:
        owner = f"eval{uuid.uuid4().hex[:10]}"
        created = call(args.url, "POST", "/conversations", owner, {
            "idempotency_key": uuid.uuid4().hex, "accepted_activity_profiles": ["riasec.mean.bounds.v2"],
            "supported_blocks": [{"type": t, "schema_versions": v} for t, v in BLOCKS]})
        conversation = created["data"]["conversation"]
        revision = conversation["revision"]
        for turn in scenario["turns"]:
            tools, final, blocks, seconds = run_turn(args, conversation["id"], owner, revision, turn["text"])
            revision = final.get("revision", revision)
            scored = score(turn, scenario["kind"], tools, blocks)
            results.append({"id": scenario["id"], "kind": scenario["kind"], "question": turn["text"], "tools": tools,
                            "seconds": seconds, "answer": answer_text(blocks), **scored})
            mark = "PASS" if all(scored["checks"].values()) else "FAIL"
            print(f"[{mark}] {scenario['id']} {seconds}s {scored['words']}w tools={tools}", flush=True)
    write_report(args, results)


def write_report(args, results: list[dict]) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{args.label}.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    passed = sum(all(r["checks"].values()) for r in results)
    words = sorted(r["words"] for r in results)
    lines = [f"# Eval {args.label}", "",
             f"- Lượt đạt mọi kiểm tra: **{passed}/{len(results)}**",
             f"- Số từ trung vị: {words[len(words) // 2]} (min {words[0]}, max {words[-1]})",
             f"- Lượt có gợi ý trả lời: {sum(r['suggestions'] > 0 for r in results)}/{len(results)}",
             f"- Thời gian trung bình: {sum(r['seconds'] for r in results) / len(results):.1f}s", "",
             "| id | kết quả | lỗi | từ | tools |", "|---|---|---|---|---|"]
    for r in results:
        failed = [name for name, ok in r["checks"].items() if not ok]
        detail = ", ".join(failed + [f"thiếu {g[0]}" for g in r["missing"]] + [f"có '{f}'" for f in r["forbidden"]])
        lines.append(f"| {r['id']} | {'✅' if not failed else '❌'} | {detail} | {r['words']} | {', '.join(r['tools'])} |")
    lines += ["", "## Câu trả lời", ""]
    for r in results:
        lines += [f"### {r['id']}", f"**Hỏi:** {r['question']}", "", r["answer"], ""]
    (out / f"{args.label}.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"\n{passed}/{len(results)} passed — report: {out / (args.label + '.md')}")


if __name__ == "__main__":
    main()
