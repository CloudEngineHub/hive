"""Tool schemas for the bridge remote HTTP API (status port — 14830, legacy 9230)."""

TOOL_SCHEMAS: dict[str, dict] = {
    "browser_interact": {
        "description": (
            "Unified browser interaction — click / type / key / hover / scroll / "
            "drag / screenshot / zoom / wait, dispatched by `action`. Coordinates "
            "are viewport fractions (0..1), not pixels."
        ),
        "params": {
            "action": {
                "type": "string",
                "required": True,
                "enum": [
                    "left_click",
                    "right_click",
                    "middle_click",
                    "double_click",
                    "triple_click",
                    "hover",
                    "type",
                    "key",
                    "scroll",
                    "drag",
                    "screenshot",
                    "zoom",
                    "wait",
                ],
            },
            "tab_id": {"type": "integer"},
            "profile": {"type": "string"},
            "selector": {"type": "string"},
            "coordinate": {"type": "array", "items": "number"},
            "start_selector": {"type": "string"},
            "start_coordinate": {"type": "array", "items": "number"},
            "text": {"type": "string"},
            "clear_first": {"type": "boolean", "default": True},
            "modifiers": {"type": "string"},
            "repeat": {"type": "integer", "default": 1},
            "scroll_direction": {"type": "string", "default": "down", "enum": ["up", "down", "left", "right"]},
            "scroll_amount": {"type": "integer", "default": 500},
            "intent": {"type": "string"},
            "full_page": {"type": "boolean", "default": False},
            "annotate": {"type": "boolean", "default": True},
            "region": {"type": "array", "items": "number"},
            "duration": {"type": "number"},
            "wait_for_selector": {"type": "string"},
            "wait_for_text": {"type": "string"},
            "timeout_ms": {"type": "integer"},
            "auto_snapshot_mode": {
                "type": "string",
                "default": "simple",
                "enum": ["default", "simple", "interactive", "off"],
            },
            "wait_after_ms": {"type": "integer", "default": 0},
        },
    },
    "browser_navigate": {
        "description": "Navigate a tab to a URL.",
        "params": {
            "url": {"type": "string", "required": True},
            "tab_id": {"type": "integer"},
            "profile": {"type": "string"},
            "wait_until": {"type": "string", "default": "load"},
        },
    },
    "browser_reload": {
        "description": "Reload the current page.",
        "params": {
            "tab_id": {"type": "integer"},
            "profile": {"type": "string"},
        },
    },
    "browser_select": {
        "description": "Select option(s) in a dropdown.",
        "params": {
            "selector": {"type": "string", "required": True},
            "values": {"type": "array", "required": True},
            "tab_id": {"type": "integer"},
            "profile": {"type": "string"},
        },
    },
    "browser_screenshot": {
        "description": "Take a screenshot of the page (returns base64 PNG).",
        "params": {
            "intent": {"type": "string", "required": True},
            "tab_id": {"type": "integer"},
            "profile": {"type": "string"},
            "full_page": {"type": "boolean", "default": False},
        },
    },
    "browser_snapshot": {
        "description": "Get the accessibility tree snapshot of the page.",
        "params": {
            "tab_id": {"type": "integer"},
            "profile": {"type": "string"},
        },
    },
    "browser_evaluate": {
        "description": "Evaluate JavaScript in the page.",
        "params": {
            "expression": {"type": "string", "required": True},
            "tab_id": {"type": "integer"},
            "profile": {"type": "string"},
        },
    },
    "browser_get_text": {
        "description": "Get text content of an element.",
        "params": {
            "selector": {"type": "string", "required": True},
            "tab_id": {"type": "integer"},
            "profile": {"type": "string"},
        },
    },
}
