import re

with open("src/App.jsx", "r") as f:
    content = f.read()

# 1. Add PROVINCES list
provinces_code = """
const PROVINCES = {
  'เชียงราย': { id: 'เชียงราย', nameTh: 'เชียงราย', lat: 19.908, lon: 99.832 },
  'เชียงใหม่': { id: 'เชียงใหม่', nameTh: 'เชียงใหม่', lat: 18.788, lon: 98.985 },
  'แพร่': { id: 'แพร่', nameTh: 'แพร่', lat: 18.144, lon: 100.140 },
  'ภูเก็ต': { id: 'ภูเก็ต', nameTh: 'ภูเก็ต', lat: 7.880, lon: 98.392 },
};
"""

content = content.replace("const WEATHER_STATIONS = [", provinces_code + "\nconst WEATHER_STATIONS = [")

# 2. Add selectedProvince state
content = content.replace("const [clickMode, setClickMode] = useState(false);", "const [clickMode, setClickMode] = useState(false);\n  const [selectedProvince, setSelectedProvince] = useState('เชียงราย');")

# 3. Update map center
content = content.replace(
    "center: { lon: 99.832, lat: 19.908 },",
    "center: { lon: PROVINCES[selectedProvince].lon, lat: PROVINCES[selectedProvince].lat },"
)

# Wait, selectedProvince is in App component, but SphereMap receives it?
# Let's pass selectedProvince to SphereMap!
content = content.replace(
    "const SphereMap = ({ activeRoute, allRoutesData, stationData",
    "const SphereMap = ({ selectedProvince, activeRoute, allRoutesData, stationData"
)

content = content.replace(
    "<SphereMap activeRoute",
    "<SphereMap selectedProvince={selectedProvince} activeRoute"
)

# Also update the map center logic to re-center when province changes.
map_effect_replace = """
  // Re-center map when province changes
  useEffect(() => {
    if (mapInstance.current && window.sphere) {
      const p = PROVINCES[selectedProvince];
      if (p) mapInstance.current.location({ lon: p.lon, lat: p.lat }, 11);
    }
  }, [selectedProvince]);
"""
content = content.replace(
    "// Keep both refs in sync",
    map_effect_replace + "\n  // Keep both refs in sync"
)

# 4. Update fetch endpoints
content = content.replace("fetch('/api/dynamic-routes', {", "fetch(`/api/dynamic-routes?province=${selectedProvince}`, {")
content = content.replace("fetch('/api/flood-routes')", "fetch(`/api/flood-routes?province=${selectedProvince}`)")
content = content.replace("fetch(`/api/gistda/flood?range=${range}`)", "fetch(`/api/gistda/flood?range=${range}&province=${selectedProvince}`)")
content = content.replace("fetch('/api/explain', {", "fetch(`/api/explain?province=${selectedProvince}`, {")
content = content.replace("fetch('/api/override', {", "fetch(`/api/override?province=${selectedProvince}`, {")
content = content.replace("fetch('/api/ai/chat', {", "fetch('/api/ai/chat', {")

# Modify bodies to include province
content = content.replace(
    "body: JSON.stringify({ message: prompt, history: chatHistory, routeContext: activeData })",
    "body: JSON.stringify({ message: prompt, history: chatHistory, routeContext: activeData, province: selectedProvince })"
)

# 5. Add Dropdown UI in Header
header_ui = """
          <div className="header-brand-text">
            <h1>FloodNav · {selectedProvince}</h1>
            <span>GISTDA · TMD · DDPM</span>
          </div>
        </div>
        <select 
          value={selectedProvince}
          onChange={e => setSelectedProvince(e.target.value)}
          style={{ background: '#1e293b', color: 'white', border: '1px solid #334155', borderRadius: 8, padding: '4px 12px', marginLeft: 16, fontFamily: 'var(--font-th)' }}
        >
          {Object.keys(PROVINCES).map(p => <option key={p} value={p}>จ.{p}</option>)}
        </select>
        <div className="header-div" />
"""

content = content.replace("""
          <div className="header-brand-text">
            <h1>FloodNav · เชียงราย</h1>
            <span>GISTDA · TMD · DDPM</span>
          </div>
        </div>
        <div className="header-div" />""", header_ui)


# 6. Hide Precomputed Routes if not Chiang Rai
content = content.replace(
    "{/* ── 1. Static/Precomputed Routes (Fallback) ── */}",
    "{selectedProvince === 'เชียงราย' && (\n      <>\n      {/* ── 1. Static/Precomputed Routes (Fallback) ── */}"
)
content = content.replace(
    "{/* ── 2. Dynamic Router Results ── */}",
    "      </>\n      )}\n      {/* ── 2. Dynamic Router Results ── */}"
)

# Also in "Dynamic Routing" panel:
content = content.replace(
    "{ROUTES_BASE.map(route => {",
    "{selectedProvince === 'เชียงราย' && ROUTES_BASE.map(route => {"
)
# And the warning text:
content = content.replace(
    "⚠ เส้นทางด้านล่างเป็นข้อมูล Precomputed ของจ.เชียงรายเท่านั้น",
    "⚠ เส้นทางด้านล่างเป็นข้อมูล Precomputed ของจ.เชียงรายเท่านั้น (เปลี่ยนไปแท็บเส้นทาง Dynamic หากอยู่จังหวัดอื่น)"
)

with open("src/App.jsx", "w") as f:
    f.write(content)

print("App.jsx refactored successfully")
