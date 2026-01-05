<img width="2074" height="1147" alt="image" src="https://github.com/user-attachments/assets/2eeba002-5740-4336-9723-1b4eee7c2992" />

# XofY OSM Geometry Viewer
A page for reviewing the geometry of a load of OSM features all at once. It is called X of Y because it enables you to look at:
 - The Parks of Seattle
 - Airport Terminals of the United States
 - Swimming Pools of Phoenix
 - etc

### Example Queries

**Churches of Seattle**
```
[out:json];
rel["type"="boundary"]["name"="Seattle"];
map_to_area->.searchArea;
wr(area.searchArea)["building"="church"];
out geom;
```

**Named parks of Seattle**
```
[out:json];
rel["type"="boundary"]["name"="Seattle"];
map_to_area->.searchArea;
wr(area.searchArea)["leisure"="park"][name];
out geom;
```

**Museums of Paris**
```
[out:json];
rel["type"="boundary"]["name"="Paris"]["admin_level"="8"];
map_to_area->.searchArea;
wr(area.searchArea)["tourism"="museum"];
out geom;
```

**Swimming pools of Phoenix**
```
[out:json];
rel["type"="boundary"]["name"="Phoenix"]["admin_level"="8"];
map_to_area->.searchArea;
wr(area.searchArea)["leisure"="swimming_pool"];
out geom;
```

### How to make a good query...

- Must have json as output. Use `[out:json];`
- Must have coordinate data. Use `out geom;`
- Only query for ways and relations. Nodes do not have interesting geometry and will be dropped.
- **Use area-based searches** instead of bounding boxes for easier query writing:
  - Find a boundary relation: `rel["type"="boundary"]["name"="YourCity"];`
  - Convert to search area: `map_to_area->.searchArea;`
  - Search within that area: `way(area.searchArea)["your"="tags"];`
  - For completeness, query both ways and relations with `(way(...); rel(...));`
- Alternatively, you can also use a bouding box to keep the nubmer of results managable:
  - Use [bboxfinder.com](http://bboxfinder.com/), draw your area of interest, copy the BOX coordinates in at the bottom.
- Query for [tags that are typically areas](https://wiki.openstreetmap.org/wiki/Area#Tags_implying_area_status). No support for linear data... YET.

### Coalescing ways

Many Overpass queries will return a collection of disconnected ways that represent one features. (ex: 3 ways that collectively make up one water slide). The site will attempt to stich features back together based off of starting and ending nodes. However, this is expensive and highly connected sets of ways are problematic. 

If you wish to explore a highly connected set of ways (trail network, roadways in a city etc) it is helpful to use the "Group By" feature in the settings panel. This will cause feature generation to take into account the value of the tag you specify as well as the overall connectedness. See the `Primary highways of Seattle (grouped by name)` example query.

## Future Enhancements - Let me know!

- Export geometries as PNG images, maybe fancy posters??
- Your idea here!
