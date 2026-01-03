
# XofY OSM Geometry Viewer

A silly page for reviewing (gawking at??) the geometry of a load of OSM features all at once. It is called X of Y because it enables you to looks at:
 - The Parks of Seattle
 - Airport Terminals of the United States
 - Swimming Pools of Phoenix
 - etc

### Example Queries


**Cooling basins of the world**`
```
[out:json];
wr["basin"="cooling"];
out geom;
```

**Named parks of Seattle**
```
[out:json];
wr["leisure"="park"][name](47.4810,-122.4598,47.7341,-122.2245);
out geom;
```

**Jetsprint lakes of the world**
```
'lakes_jetsprint': `[out:json];
wr["sport"="jetsprint"]["water"="lake"];
out geom;
```

**Jet ski lakes of the world**
```
[out:json];
wr["sport"="water_ski"][natural=water];
out geom;
```

**Waterslides in US-AZ - Coming Soon!**
```
[out:json];
wr["attraction"="water_slide"](31.3325,-114.8126,37.0004,-109.0475);
out geom;
```

**Raceways in US-WA - Coming Soon!**
```
[out:json];
wr["highway"="raceway"][sport=motor](45.543,-124.733,49.002,-116.916);
out geom;
```

### How to make a good query...

- Must have json as output. Use `[out:json];`
- Must have coordinate data. Use `out geom;`
- Only query for ways and relations. Nodes do not have interesting geometry and will be dropped.
- Provide a bounding box unless you know the query will only return a moderate amount of data (100's is okay!).
  - Use [TagInfo](https://taginfo.openstreetmap.org/) to see if your tag is super super common.
  - Use [bboxfinder.com](http://bboxfinder.com/), draw your area of interest, copy the BOX coordinates in at the bottom.
- Query for [tags that are typically areas](https://wiki.openstreetmap.org/wiki/Area#Tags_implying_area_status). No support for linear data... YET.

## Future Enhancements - Let me know!

- Make queries a bit easier to write.. having to find the bounding box is annoying.
- Export geometries as PNG images, maybe fancy posters??
- Click to view full OSM tags
- "Open in JOSM" links on cards
- URL with encoded query for sharing
- Your idea here!
