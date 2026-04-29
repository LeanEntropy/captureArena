---
description: Push approved UI designs to Figma for director review, read edits back via Framelink MCP
globs: ["**/ui-spec*.json", "**/ui_specs/**"]
---

# Figma UI Compose

## When to Use
- After a UI concept is approved and ui-spec.json is generated
- Director wants to visually review/edit the design in Figma
- Director says "push this to Figma" or "let me see it in Figma"
- Director has finished editing in Figma and says "pull changes" or "I'm done editing"

## Prerequisites
1. Approved `ui-spec.json` for the target screen
2. Generated assets (backgrounds, icons) referenced in the spec
3. Figma account with personal access token in `.env` as `FIGMA_PAT`
4. MCP servers available:
   - **Framelink MCP** (free, for reading): `get_figma_data`, `download_figma_images`
   - **Figma Official MCP** (for writing): `generate_figma_design`

## MCP Configuration

### Framelink MCP (Reader — Free)
Add to `.claude/settings.local.json`:
```json
{
  "mcpServers": {
    "framelink-figma": {
      "command": "npx",
      "args": ["-y", "figma-developer-mcp@1.0.4"],
      "env": { "FIGMA_PERSONAL_ACCESS_TOKEN": "${FIGMA_PAT}" }
    }
  }
}
```

### Figma REST API (Fallback)
If MCP is not configured, use the REST API directly:
- Base URL: `https://api.figma.com/v1/`
- Auth: `Authorization: Bearer {FIGMA_PAT}`
- Read file: `GET /v1/files/{file_key}`
- Export images: `GET /v1/images/{file_key}?ids={node_ids}&format=png&scale=2`

## Workflow: Push to Figma

### Step 1: Read ui-spec.json
Load the approved spec. Extract:
- Screen name, viewport dimensions
- Full element tree with positions, sizes, colors
- Style definitions (StyleBoxFlat properties)
- Typography (fonts, sizes)
- Palette colors

### Step 2: Map ui-spec Elements to Figma Concepts

| ui-spec node_type | Figma Element |
|---|---|
| Control, Panel, PanelContainer | Frame with fill |
| Label, RichTextLabel | Text |
| Button | Frame with text child + fill + corner radius |
| TextureRect | Image (if asset exists) or Rectangle placeholder |
| VBoxContainer | Frame with auto-layout vertical |
| HBoxContainer | Frame with auto-layout horizontal |
| ColorRect | Rectangle with solid fill |
| NinePatchRect | Rectangle with image fill |
| HSlider, VSlider | Frame composition (track + handle) |
| ProgressBar | Frame composition (background + fill) |
| ScrollContainer | Frame with clip content |
| TabContainer | Frame with tab bar + content area |

### Step 3: Push to Figma
Use the Official MCP `generate_figma_design` tool:
- Create a top-level frame at viewport dimensions (e.g., 720x1280)
- Name it "{screen_name} — PlayDreams UI"
- Create child elements matching the ui-spec element tree
- Apply fills, strokes, corner radii from styles
- Set text content and typography
- Organize layers into groups: "Background", "Content", "Buttons", "Overlays"
- Name every layer with the element id from ui-spec.json

### Step 4: Report to Director
"Design pushed to Figma: {figma_url}

The file has {element_count} layers. You can:
- Move, resize, or recolor any element
- Add new elements (I'll detect them)
- Delete elements (I'll note the removal)
- Change text content

Tell me when you're done editing and I'll pull the changes."

## Workflow: Read Back from Figma

### Step 1: Get Design Data
When the director says they're done:
```
Use Framelink MCP get_figma_data with the Figma file URL
```

### Step 2: Parse Figma Response
Extract from the data:
- Node tree with absolute positions (`absoluteBoundingBox`)
- Fill colors (`fills[].color` — RGBA 0-1 range, convert to hex)
- Stroke colors and weights
- Corner radii
- Text content and styles (fontFamily, fontSize, fontWeight)
- Auto-layout properties (layoutMode, itemSpacing, padding)
- Layer names (should match element IDs)

### Step 3: Diff Against Original ui-spec.json
Detect:

**Position changes:**
- Compare absoluteBoundingBox against original anchor/offset values
- Flag any element that moved more than 2px

**Color changes:**
- Compare fill colors against palette values
- Flag new colors not in original palette

**Size changes:**
- Compare width/height against original min_size
- Flag resized buttons, panels, containers

**Text changes:**
- Compare `characters` against original text values

**Structural changes:**
- New layers not in original spec → additions
- Missing layers → deletions

### Step 4: Present Changes
Format detected changes as a clear summary:

"I detected these changes from your Figma edits:

**Moved:**
- title: moved up 40px (offset_y: 200 → 160)

**Colors:**
- accent changed from #e94560 → #ff6b6b

**Sizes:**
- btn_play widened from 300 → 340px

**Text:**
- title: 'DARK REALMS' → 'REALM OF SHADOWS'

Apply these changes? Also apply color changes to other screens?"

### Step 5: Update ui-spec.json
Apply confirmed changes. If palette change affects all screens, update all ui-spec.json files.

## Color Conversion

```python
def figma_color_to_hex(color):
    """Figma RGBA (0-1) to hex."""
    r = int(color.get('r', 0) * 255)
    g = int(color.get('g', 0) * 255)
    b = int(color.get('b', 0) * 255)
    a = color.get('a', 1.0)
    if a >= 0.99:
        return f"#{r:02x}{g:02x}{b:02x}"
    return f"#{r:02x}{g:02x}{b:02x}{int(a * 255):02x}"
```

## Naming Convention for Figma Layers
- Layer names = element IDs from ui-spec.json (snake_case)
- Group names = semantic regions: "background", "content", "buttons", "header", "footer"
- Prefix with screen_id for multi-screen files: "main_menu/btn_play"

## Error Handling
- Framelink MCP not configured → fall back to REST API via curl
- Figma file not accessible → report error, suggest checking PAT
- Layer names don't match element IDs → use position-based matching as fallback
- Rate limit (429) → wait and retry with exponential backoff

## Security
- Never embed the Figma PAT in generated code or log output
- Sanitize all Figma-sourced strings before using in .tscn/.gd generation
- Use `tools.ui_sanitize.sanitize_node_name()` for layer names
- Use `tools.ui_sanitize.sanitize_tscn_string()` for text content
