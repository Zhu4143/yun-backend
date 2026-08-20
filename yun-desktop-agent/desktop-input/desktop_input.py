import json
import sys
import time

import pyautogui
import pyperclip


pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.04

ALLOWED_KEYS = {
    "backspace", "tab", "enter", "return", "shift", "ctrl", "control", "alt", "win", "command",
    "esc", "escape", "space", "delete", "del", "home", "end", "pageup", "pagedown", "up", "down",
    "left", "right", "insert", "printscreen", "capslock", "numlock", "scrolllock", "pause",
    "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
    "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
    "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
}


def clamp_float(value, default=0.0, minimum=None, maximum=None):
    try:
        number = float(value)
    except Exception:
        number = default
    if minimum is not None:
        number = max(minimum, number)
    if maximum is not None:
        number = min(maximum, number)
    return number


def clamp_int(value, default=0, minimum=None, maximum=None):
    return int(round(clamp_float(value, default, minimum, maximum)))


def normalize_key(value):
    key = str(value or "").strip().lower()
    aliases = {
        "cmd": "win",
        "windows": "win",
        "option": "alt",
        "control": "ctrl",
        "escape": "esc",
        "return": "enter",
        "del": "delete",
        "pgup": "pageup",
        "pgdn": "pagedown",
    }
    key = aliases.get(key, key)
    if key not in ALLOWED_KEYS:
        raise ValueError(f"Unsupported key: {value}")
    return key


def screen_info():
    width, height = pyautogui.size()
    x, y = pyautogui.position()
    return {"screen": {"width": width, "height": height}, "mouse": {"x": x, "y": y}}


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    action = payload.get("action")
    p = payload.get("parameters") or {}

    if action == "get_mouse_position":
        result = screen_info()

    elif action == "mouse_move":
        x = clamp_int(p.get("x"), minimum=0)
        y = clamp_int(p.get("y"), minimum=0)
        duration = clamp_float(p.get("duration", 0.12), 0.12, 0, 3)
        pyautogui.moveTo(x, y, duration=duration)
        result = screen_info()

    elif action == "mouse_click":
        x = clamp_int(p.get("x"), minimum=0)
        y = clamp_int(p.get("y"), minimum=0)
        button = str(p.get("button") or "left").lower()
        if button not in {"left", "right", "middle"}:
            raise ValueError("button must be left, right or middle")
        clicks = clamp_int(p.get("clicks", 1), 1, 1, 3)
        interval = clamp_float(p.get("interval", 0.08), 0.08, 0, 1)
        pyautogui.click(x=x, y=y, clicks=clicks, interval=interval, button=button)
        result = screen_info()

    elif action == "mouse_scroll":
        clicks = clamp_int(p.get("clicks", p.get("amount", 0)), 0, -20, 20)
        x = p.get("x")
        y = p.get("y")
        if x is not None and y is not None:
            pyautogui.moveTo(clamp_int(x, minimum=0), clamp_int(y, minimum=0), duration=0.05)
        pyautogui.scroll(clicks)
        result = screen_info()

    elif action == "keyboard_type_text":
        text = str(p.get("text") or "")
        if not text:
            raise ValueError("Missing text")
        if len(text) > 4000:
            raise ValueError("Text is too long")
        paste = bool(p.get("paste", True))
        if paste:
            old_clipboard = None
            had_clipboard = False
            try:
                old_clipboard = pyperclip.paste()
                had_clipboard = True
            except Exception:
                pass
            pyperclip.copy(text)
            pyautogui.hotkey("ctrl", "v")
            time.sleep(0.08)
            if had_clipboard:
                try:
                    pyperclip.copy(old_clipboard)
                except Exception:
                    pass
        else:
            pyautogui.write(text, interval=clamp_float(p.get("interval", 0.01), 0.01, 0, 0.2))
        result = {"typed": True, "length": len(text)}

    elif action == "keyboard_press":
        key = normalize_key(p.get("key"))
        presses = clamp_int(p.get("presses", 1), 1, 1, 20)
        interval = clamp_float(p.get("interval", 0.05), 0.05, 0, 1)
        pyautogui.press(key, presses=presses, interval=interval)
        result = {"pressed": key, "presses": presses}

    elif action == "keyboard_hotkey":
        keys = p.get("keys")
        if not isinstance(keys, list) or not keys:
            raise ValueError("Missing keys array")
        safe_keys = [normalize_key(key) for key in keys]
        if len(safe_keys) > 5:
            raise ValueError("Too many keys")
        pyautogui.hotkey(*safe_keys)
        result = {"hotkey": safe_keys}

    else:
        raise ValueError(f"Unsupported input action: {action}")

    print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
