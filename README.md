<img width="2074" height="1147" alt="image" src="https://github.com/user-attachments/assets/2eeba002-5740-4336-9723-1b4eee7c2992" />

# XofY OSM Geometry Viewer

A web app for exploring and visualizing the geometry of OpenStreetMap features. It's called "X of Y" because it lets you view things like:
- The Parks of Seattle
- Swimming Pools of Phoenix
- Cathedrals of France
- Subway Routes of Tokyo
- ...and much more!

## Features

### Three Ways to Load Data

**Curated Queries** - Select from pre-built feature/area combinations. Pick a feature type (churches, parks, museums, roller coasters, etc.) and an area (cities, states, countries) to instantly generate and run an Overpass query.

**Custom Overpass Queries** - Write your own Overpass QL queries for full control over what you're exploring.

**GeoJSON Import** - Import your own GeoJSON files to visualize any geometry data.

### Shareable URLs

Find something amazing? Copy a link to share your current query with others - the feature/area selection (or raw query), colors, and display settings are all encoded in the URL.

## Writing Custom Overpass Queries

### Requirements

- Must output JSON: Use `[out:json];`
- Must include coordinate data: Use `out geom;`
- Only query ways and relations (nodes don't have interesting geometry)

### Example: Museums of Paris
```
[out:json];
rel["type"="boundary"]["name"="Paris"]["admin_level"="8"];
map_to_area->.searchArea;
wr(area.searchArea)["tourism"="museum"];
out geom;
```

### Tips

- **Use area-based searches** for easier query writing:
  - Find a boundary relation: `rel["type"="boundary"]["name"="YourCity"];`
  - Convert to search area: `map_to_area->.searchArea;`
  - Search within: `way(area.searchArea)["your"="tags"];`
- Use [bboxfinder.com](http://bboxfinder.com/) if you prefer bounding box queries

### Grouping Hint

Many Overpass queries return disconnected ways that represent a single feature (e.g., 3 ways making up one water slide). The viewer automatically stitches connected ways together.

For highly connected networks (trail systems, road networks), use the **Grouping hint** field. Enter a tag name like `name` or `ref` to group connected ways that share the same tag value. This prevents the entire network from being merged into one feature.

## Future Enhancements

- Export geometries as PNG images / posters
- Your idea here! Open an issue or reach out.
