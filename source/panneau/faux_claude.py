#!/usr/bin/env python3
"""Faux Claude pour les essais du panneau : parle le même format que `claude -p --output-format stream-json`,
sans rien dépenser. Il répond au message, et joue un appel d'outil si le message contient « page »."""
import json
import sys
import time


def dire(m):
    sys.stdout.write(json.dumps(m, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def ev(e):
    dire({"type": "stream_event", "event": e, "parent_tool_use_id": None})


dire({"type": "system", "subtype": "init", "session_id": "essai-0001", "model": "claude-opus-5-5"})
for ligne in sys.stdin:
    m = json.loads(ligne)
    texte = [c["text"] for c in m["message"]["content"] if c["type"] == "text"][0]
    if "page" in texte:
        ev({"type": "content_block_start", "index": 0, "content_block": {"type": "tool_use", "id": "t1", "name": "mcp__claude-safari__navigate"}})
        ev({"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": '{"url": "exemple.fr"}'}})
        ev({"type": "content_block_stop", "index": 0})
        time.sleep(0.2)
        dire({"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}]}})
    if "lent" in texte:
        time.sleep(30)
    ev({"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}})
    for mot in ("Bien reçu : **%s**.\n\nVoici une liste :\n- un `code`\n- deux [lien](https://exemple.fr)" % texte).split(" "):
        ev({"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": mot + " "}})
        time.sleep(0.01)
    ev({"type": "content_block_stop", "index": 1})
    dire({"type": "result", "subtype": "success", "is_error": False, "session_id": "essai-0001"})
