# Adding Features (X) and Areas (Y)

This guide explains how to update the curated feature/area data structures in `docs/js/main.js`.

## Adding a New Feature (X)

Add an entry to the `FEATURES` object:

```javascript
'feature_key': {
    displayName: 'Display Name',      // Shown in dropdown
    tags: '["tag"="value"]',          // Overpass tag filter
    elementTypes: 'wr',               // 'wr' (ways+relations), 'way', or 'rel'
    minAdminLevel: 8,                 // Minimum area size allowed (see below)
    allowedAreas: null,               // null = use minAdminLevel, or ['area_key1', 'area_key2']
    groupBy: null                     // null = no grouping, or 'tagname' to merge by tag
}
```

### Admin Levels

Controls which areas are available for this feature:

| Level | Description | Example |
|-------|-------------|---------|
| `0` | World allowed | Cooling basins (rare features) |
| `2` | Countries and smaller | Cathedrals, historic aircraft |
| `4` | States/provinces and smaller | Water slides, lazy rivers |
| `6` | Counties and smaller | Primary highways |
| `8` | Cities only | Churches, museums, swimming pools |
| `10` | Special areas only | Roller coasters (theme parks) |

### Examples

**Add "Libraries" feature (city-level only):**
```javascript
'libraries': {
    displayName: 'Libraries',
    tags: '["amenity"="library"]',
    elementTypes: 'wr',
    minAdminLevel: 8,
    allowedAreas: null,
    groupBy: null
}
```

**Add "Golf Courses" feature (state-level OK):**
```javascript
'golf_courses': {
    displayName: 'Golf Courses',
    tags: '["leisure"="golf_course"]',
    elementTypes: 'wr',
    minAdminLevel: 4,
    allowedAreas: null,
    groupBy: null
}
```

**Add a feature only available in specific areas:**
```javascript
'london_underground': {
    displayName: 'London Underground',
    tags: '[route=subway]',
    elementTypes: 'rel',
    minAdminLevel: 8,
    allowedAreas: ['london'],  // Must add 'london' to AREAS too
    groupBy: null
}
```

### Special Cases

For features needing custom queries (like network filters), add handling in the `buildQuery()` function:

```javascript
if (featureKey === 'london_underground' && areaKey === 'london') {
    return `[out:json];
rel[route=subway][network="London Underground"];
out geom;`;
}
```

For complex queries like the flowerbeds example (using foreach), add `customQuery: true` and handle it in `buildQuery()`.

---

## Adding a New Area (Y)

Add an entry to the `AREAS` object:

```javascript
'area_key': {
    displayName: 'City Name, State',
    relationId: 123456,    // OSM relation ID
    adminLevel: 8          // 2=country, 4=state, 6=county, 8=city, 10=special
}
```

### Finding Relation IDs

1. Go to [openstreetmap.org](https://openstreetmap.org)
2. Search for the area (city, state, country, etc.)
3. Click on the boundary relation in the search results
4. The URL will show the relation ID (e.g., `/relation/237385` → use `237385`)

### Admin Level Reference

| Level | Type | Examples |
|-------|------|----------|
| `2` | Country | USA, Germany, UK |
| `4` | State/Province | California, Arizona |
| `6` | County | Butler County, OH |
| `8` | City | Seattle, Paris, Phoenix |
| `10` | Special | Disney World, theme parks |

### Examples

**Add Chicago:**
```javascript
'chicago': { displayName: 'Chicago, IL', relationId: 122604, adminLevel: 8 }
```

**Add Texas:**
```javascript
'texas': { displayName: 'Texas, US', relationId: 114690, adminLevel: 4 }
```

**Add a theme park:**
```javascript
'universal_orlando': { displayName: 'Universal Orlando, FL', relationId: 7326552, adminLevel: 10 }
```

---

## Tag Reference

Common OSM tags for features:

| Category | Tag Example |
|----------|-------------|
| Buildings | `["building"="church"]`, `["building"="cathedral"]` |
| Amenities | `["amenity"="library"]`, `["amenity"="hospital"]` |
| Leisure | `["leisure"="park"]`, `["leisure"="swimming_pool"]`, `["leisure"="golf_course"]` |
| Tourism | `["tourism"="museum"]`, `["tourism"="attraction"]` |
| Highways | `["highway"="primary"]`, `["highway"="raceway"]` |
| Routes | `[route=subway]`, `[route=bus]` |
| Historic | `["historic"="aircraft"]`, `["historic"="monument"]` |

You can combine tags: `["leisure"="swimming_pool"]["swimming_pool"="lazy_river"]`

Use `[name]` to require a name tag: `["leisure"="park"][name]`

Explore more tags at [taginfo.openstreetmap.org](https://taginfo.openstreetmap.org)
