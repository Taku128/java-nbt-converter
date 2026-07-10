# `.litematic` フォーマット仕様

Litematica Mod (https://github.com/maruohon/litematica) が出力する schematic ファイル形式。
本ライブラリの `@taku128/java-schematic` は `src/litematica/parser.ts` で読み込みを実装している。

## ファイル形式

- 圧縮: **gzip**
- NBT: **Big-Endian**, prismarine-nbt 互換ツリーで解釈
- 拡張子: `.litematic` (公式) / `.litematica` (誤称) / 二重圧縮として `.litematic.gz` で配布されることもある

## ルート構造

```text
Compound {
  Version:                Int     // schematic 仕様のバージョン (6 が現行)
  MinecraftDataVersion:   Int     // Minecraft Java DataVersion (例: 3953 = 1.21)
  Metadata: Compound {
    Name:         String
    Author:       String
    Description:  String
    TimeCreated:  Long
    TimeModified: Long
    EnclosingSize: Compound { x: Int, y: Int, z: Int }   // 全領域を囲う AABB のサイズ (全て正)
    TotalVolume:  Int
    TotalBlocks:  Int
    RegionCount:  Int
    ...
  }
  Regions: Compound {
    <regionName>: Compound {
      Position:   Compound { x: Int, y: Int, z: Int }
      Size:       Compound { x: Int, y: Int, z: Int }   // 符号付き
      BlockStatePalette: List<Compound> [
        { Name: String, Properties?: Compound<String,String> },
        ...
      ]
      BlockStates: LongArray   // ビットパック済みのパレットインデックス列
      TileEntities: List<Compound>   // ブロックエンティティ NBT
      Entities:     List<Compound>   // エンティティ NBT
      PendingBlockTicks: List, PendingFluidTicks: List   // 任意
    },
    ...
  }
}
```

## 座標系の最重要ルール

**`Size` が負の成分を持っていても、配列の並びは bbox の最小コーナーから +X / +Y / +Z 方向に並ぶ。**

Litematica は「プレイヤーが選択範囲を `Position` から作り、対角点まで `Size` 方向にドラッグした」という履歴を符号付き `Size` で記録する。だが BlockStates 配列のデータ並びはあくまで「最小コーナーが index 0」で固定。

### bbox 最小コーナー (effective origin) の計算

```
effOriginX = Position.x + (Size.x < 0 ? Size.x + 1 : 0)
effOriginY = Position.y + (Size.y < 0 ? Size.y + 1 : 0)
effOriginZ = Position.z + (Size.z < 0 ? Size.z + 1 : 0)

absSizeX = |Size.x|
absSizeY = |Size.y|
absSizeZ = |Size.z|

bboxMin = (effOriginX, effOriginY, effOriginZ)
bboxMax = bboxMin + (absSizeX, absSizeY, absSizeZ)  // exclusive
```

### BlockStates の解釈

イテレーション順は `y → z → x` で線形 index：

```
linearIdx = y * absSizeX * absSizeZ + z * absSizeX + x   // x, y, z ∈ [0, absSize)
worldX    = effOriginX + x
worldY    = effOriginY + y
worldZ    = effOriginZ + z
```

ビットパック規則:

- `bitsPerBlock = max(2, ⌈log2(paletteCount)⌉)`
- `mask = (1 << bitsPerBlock) - 1`
- 各エントリは long 配列を **下位ビットから** 走査して取り出す (long 境界を跨ぐ場合あり)

```ts
const bitOffset = linearIdx * bitsPerBlock;
const startLong = Math.floor(bitOffset / 64);
const startBit  = BigInt(bitOffset % 64);
let val = longs[startLong] >> startBit;
if (startBit + BigInt(bitsPerBlock) > 64n) {
  val |= longs[startLong + 1] << (64n - startBit);
}
const paletteIdx = Number(val & mask);
```

> ⚠️ `Size.x = -12, Position.x = 11` のとき、`linearIdx=0` は **world X = 0** にある (`effOriginX = 11 + (-12 + 1) = 0`)。`Position` が原点と勘違いして `worldX = 11 - x` のように計算すると上下/左右が反転する。実装の旧版がこのバグを持っていた。

## TileEntities / Entities の座標

- **TileEntities[i]**: `{ x, y, z, ...rest }` で `(x, y, z) ∈ [0, |Size|)`、bbox 最小コーナー相対。
  実世界座標 = `bboxMin + (x, y, z)`。

- **Entities[i]**: `{ Pos: [Double, Double, Double], ...rest }` で `Pos` は同じく bbox 最小コーナー相対。

両方ともブロック座標と同じ原点を共有するため、座標変換は `+ effOrigin` で済む。

## マルチリージョン

`Regions` は複数キーを持つことができる。各リージョンは独立して上記の bbox を計算し、union を取って全体 AABB を出す。
`Metadata.EnclosingSize` は実質「全リージョン union の絶対サイズ」だが、Litematica による符号丸めがあるので本ライブラリでは自力で計算した値を優先する。

## パレットの正規化

- ブロックステートのプロパティはすべて `String` で格納される (Java NBT の慣例)
- パレットエントリ `{ Name, Properties }` を `Name[propA=valA,propB=valB,...]` のキーで正規化することで、複数リージョン間のパレット重複を除去する。
  本ライブラリでは `canonicalKey()` がプロパティキーをソートして結合している。

## 既知の不整合 / 注意点

- `BlockStates` の bitsPerBlock 計算は **空気を含めたパレット長 - 1** を基に決まる。空のパレットや 1 要素パレットでも最低 2bit が使われる。
- `Long` 値は古い prismarine-nbt 系では `[high, low]` の 2 要素配列で来ることがあるため、`toU64()` で吸収する。
- 一部の極端な負サイズ (例: `Position=(32, 0, 207), Size=(-33, 3, -208)`) でも `effOrigin = (0, 0, 0)` に正規化されることを動作確認済み。

## 参照

- Litematica 本体: https://github.com/maruohon/litematica
- 公式 wiki (一部誤りあり): https://litematica.fandom.com/wiki/Litematic_File_Format
- 本ライブラリ実装: `packages/js/java-schematic/src/litematica/parser.ts`
