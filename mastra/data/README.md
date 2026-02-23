# Mastra Data (国土数値情報)

このフォルダに **GeoJSON形式** の国土数値情報を配置します。
現在のワークフローは **Point / MultiPoint** のみ対応しています。

## 置くファイル（推奨）
- `tourism.geojson` : 観光資源
- `culture.geojson` : 文化施設（美術館/博物館/図書館/記念館など）
- `tourism_ksj.geojson` : 国土数値情報（観光資源/P12）
- `attractions_ksj.geojson` : 国土数値情報（集客施設/P33）

`.env` で以下のように指定します（相対パスでOK）:

```
MASTRA_NATIONAL_DATA_PATHS=data/tourism.geojson,data/culture.geojson
```

P12/P33 を追加する場合:

```
MASTRA_NATIONAL_DATA_PATHS=data/tourism.geojson,data/culture.geojson,data/tourism_ksj.geojson,data/attractions_ksj.geojson
```

## 必要なGeoJSONの形式
- `FeatureCollection` 形式
- geometry: `Point` または `MultiPoint`
- name 相当のプロパティが必要  
  - 認識されるキー: `name`, `名称`, `施設名`, `観光地名`, `観光資源名`, `title`
- category 相当のプロパティがあるとよい  
  - 認識されるキー: `カテゴリ`, `種別`, `区分`, `category`, `type`

## 変換方法（例）
GML/ShapeからGeoJSONが必要な場合は以下のいずれかで変換してください。

1) QGIS で GeoJSON で保存  
2) GDAL (ogr2ogr) を使って変換

> 例: `ogr2ogr -f GeoJSON tourism.geojson source.shp`

---
**注意**: このフォルダには大きなデータが置かれるため、Git管理には含めない想定です。
