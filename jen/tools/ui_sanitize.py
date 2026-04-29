"""Sanitization utilities for UI generation pipeline.

All external input (Figma layer names, PSD text, user-provided strings)
must be sanitized before entering generated code files (.tscn, .gd, .tres).
"""

import re


def sanitize_node_name(name: str) -> str:
    """Sanitize a string for use as a Godot node name.

    Godot node names allow most characters, but for safety and
    consistency in generated .tscn files, we restrict to alphanumeric
    and underscores.

    Args:
        name: Raw input string (e.g., from Figma layer name)

    Returns:
        Safe node name string
    """
    if not name:
        return "unnamed_node"
    # Replace any non-alphanumeric/underscore/hyphen with underscore
    sanitized = re.sub(r'[^a-zA-Z0-9_\-]', '_', str(name))
    # Collapse multiple underscores
    sanitized = re.sub(r'_+', '_', sanitized)
    # Strip leading/trailing underscores
    sanitized = sanitized.strip('_')
    # Ensure doesn't start with digit (invalid identifier)
    if sanitized and sanitized[0].isdigit():
        sanitized = '_' + sanitized
    return sanitized or 'unnamed_node'


def sanitize_gdscript_identifier(name: str) -> str:
    """Sanitize a string for use as a GDScript identifier (variable, class, function name).

    More restrictive than node names — no hyphens allowed.
    """
    if not name:
        return "unnamed"
    sanitized = re.sub(r'[^a-zA-Z0-9_]', '_', str(name))
    sanitized = re.sub(r'_+', '_', sanitized)
    sanitized = sanitized.strip('_')
    if sanitized and sanitized[0].isdigit():
        sanitized = '_' + sanitized
    return sanitized or 'unnamed'


def sanitize_tscn_string(text: str) -> str:
    """Escape a string for safe inclusion in .tscn file string values.

    .tscn strings are delimited by double quotes. We need to escape
    quotes, backslashes, and other control characters.
    """
    if not text:
        return ""
    return (str(text)
            .replace('\\', '\\\\')
            .replace('"', '\\"')
            .replace('\n', '\\n')
            .replace('\r', '\\r')
            .replace('\t', '\\t'))


def sanitize_class_name(name: str) -> str:
    """Convert a screen_id (snake_case) to a valid PascalCase class name.

    Example: "main_menu" -> "MainMenu", "game_over_screen" -> "GameOverScreen"
    """
    if not name:
        return "UnnamedScreen"
    # First sanitize as identifier
    clean = sanitize_gdscript_identifier(name)
    # Convert to PascalCase
    return ''.join(word.capitalize() for word in clean.split('_'))


def hex_to_godot_color(hex_color: str) -> str:
    """Convert hex color string to Godot Color() format.

    Args:
        hex_color: "#RRGGBB" or "#RRGGBBAA"

    Returns:
        "Color(r, g, b, a)" with 0.0-1.0 float values (3 decimal places)
    """
    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 6:
        r = int(hex_color[0:2], 16) / 255.0
        g = int(hex_color[2:4], 16) / 255.0
        b = int(hex_color[4:6], 16) / 255.0
        a = 1.0
    elif len(hex_color) == 8:
        r = int(hex_color[0:2], 16) / 255.0
        g = int(hex_color[2:4], 16) / 255.0
        b = int(hex_color[4:6], 16) / 255.0
        a = int(hex_color[6:8], 16) / 255.0
    else:
        return "Color(1, 1, 1, 1)"
    return f"Color({r:.3f}, {g:.3f}, {b:.3f}, {a:.3f})"


def figma_color_to_hex(color: dict) -> str:
    """Convert Figma RGBA (0-1 floats) to hex string.

    Args:
        color: dict with 'r', 'g', 'b' (0-1 floats), optional 'a'

    Returns:
        "#RRGGBB" or "#RRGGBBAA"
    """
    r = int(color.get('r', 0) * 255)
    g = int(color.get('g', 0) * 255)
    b = int(color.get('b', 0) * 255)
    a = color.get('a', 1.0)
    if a >= 0.99:
        return f"#{r:02x}{g:02x}{b:02x}"
    return f"#{r:02x}{g:02x}{b:02x}{int(a * 255):02x}"


# Anchor preset constants matching Godot's internal values
ANCHOR_PRESETS = {
    "top_left": 0,
    "top_right": 1,
    "bottom_left": 2,
    "bottom_right": 3,
    "center_left": 4,
    "center_top": 5,
    "center_right": 6,
    "center_bottom": 7,
    "center": 8,
    "left_wide": 9,
    "top_wide": 10,
    "right_wide": 11,
    "bottom_wide": 12,
    "full_rect": 15,
}


if __name__ == "__main__":
    # Self-test
    assert sanitize_node_name('btn_play') == 'btn_play'
    assert sanitize_node_name('"; OS.execute("cmd")') == 'OS_execute_cmd'
    assert sanitize_node_name('123abc') == '_123abc'
    assert sanitize_node_name('') == 'unnamed_node'
    assert sanitize_node_name('hello world!@#$') == 'hello_world'

    assert sanitize_tscn_string('Say "hello"') == 'Say \\"hello\\"'
    assert sanitize_tscn_string('path\\to\\file') == 'path\\\\to\\\\file'

    assert sanitize_class_name('main_menu') == 'MainMenu'
    assert sanitize_class_name('game_over_screen') == 'GameOverScreen'

    assert hex_to_godot_color('#e94560') == 'Color(0.914, 0.271, 0.376, 1.000)'
    assert hex_to_godot_color('#1a1a2ecc') == 'Color(0.102, 0.102, 0.180, 0.800)'

    assert figma_color_to_hex({'r': 0.914, 'g': 0.271, 'b': 0.376, 'a': 1.0}) == '#e9455f'

    print("All sanitization tests passed!")
